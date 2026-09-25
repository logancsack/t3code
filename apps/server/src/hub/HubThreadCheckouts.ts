/**
 * Thread checkouts in hub mode: every thread works in its own checkout at
 * `<checkout root>/<threadId>` on its own machine.
 *
 * - Client commands are rewritten before normalization: projects get the
 *   virtual root `/workspace/p/<projectId>` (nothing reads it) and threads the
 *   checkout path as `worktreePath`.
 * - Bootstrap (a new thread's first turn, or a thread moved to its own
 *   branch) ensures and wakes the machine through the directory, passing the
 *   project's repository identity, then asks the runner to prepare the
 *   checkout (clone or fetch with the machine's git credentials, create or
 *   switch the branch). Progress and failures become thread activities:
 *   `thread-machine.starting`, `thread-machine.checkout.preparing`,
 *   `thread-machine.failed`.
 * - Before every turn the checkout is prepared again; the runner call is
 *   idempotent, and skipped when this runner boot already prepared it.
 *
 * @module hub/HubThreadCheckouts
 */
import {
  CommandId,
  EventId,
  OrchestrationDispatchCommandError,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import {
  projectVirtualRoot,
  type ThreadMachineRepository,
  type ThreadMachineStatus,
} from "@t3tools/contracts/runner";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { RepositoryIdentityResolver } from "../project/RepositoryIdentityResolver.ts";
import { HubThreadCheckouts, type HubThreadCheckoutsShape } from "../serverModeHooks.ts";
import { describeCause } from "./hubRouting.ts";
import { RunnerConnectionPool, type ThreadMachineContext } from "./RunnerConnectionPool.ts";

export const THREAD_MACHINE_ACTIVITY = {
  starting: "thread-machine.starting",
  preparingCheckout: "thread-machine.checkout.preparing",
  failed: "thread-machine.failed",
} as const;

export const makeHubThreadCheckouts = Effect.gen(function* () {
  const pool = yield* RunnerConnectionPool;
  const engine = yield* OrchestrationEngineService;
  const projections = yield* ProjectionSnapshotQuery;
  const repositoryIdentity = yield* RepositoryIdentityResolver;
  const crypto = yield* Crypto.Crypto;
  /** Runner boot that last prepared each thread's checkout. */
  const preparedOnBoot = new Map<ThreadId, string>();

  const appendActivity = (
    threadId: ThreadId,
    activity: {
      readonly kind: string;
      readonly summary: string;
      readonly tone: "info" | "error";
      readonly payload: Record<string, unknown>;
    },
  ) =>
    Effect.gen(function* () {
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      const uuid = yield* crypto.randomUUIDv4;
      yield* engine.dispatch({
        type: "thread.activity.append",
        commandId: CommandId.make(`server:thread-machine-activity:${uuid}`),
        threadId,
        activity: {
          id: EventId.make(uuid),
          tone: activity.tone,
          kind: activity.kind,
          summary: activity.summary,
          payload: activity.payload,
          turnId: null,
          createdAt,
        },
        createdAt,
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("failed to record thread machine activity", {
          threadId,
          kind: activity.kind,
          cause: String(cause).slice(0, 300),
        }),
      ),
    );

  /** Project, repository and branch for the directory and the runner. */
  const machineContext = (
    threadId: ThreadId,
    projectId: ProjectId | undefined,
    branch: string | null,
    baseRef: string | null,
  ) =>
    Effect.gen(function* () {
      const resolvedProjectId =
        projectId ??
        Option.getOrUndefined(
          yield* projections.getThreadShellById(threadId).pipe(
            Effect.map(Option.map((thread) => thread.projectId)),
            Effect.orElseSucceed(() => Option.none()),
          ),
        );
      const project = resolvedProjectId
        ? Option.getOrUndefined(
            yield* projections
              .getProjectShellById(resolvedProjectId)
              .pipe(Effect.orElseSucceed(() => Option.none())),
          )
        : undefined;
      const identity = project ? yield* repositoryIdentity.resolve(project.workspaceRoot) : null;
      const repository: ThreadMachineRepository | null = identity
        ? { url: identity.locator.remoteUrl, ref: baseRef }
        : null;
      return {
        projectId: resolvedProjectId ?? null,
        repository,
        branch,
      } satisfies ThreadMachineContext;
    });

  const prepare = (input: {
    readonly threadId: ThreadId;
    readonly projectId: ProjectId | undefined;
    readonly branch: string | null;
    readonly baseRef: string | null;
    readonly announce: boolean;
  }) =>
    Effect.gen(function* () {
      const { threadId } = input;
      const checkout = pool.checkoutFor(threadId);
      const context = yield* machineContext(threadId, input.projectId, input.branch, input.baseRef);
      let announcedStart = false;
      const onWakeProgress = (status: ThreadMachineStatus) =>
        announcedStart
          ? Effect.void
          : Effect.suspend(() => {
              announcedStart = true;
              return appendActivity(threadId, {
                kind: THREAD_MACHINE_ACTIVITY.starting,
                summary: "Starting machine",
                tone: "info",
                payload: { state: status.state, detail: status.detail ?? null },
              });
            });
      return yield* pool.use(
        threadId,
        { wake: true, operation: "checkout.prepare", context, onWakeProgress },
        (connection) =>
          Effect.gen(function* () {
            if (!input.announce && preparedOnBoot.get(threadId) === connection.hello.bootId) {
              return null;
            }
            if (input.announce) {
              yield* appendActivity(threadId, {
                kind: THREAD_MACHINE_ACTIVITY.preparingCheckout,
                summary: "Preparing checkout",
                tone: "info",
                payload: {
                  checkout,
                  branch: input.branch,
                  repository: context.repository?.url ?? null,
                },
              });
            }
            const result = yield* connection.client["runner.checkout.prepare"]({
              threadId,
              checkout,
              repository: context.repository,
              branch: input.branch,
              baseRef: input.baseRef,
            });
            preparedOnBoot.set(threadId, connection.hello.bootId);
            return result;
          }),
      );
    }).pipe(
      Effect.tapError((error) =>
        appendActivity(input.threadId, {
          kind: THREAD_MACHINE_ACTIVITY.failed,
          summary: "Thread machine is unavailable",
          tone: "error",
          payload: { detail: describeCause(error) },
        }),
      ),
    );

  const rewriteClientCommand: HubThreadCheckoutsShape["rewriteClientCommand"] = (command) => {
    switch (command.type) {
      case "project.create":
        return {
          ...command,
          workspaceRoot: projectVirtualRoot(command.projectId),
          createWorkspaceRootIfMissing: false,
        };
      case "project.meta.update": {
        // A hub project's root is virtual; there is no folder to move it to.
        const { workspaceRoot: _workspaceRoot, ...rest } = command;
        return rest;
      }
      case "thread.create":
        return { ...command, worktreePath: pool.checkoutFor(command.threadId) };
      case "thread.turn.start":
        return command.bootstrap?.createThread
          ? {
              ...command,
              bootstrap: {
                ...command.bootstrap,
                createThread: {
                  ...command.bootstrap.createThread,
                  worktreePath: pool.checkoutFor(command.threadId),
                },
              },
            }
          : command;
      default:
        return command;
    }
  };

  return {
    rewriteClientCommand,
    bootstrap: (input) =>
      prepare({ ...input, announce: true }).pipe(
        Effect.map((result) => ({
          worktreePath: pool.checkoutFor(input.threadId),
          branch: result?.branch ?? input.branch,
        })),
        Effect.mapError(
          (error) =>
            new OrchestrationDispatchCommandError({
              message: `Thread machine could not prepare the checkout: ${describeCause(error)}`,
              cause: error,
            }),
        ),
      ),
    ensureForTurn: (thread) =>
      prepare({
        threadId: thread.id,
        projectId: thread.projectId,
        branch: thread.branch,
        baseRef: null,
        announce: false,
      }).pipe(
        Effect.asVoid,
        // The turn proceeds; its session start reports the real failure.
        Effect.catch((error) =>
          Effect.logWarning("thread checkout was not prepared before the turn", {
            threadId: thread.id,
            detail: describeCause(error),
          }),
        ),
      ),
  } satisfies HubThreadCheckoutsShape;
});

export const layer = Layer.effect(HubThreadCheckouts, makeHubThreadCheckouts);
