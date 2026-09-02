import {
  CommandId,
  EventId,
  type OrchestrationClientOrigin,
  type OrchestrationCommand,
  OrchestrationDispatchCommandError,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as ServerRuntimeStartup from "../serverRuntimeStartup.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import * as OrchestrationEngine from "./Services/OrchestrationEngine.ts";
import { ThreadDeletionReactor } from "./Services/ThreadDeletionReactor.ts";

export interface OrchestrationDispatchOptions {
  readonly origin?: OrchestrationClientOrigin;
}

const isOrchestrationDispatchCommandError = Schema.is(OrchestrationDispatchCommandError);
const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

function unexpectedCompatibilityError(error: never): never {
  throw new Error(`Unhandled compatibility error: ${String(error)}`);
}

function legacySetupFailureDescription(cause: unknown): string {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string"
  ) {
    return cause.message;
  }
  return String(cause);
}

function projectSetupScriptCompatibilityDetail(
  error: ProjectSetupScriptRunner.ProjectSetupScriptRunnerError,
): string {
  switch (error._tag) {
    case "ProjectSetupScriptOperationError":
      return legacySetupFailureDescription(error.cause);
    case "ProjectSetupScriptProjectNotFoundError":
      return "Project was not found for setup script execution.";
    default:
      return unexpectedCompatibilityError(error);
  }
}

/**
 * Build the single authoritative orchestration dispatcher used by every
 * transport. Managed durable HTTP delivery and live WebSocket commands must
 * share bootstrap transactions and startup serialization.
 */
export const makeOrchestrationCommandDispatcher = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const vcsStatusBroadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
  const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
  const projectSetupScriptRunner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
  const threadDeletionReactor = yield* ThreadDeletionReactor;

  const toDispatchCommandError = (cause: unknown, fallbackMessage: string) =>
    isOrchestrationDispatchCommandError(cause)
      ? cause
      : new OrchestrationDispatchCommandError({
          message: cause instanceof Error ? cause.message : fallbackMessage,
          cause,
        });
  const randomUUID = crypto.randomUUIDv4.pipe(
    Effect.mapError((cause) =>
      toDispatchCommandError(cause, "Failed to generate orchestration command identifier."),
    ),
  );
  const serverEventId = randomUUID.pipe(Effect.map(EventId.make));
  const serverCommandId = (tag: string) =>
    randomUUID.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));
  const refreshGitStatus = (cwd: string) =>
    vcsStatusBroadcaster
      .refreshStatus(cwd)
      .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);

  const appendSetupScriptActivity = (
    input: {
      readonly threadId: ThreadId;
      readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
      readonly summary: string;
      readonly createdAt: string;
      readonly payload: Record<string, unknown>;
      readonly tone: "info" | "error";
    },
    options: OrchestrationDispatchOptions | undefined,
  ) =>
    Effect.all({
      commandId: serverCommandId("setup-script-activity"),
      activityId: serverEventId,
    }).pipe(
      Effect.flatMap(({ commandId, activityId }) =>
        orchestrationEngine.dispatch(
          {
            type: "thread.activity.append",
            commandId,
            threadId: input.threadId,
            activity: {
              id: activityId,
              tone: input.tone,
              kind: input.kind,
              summary: input.summary,
              payload: input.payload,
              turnId: null,
              createdAt: input.createdAt,
            },
            createdAt: input.createdAt,
          },
          options,
        ),
      ),
    );

  const toBootstrapDispatchCommandCauseError = (cause: Cause.Cause<unknown>) => {
    const error = Cause.squash(cause);
    return isOrchestrationDispatchCommandError(error)
      ? error
      : new OrchestrationDispatchCommandError({
          message:
            error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
          cause,
        });
  };

  const dispatchBootstrapTurnStart = (
    command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
    options: OrchestrationDispatchOptions | undefined,
  ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> =>
    Effect.gen(function* () {
      const bootstrap = command.bootstrap;
      const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
      let createdThread = false;
      let targetProjectId = bootstrap?.createThread?.projectId;
      let targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
      let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;

      const cleanupCreatedThread = () =>
        createdThread
          ? serverCommandId("bootstrap-thread-delete").pipe(
              Effect.flatMap((commandId) =>
                orchestrationEngine.dispatch(
                  {
                    type: "thread.delete",
                    commandId,
                    threadId: command.threadId,
                  },
                  options,
                ),
              ),
              Effect.as(true),
            )
          : Effect.succeed(false);

      const recordSetupScriptLaunchFailure = (input: {
        readonly error: ProjectSetupScriptRunner.ProjectSetupScriptRunnerError;
        readonly requestedAt: string;
        readonly worktreePath: string;
      }) => {
        const detail = projectSetupScriptCompatibilityDetail(input.error);
        return appendSetupScriptActivity(
          {
            threadId: command.threadId,
            kind: "setup-script.failed",
            summary: "Setup script failed to start",
            createdAt: input.requestedAt,
            payload: { detail, worktreePath: input.worktreePath },
            tone: "error",
          },
          options,
        ).pipe(
          Effect.ignoreCause({ log: false }),
          Effect.flatMap(() =>
            Effect.logWarning("bootstrap turn start failed to launch setup script", {
              threadId: command.threadId,
              worktreePath: input.worktreePath,
              detail,
            }),
          ),
        );
      };

      const recordSetupScriptStarted = (input: {
        readonly requestedAt: string;
        readonly worktreePath: string;
        readonly scriptId: string;
        readonly scriptName: string;
        readonly terminalId: string;
      }) =>
        Effect.gen(function* () {
          const startedAt = yield* nowIso;
          const payload = {
            scriptId: input.scriptId,
            scriptName: input.scriptName,
            terminalId: input.terminalId,
            worktreePath: input.worktreePath,
          };
          yield* Effect.all([
            appendSetupScriptActivity(
              {
                threadId: command.threadId,
                kind: "setup-script.requested",
                summary: "Starting setup script",
                createdAt: input.requestedAt,
                payload,
                tone: "info",
              },
              options,
            ),
            appendSetupScriptActivity(
              {
                threadId: command.threadId,
                kind: "setup-script.started",
                summary: "Setup script started",
                createdAt: startedAt,
                payload,
                tone: "info",
              },
              options,
            ),
          ]).pipe(
            Effect.asVoid,
            Effect.catch((error) =>
              Effect.logWarning(
                "bootstrap turn start launched setup script but failed to record setup activity",
                {
                  threadId: command.threadId,
                  worktreePath: input.worktreePath,
                  scriptId: input.scriptId,
                  terminalId: input.terminalId,
                  detail: error.message,
                },
              ),
            ),
          );
        });

      const runSetupProgram = () =>
        Effect.gen(function* () {
          if (!bootstrap?.runSetupScript || !targetWorktreePath) return;
          const worktreePath = targetWorktreePath;
          const requestedAt = yield* nowIso;
          yield* projectSetupScriptRunner
            .runForThread({
              threadId: command.threadId,
              ...(targetProjectId ? { projectId: targetProjectId } : {}),
              ...(targetProjectCwd ? { projectCwd: targetProjectCwd } : {}),
              worktreePath,
            })
            .pipe(
              Effect.matchEffect({
                onFailure: (error) =>
                  recordSetupScriptLaunchFailure({ error, requestedAt, worktreePath }),
                onSuccess: (setupResult) =>
                  setupResult.status === "started"
                    ? recordSetupScriptStarted({
                        requestedAt,
                        worktreePath,
                        scriptId: setupResult.scriptId,
                        scriptName: setupResult.scriptName,
                        terminalId: setupResult.terminalId,
                      })
                    : Effect.void,
              }),
            );
        });

      const bootstrapProgram = Effect.gen(function* () {
        if (bootstrap?.createThread) {
          const createResult = yield* orchestrationEngine.dispatch(
            {
              type: "thread.create",
              commandId: yield* serverCommandId("bootstrap-thread-create"),
              threadId: command.threadId,
              projectId: bootstrap.createThread.projectId,
              title: bootstrap.createThread.title,
              modelSelection: bootstrap.createThread.modelSelection,
              runtimeMode: bootstrap.createThread.runtimeMode,
              interactionMode: bootstrap.createThread.interactionMode,
              branch: bootstrap.createThread.branch,
              worktreePath: bootstrap.createThread.worktreePath,
              createdAt: bootstrap.createThread.createdAt,
            },
            options,
          );
          // The successful create is a fence in the engine command queue:
          // every delete for the prior incarnation committed before it.
          // Drain through that event before setup or turn start can own
          // terminals and provider sessions under the reused thread id.
          yield* threadDeletionReactor.drainThrough(createResult.sequence);
          createdThread = createResult.replayed !== true;
        }

        if (bootstrap?.prepareWorktree) {
          let worktreeBaseRef = bootstrap.prepareWorktree.baseBranch;
          const startFromOrigin =
            bootstrap.prepareWorktree.startFromOrigin === true &&
            (yield* gitWorkflow.remoteExists({
              cwd: bootstrap.prepareWorktree.projectCwd,
              remoteName: "origin",
            }));
          if (startFromOrigin) {
            yield* gitWorkflow.fetchRemote({
              cwd: bootstrap.prepareWorktree.projectCwd,
              remoteName: "origin",
            });
            const resolvedRemoteBase = yield* gitWorkflow.resolveRemoteTrackingCommit({
              cwd: bootstrap.prepareWorktree.projectCwd,
              refName: bootstrap.prepareWorktree.baseBranch,
              fallbackRemoteName: "origin",
            });
            worktreeBaseRef = resolvedRemoteBase.commitSha;
          }
          const worktree = yield* gitWorkflow.createWorktree({
            cwd: bootstrap.prepareWorktree.projectCwd,
            refName: worktreeBaseRef,
            newRefName: bootstrap.prepareWorktree.branch,
            baseRefName: bootstrap.prepareWorktree.baseBranch,
            path: null,
          });
          targetWorktreePath = worktree.worktree.path;
          yield* orchestrationEngine.dispatch(
            {
              type: "thread.meta.update",
              commandId: yield* serverCommandId("bootstrap-thread-meta-update"),
              threadId: command.threadId,
              branch: worktree.worktree.refName,
              worktreePath: targetWorktreePath,
            },
            options,
          );
          yield* refreshGitStatus(targetWorktreePath);
        }

        yield* runSetupProgram();
        return yield* orchestrationEngine.dispatch(finalTurnStartCommand, options);
      });

      return yield* bootstrapProgram.pipe(
        Effect.catchCause((cause) => {
          const dispatchError = toBootstrapDispatchCommandCauseError(cause);
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.fail(dispatchError);
          }
          return Effect.uninterruptible(cleanupCreatedThread()).pipe(
            Effect.matchCauseEffect({
              onFailure: (cleanupCause) =>
                Effect.logWarning("bootstrap thread cleanup failed", {
                  threadId: command.threadId,
                  detail: Cause.pretty(cleanupCause),
                }).pipe(Effect.flatMap(() => Effect.fail(dispatchError))),
              onSuccess: (threadDeleted) =>
                Effect.fail(
                  threadDeleted
                    ? new OrchestrationDispatchCommandError({
                        message: dispatchError.message,
                        ...(dispatchError.cause !== undefined
                          ? { cause: dispatchError.cause }
                          : {}),
                        bootstrapThreadDisposition: "deleted",
                      })
                    : dispatchError,
                ),
            }),
          );
        }),
      );
    });

  return (normalizedCommand: OrchestrationCommand, options?: OrchestrationDispatchOptions) => {
    const dispatchEffect =
      normalizedCommand.type === "thread.turn.start" && normalizedCommand.bootstrap
        ? dispatchBootstrapTurnStart(normalizedCommand, options)
        : orchestrationEngine.dispatch(normalizedCommand, options).pipe(
            Effect.tap(({ sequence }) =>
              // Returning from thread.create is the handoff point at which
              // clients may start resources for the new incarnation. Use
              // its event sequence as the exact deletion-cleanup fence.
              normalizedCommand.type === "thread.create"
                ? threadDeletionReactor.drainThrough(sequence)
                : Effect.void,
            ),
            Effect.mapError((cause) =>
              toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
            ),
          );

    return startup
      .enqueueCommand(dispatchEffect)
      .pipe(
        Effect.mapError((cause) =>
          toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
        ),
      );
  };
});
