// @effect-diagnostics nodeBuiltinImport:off -- Attachment bytes are materialized synchronously before the provider reads them.
/**
 * RunnerHandlers - serves `RunnerRpcGroup` for the runner's single thread.
 *
 * Every call is checked against the runner's binding: thread-keyed calls must
 * name `T3CODE_RUNNER_THREAD_ID`, and cwd-keyed calls must stay inside
 * `T3CODE_RUNNER_CHECKOUT`. A misrouted call fails with the RPC's own error
 * type and never touches another path.
 *
 * Provider calls run the real adapters from the runner's provider instance
 * registry; checkout calls run the same services the standalone server uses.
 *
 * @module runner/RunnerHandlers
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  GitCommandError,
  GitManagerError,
  type ChatAttachment,
  type GitManagerServiceError,
  type ProviderInstanceId,
  ProviderSendTurnInput,
  type TerminalAttachStreamEvent,
  type TerminalError,
  TerminalCwdNotFoundError,
  type TerminalEvent,
  type TerminalMetadataStreamEvent,
  TerminalSessionLookupError,
  TextGenerationError,
  ThreadId,
  VcsRepositoryDetectionError,
} from "@t3tools/contracts";
import {
  RUNNER_MIN_PROTOCOL_VERSION,
  RUNNER_PROTOCOL_VERSION,
  type RunnerAttachmentFile,
  RunnerCheckoutError,
  type RunnerGitStackedActionEvent,
  RunnerProtocolMismatchError,
  RunnerRemoteError,
  RunnerRpcGroup,
  RunnerThreadMismatchError,
  runnerProtocolsOverlap,
} from "@t3tools/contracts/runner";
import { resolveServerBackgroundActivitySettings } from "@t3tools/shared/backgroundActivitySettings";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import { ServerConfig } from "../config.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as McpProviderSession from "../mcp/McpProviderSession.ts";
import { ProviderAdapterValidationError } from "../provider/Errors.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import * as ReviewService from "../review/ReviewService.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as VcsProvisioningService from "../vcs/VcsProvisioningService.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { RunnerCheckout } from "./RunnerCheckout.ts";
import { RunnerOutbox } from "./RunnerOutbox.ts";
import { RunnerProviderSettings } from "./RunnerProviderSettings.ts";
import { ProviderAdapterErrorSchema, toRunnerRemoteError } from "./remoteErrors.ts";

const DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL = Duration.minutes(5);

const WorkspaceFileErrorSchema = Schema.Union([
  ...WorkspaceFileSystem.WorkspaceFileSystemError.members,
  WorkspacePaths.WorkspacePathOutsideRootError,
]);

const toProviderRemote = toRunnerRemoteError(ProviderAdapterErrorSchema);
const isTextGenerationError = Schema.is(TextGenerationError);
const toEntriesRemote = toRunnerRemoteError(WorkspaceEntries.WorkspaceEntriesError);
const toFileRemote = toRunnerRemoteError(WorkspaceFileErrorSchema);

export interface RunnerBinding {
  readonly threadId: ThreadId;
  readonly checkout: string;
}

/** Reads the runner's thread binding from its configuration; fails loudly when absent. */
export const resolveRunnerBinding = Effect.gen(function* () {
  const config = yield* ServerConfig;
  if (!config.runnerThreadId || !config.runnerCheckout) {
    return yield* Effect.die(
      new Error("t3 runner requires T3CODE_RUNNER_THREAD_ID and T3CODE_RUNNER_CHECKOUT."),
    );
  }
  if (!NodePath.isAbsolute(config.runnerCheckout)) {
    return yield* Effect.die(new Error("T3CODE_RUNNER_CHECKOUT must be an absolute path."));
  }
  return {
    threadId: ThreadId.make(config.runnerThreadId),
    checkout: NodePath.resolve(config.runnerCheckout),
  } satisfies RunnerBinding;
});

const isWithin = (root: string, candidate: string) => {
  const relative = NodePath.relative(root, NodePath.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !NodePath.isAbsolute(relative));
};

export const RunnerRpcHandlersLive = RunnerRpcGroup.toLayer(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const binding = yield* resolveRunnerBinding;
    const registry = yield* ProviderInstanceRegistry;
    const outbox = yield* RunnerOutbox;
    const runnerCheckout = yield* RunnerCheckout;
    const checkpointStore = yield* CheckpointStore.CheckpointStore;
    const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
    const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
    const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
    const vcsStatus = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
    const vcsProvisioning = yield* VcsProvisioningService.VcsProvisioningService;
    const review = yield* ReviewService.ReviewService;
    const terminals = yield* TerminalManager.TerminalManager;
    const serverSettings = yield* ServerSettingsService;
    const providerSettings = yield* RunnerProviderSettings;

    const automaticGitFetchInterval = serverSettings.getSettings.pipe(
      Effect.map(
        (settings) => resolveServerBackgroundActivitySettings(settings).automaticGitFetchInterval,
      ),
      Effect.orElseSucceed(() => DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL),
    );

    // ── Binding checks, each failing with the RPC's own error type ──────

    const outside = (cwd: string) => !isWithin(binding.checkout, cwd);
    const outsideDetail = (cwd: string) =>
      `${cwd} is outside this runner's checkout ${binding.checkout}.`;
    const guardVcs = <A, E, R>(operation: string, cwd: string, effect: Effect.Effect<A, E, R>) =>
      outside(cwd)
        ? Effect.fail(
            new VcsRepositoryDetectionError({ operation, cwd, detail: outsideDetail(cwd) }),
          )
        : effect;
    const guardGitCommand = <A, E, R>(
      operation: string,
      cwd: string,
      effect: Effect.Effect<A, E, R>,
    ) =>
      outside(cwd)
        ? Effect.fail(
            new GitCommandError({ operation, command: "runner", cwd, detail: outsideDetail(cwd) }),
          )
        : effect;
    const guardGitManager = <A, E, R>(
      operation: string,
      cwd: string,
      effect: Effect.Effect<A, E | GitManagerServiceError, R>,
    ): Effect.Effect<A, E | GitManagerServiceError, R> =>
      outside(cwd)
        ? Effect.fail(new GitManagerError({ operation, cwd, detail: outsideDetail(cwd) }))
        : effect;
    const guardTerminal = <A, E, R>(
      input: {
        readonly threadId: string;
        readonly terminalId?: string | undefined;
        readonly cwd?: string | undefined;
      },
      effect: Effect.Effect<A, E | TerminalError, R>,
    ): Effect.Effect<A, E | TerminalError, R> => {
      if (input.threadId !== binding.threadId) {
        return Effect.fail(
          new TerminalSessionLookupError({
            threadId: input.threadId,
            terminalId: input.terminalId ?? "*",
          }),
        );
      }
      if (input.cwd !== undefined && outside(input.cwd)) {
        // The checkout is the only directory this runner opens terminals in.
        return Effect.fail(new TerminalCwdNotFoundError({ cwd: input.cwd }));
      }
      return effect;
    };
    const guardThread = (method: string, threadId: string) =>
      threadId === binding.threadId
        ? Effect.void
        : Effect.fail(
            toProviderRemote(
              new ProviderAdapterValidationError({
                provider: "runner",
                operation: method,
                issue: `This runner serves thread '${binding.threadId}', not '${threadId}'.`,
              }),
            ),
          );
    const guardRemote = (operation: string, cwd: string) =>
      outside(cwd)
        ? Effect.fail(
            new RunnerRemoteError({
              errorTag: "RunnerCwdOutsideCheckoutError",
              detail: `${operation}: ${outsideDetail(cwd)}`,
              encoded: null,
            }),
          )
        : Effect.void;

    // ── Provider instances ──────────────────────────────────────────────

    const instanceOf = (instanceId: ProviderInstanceId, operation: string) =>
      registry.getInstance(instanceId).pipe(
        Effect.flatMap((instance) =>
          instance
            ? Effect.succeed(instance)
            : Effect.fail(
                toProviderRemote(
                  new ProviderAdapterValidationError({
                    provider: String(instanceId),
                    operation,
                    issue: `This runner does not host provider instance '${instanceId}'.`,
                  }),
                ),
              ),
        ),
      );
    const withAdapter = <A>(
      instanceId: ProviderInstanceId,
      operation: string,
      use: (
        adapter: Effect.Success<ReturnType<typeof instanceOf>>["adapter"],
      ) => Effect.Effect<A, Schema.Schema.Type<typeof ProviderAdapterErrorSchema>>,
    ) =>
      instanceOf(instanceId, operation).pipe(
        Effect.flatMap((instance) => use(instance.adapter).pipe(Effect.mapError(toProviderRemote))),
      );

    /** Logs a state-changing call with its outcome and duration. */
    const logged = <A, E, R>(
      method: string,
      attributes: Record<string, unknown>,
      effect: Effect.Effect<A, E, R>,
    ) =>
      Effect.gen(function* () {
        const startedAt = yield* Clock.currentTimeMillis;
        const exit = yield* Effect.exit(effect);
        yield* Effect.logInfo(`runner rpc ${method}`, {
          ...attributes,
          ok: exit._tag === "Success",
          ms: (yield* Clock.currentTimeMillis) - startedAt,
        });
        return yield* exit;
      });

    // ── Attachments ─────────────────────────────────────────────────────

    /**
     * Writes shipped attachment bytes where this runner's adapters read them
     * and returns the prompt with the hub's attachment paths replaced.
     */
    const materializeAttachments = (files: ReadonlyArray<RunnerAttachmentFile>, text?: string) =>
      Effect.sync(() => {
        let rewritten = text;
        const attachments: Array<ChatAttachment> = [];
        for (const file of files) {
          const localPath = resolveAttachmentPath({
            attachmentsDir: config.attachmentsDir,
            attachment: file.attachment,
          });
          if (localPath === null) continue;
          NodeFS.mkdirSync(NodePath.dirname(localPath), { recursive: true });
          NodeFS.writeFileSync(localPath, Buffer.from(file.bytesBase64, "base64"), {
            mode: 0o600,
          });
          attachments.push(file.attachment);
          if (rewritten !== undefined) rewritten = rewritten.replaceAll(file.hubPath, localPath);
        }
        return { attachments, text: rewritten };
      });

    const toTextGenerationError = (operation: string) => (cause: unknown) =>
      isTextGenerationError(cause)
        ? cause
        : new TextGenerationError({
            operation,
            detail:
              cause && typeof cause === "object" && "message" in cause
                ? String((cause as { readonly message: unknown }).message)
                : String(cause),
          });
    const textGenerationOf = (instanceId: ProviderInstanceId, operation: string) =>
      instanceOf(instanceId, operation).pipe(
        Effect.map((instance) => instance.textGeneration),
        Effect.mapError(toTextGenerationError(operation)),
      );

    const decodeSendTurnInput = Schema.decodeUnknownEffect(ProviderSendTurnInput);

    return RunnerRpcGroup.of({
      "runner.hello": (input) =>
        Effect.gen(function* () {
          if (
            !runnerProtocolsOverlap({
              runnerProtocolVersion: RUNNER_PROTOCOL_VERSION,
              runnerMinProtocolVersion: RUNNER_MIN_PROTOCOL_VERSION,
              hubProtocolVersion: input.protocolVersion,
              hubMinProtocolVersion: input.minProtocolVersion,
            })
          ) {
            return yield* new RunnerProtocolMismatchError({
              runnerProtocolVersion: RUNNER_PROTOCOL_VERSION,
              runnerMinProtocolVersion: RUNNER_MIN_PROTOCOL_VERSION,
              hubProtocolVersion: input.protocolVersion,
              hubMinProtocolVersion: input.minProtocolVersion,
            });
          }
          if (input.threadId !== binding.threadId) {
            return yield* new RunnerThreadMismatchError({
              requestedThreadId: input.threadId,
              runnerThreadId: binding.threadId,
            });
          }
          const stats = yield* outbox.stats;
          const instances = yield* registry.listInstances;
          return {
            protocolVersion: Math.min(RUNNER_PROTOCOL_VERSION, input.protocolVersion),
            runnerId: stats.runnerId,
            bootId: stats.bootId,
            threadId: binding.threadId,
            checkout: binding.checkout,
            headSequence: stats.headSequence,
            ackedSequence: stats.ackedSequence,
            firstRetainedSequence: stats.firstRetainedSequence,
            instances: instances.map((instance) => instance.instanceId),
          };
        }),

      // ── Provider sessions ────────────────────────────────────────────
      // Only instance ids are logged; the settings carry secrets.
      "runner.provider.configure": ({ instances }) =>
        logged(
          "configure",
          { instances: Object.keys(instances) },
          providerSettings.apply(instances).pipe(Effect.map((hosted) => ({ instances: hosted }))),
        ),
      "runner.provider.startSession": ({ instanceId, input, mcp }) =>
        guardThread("startSession", input.threadId).pipe(
          Effect.andThen(
            Effect.sync(() =>
              mcp === null
                ? McpProviderSession.clearMcpProviderSession(input.threadId)
                : McpProviderSession.setMcpProviderSession(mcp),
            ),
          ),
          Effect.andThen(
            logged(
              "startSession",
              {
                threadId: input.threadId,
                cwd: input.cwd,
                resume: input.resumeCursor !== undefined,
              },
              withAdapter(instanceId, "startSession", (adapter) => adapter.startSession(input)),
            ),
          ),
        ),
      "runner.provider.sendTurn": ({ instanceId, input, attachments }) =>
        guardThread("sendTurn", input.threadId).pipe(
          Effect.andThen(materializeAttachments(attachments, input.input)),
          Effect.flatMap((materialized) =>
            decodeSendTurnInput({
              ...input,
              ...(materialized.text !== undefined ? { input: materialized.text } : {}),
              ...(input.attachments !== undefined ? { attachments: materialized.attachments } : {}),
            }).pipe(
              Effect.mapError((cause) =>
                toProviderRemote(
                  new ProviderAdapterValidationError({
                    provider: String(instanceId),
                    operation: "sendTurn",
                    issue: `Rewritten turn input is invalid: ${cause.message}`,
                  }),
                ),
              ),
            ),
          ),
          Effect.flatMap((turnInput) =>
            logged(
              "sendTurn",
              { threadId: input.threadId, attachments: attachments.length },
              withAdapter(instanceId, "sendTurn", (adapter) => adapter.sendTurn(turnInput)),
            ),
          ),
        ),
      "runner.provider.interruptTurn": ({ instanceId, threadId, turnId }) =>
        guardThread("interruptTurn", threadId).pipe(
          Effect.andThen(
            logged(
              "interruptTurn",
              { threadId, turnId },
              withAdapter(instanceId, "interruptTurn", (adapter) =>
                adapter.interruptTurn(threadId, turnId),
              ),
            ),
          ),
        ),
      "runner.provider.respondToRequest": ({ instanceId, threadId, requestId, decision }) =>
        guardThread("respondToRequest", threadId).pipe(
          Effect.andThen(
            logged(
              "respondToRequest",
              { threadId, requestId, decision },
              withAdapter(instanceId, "respondToRequest", (adapter) =>
                adapter.respondToRequest(threadId, requestId, decision),
              ),
            ),
          ),
        ),
      "runner.provider.respondToUserInput": ({ instanceId, threadId, requestId, answers }) =>
        guardThread("respondToUserInput", threadId).pipe(
          Effect.andThen(
            withAdapter(instanceId, "respondToUserInput", (adapter) =>
              adapter.respondToUserInput(threadId, requestId, answers),
            ),
          ),
        ),
      "runner.provider.stopSession": ({ instanceId, threadId }) =>
        guardThread("stopSession", threadId).pipe(
          Effect.andThen(
            logged(
              "stopSession",
              { threadId },
              withAdapter(instanceId, "stopSession", (adapter) => adapter.stopSession(threadId)),
            ),
          ),
        ),
      "runner.provider.listSessions": ({ instanceId }) =>
        withAdapter(instanceId, "listSessions", (adapter) => adapter.listSessions()),
      "runner.provider.readThread": ({ instanceId, threadId }) =>
        guardThread("readThread", threadId).pipe(
          Effect.andThen(
            withAdapter(instanceId, "readThread", (adapter) => adapter.readThread(threadId)),
          ),
        ),
      "runner.provider.rollbackThread": ({ instanceId, threadId, numTurns }) =>
        guardThread("rollbackThread", threadId).pipe(
          Effect.andThen(
            withAdapter(instanceId, "rollbackThread", (adapter) =>
              adapter.rollbackThread(threadId, numTurns),
            ),
          ),
        ),
      "runner.provider.getCapabilities": ({ instanceId, refresh }) =>
        instanceOf(instanceId, "getCapabilities").pipe(
          Effect.flatMap((instance) =>
            (refresh ? instance.snapshot.refresh : instance.snapshot.getSnapshot).pipe(
              Effect.map((snapshot) => ({
                snapshot,
                sessionModelSwitch: instance.adapter.capabilities.sessionModelSwitch,
              })),
            ),
          ),
        ),

      // ── Text generation ──────────────────────────────────────────────
      "runner.text.generateThreadTitle": ({ instanceId, attachments, ...request }) =>
        (outside(request.cwd)
          ? Effect.fail(
              new TextGenerationError({
                operation: "generateThreadTitle",
                detail: outsideDetail(request.cwd),
              }),
            )
          : Effect.void
        ).pipe(
          Effect.andThen(materializeAttachments(attachments)),
          Effect.flatMap((materialized) =>
            logged(
              "text.generateThreadTitle",
              { model: request.modelSelection.model },
              textGenerationOf(instanceId, "generateThreadTitle").pipe(
                Effect.flatMap((textGeneration) =>
                  textGeneration.generateThreadTitle({
                    ...request,
                    ...(materialized.attachments.length > 0
                      ? { attachments: materialized.attachments }
                      : {}),
                  }),
                ),
              ),
            ),
          ),
        ),
      "runner.text.generateBranchName": ({ instanceId, attachments, ...request }) =>
        (outside(request.cwd)
          ? Effect.fail(
              new TextGenerationError({
                operation: "generateBranchName",
                detail: outsideDetail(request.cwd),
              }),
            )
          : Effect.void
        ).pipe(
          Effect.andThen(materializeAttachments(attachments)),
          Effect.flatMap((materialized) =>
            textGenerationOf(instanceId, "generateBranchName").pipe(
              Effect.flatMap((textGeneration) =>
                textGeneration.generateBranchName({
                  ...request,
                  ...(materialized.attachments.length > 0
                    ? { attachments: materialized.attachments }
                    : {}),
                }),
              ),
            ),
          ),
        ),

      // ── Event outbox ─────────────────────────────────────────────────
      "runner.events.subscribe": ({ afterSequence }) => outbox.subscribe(afterSequence),
      "runner.events.ack": ({ throughSequence }) => outbox.ack(throughSequence),

      // ── Checkout ─────────────────────────────────────────────────────
      "runner.checkout.prepare": (input) =>
        input.threadId !== binding.threadId || NodePath.resolve(input.checkout) !== binding.checkout
          ? Effect.fail(
              new RunnerCheckoutError({
                operation: "validate",
                checkout: input.checkout,
                detail: `This runner serves thread '${binding.threadId}' at ${binding.checkout}.`,
              }),
            )
          : logged(
              "checkout.prepare",
              { branch: input.branch, baseRef: input.baseRef, repository: input.repository?.url },
              runnerCheckout.prepare(input),
            ),

      // ── Checkpoints ──────────────────────────────────────────────────
      "runner.checkpoint.isGitRepository": ({ cwd }) =>
        guardVcs("isGitRepository", cwd, checkpointStore.isGitRepository(cwd)),
      "runner.checkpoint.capture": (input) =>
        guardVcs(
          "captureCheckpoint",
          input.cwd,
          logged(
            "checkpoint.capture",
            { checkpointRef: input.checkpointRef },
            checkpointStore.captureCheckpoint(input),
          ),
        ),
      "runner.checkpoint.hasRef": (input) =>
        guardVcs("hasCheckpointRef", input.cwd, checkpointStore.hasCheckpointRef(input)),
      "runner.checkpoint.restore": ({ cwd, checkpointRef, fallbackToHead }) =>
        guardVcs(
          "restoreCheckpoint",
          cwd,
          checkpointStore.restoreCheckpoint({
            cwd,
            checkpointRef,
            ...(fallbackToHead !== undefined ? { fallbackToHead } : {}),
          }),
        ),
      "runner.checkpoint.diff": ({ fallbackFromToHead, ...input }) =>
        guardVcs(
          "diffCheckpoints",
          input.cwd,
          checkpointStore.diffCheckpoints({
            ...input,
            ...(fallbackFromToHead !== undefined ? { fallbackFromToHead } : {}),
          }),
        ),
      "runner.checkpoint.deleteRefs": (input) =>
        guardVcs("deleteCheckpointRefs", input.cwd, checkpointStore.deleteCheckpointRefs(input)),

      // ── Workspace files ──────────────────────────────────────────────
      "runner.workspace.listEntries": (input) =>
        guardRemote("listEntries", input.cwd).pipe(
          Effect.andThen(workspaceEntries.list(input).pipe(Effect.mapError(toEntriesRemote))),
        ),
      "runner.workspace.searchEntries": (input) =>
        guardRemote("searchEntries", input.cwd).pipe(
          Effect.andThen(workspaceEntries.search(input).pipe(Effect.mapError(toEntriesRemote))),
        ),
      "runner.workspace.searchContents": (input) =>
        guardRemote("searchContents", input.cwd).pipe(
          Effect.andThen(
            workspaceEntries.searchContents(input).pipe(Effect.mapError(toEntriesRemote)),
          ),
        ),
      "runner.workspace.readFile": (input) =>
        guardRemote("readFile", input.cwd).pipe(
          Effect.andThen(workspaceFileSystem.readFile(input).pipe(Effect.mapError(toFileRemote))),
        ),
      "runner.workspace.writeFile": (input) =>
        guardRemote("writeFile", input.cwd).pipe(
          Effect.andThen(
            logged(
              "workspace.writeFile",
              { relativePath: input.relativePath },
              workspaceFileSystem.writeFile(input).pipe(Effect.mapError(toFileRemote)),
            ),
          ),
        ),
      "runner.workspace.refreshIndex": ({ cwd }) =>
        outside(cwd) ? Effect.void : workspaceEntries.refresh(cwd),

      // ── VCS and git ──────────────────────────────────────────────────
      "runner.vcs.status": (input) =>
        guardGitManager("status", input.cwd, vcsStatus.getStatus(input)),
      "runner.vcs.localStatus": (input) =>
        guardGitManager("localStatus", input.cwd, gitWorkflow.localStatus(input)),
      "runner.vcs.remoteStatus": (input) =>
        guardGitManager("remoteStatus", input.cwd, gitWorkflow.remoteStatus(input)),
      "runner.vcs.refreshStatus": ({ cwd }) =>
        guardGitManager("refreshStatus", cwd, vcsStatus.refreshStatus(cwd)),
      "runner.vcs.refreshLocalStatus": ({ cwd }) =>
        guardGitManager("refreshLocalStatus", cwd, vcsStatus.refreshLocalStatus(cwd)),
      "runner.vcs.streamStatus": (input) =>
        outside(input.cwd)
          ? Stream.fail(
              new GitManagerError({
                operation: "streamStatus",
                cwd: input.cwd,
                detail: outsideDetail(input.cwd),
              }),
            )
          : vcsStatus.streamStatus(input, {
              automaticRemoteRefreshInterval: automaticGitFetchInterval,
            }),
      "runner.vcs.init": (input) =>
        guardVcs("initRepository", input.cwd, vcsProvisioning.initRepository(input)),
      "runner.git.pull": ({ cwd }) =>
        guardGitCommand("pull", cwd, logged("git.pull", {}, gitWorkflow.pullCurrentBranch(cwd))),
      "runner.git.runStackedAction": (input) =>
        outside(input.cwd)
          ? Stream.fail(
              new GitManagerError({
                operation: "runStackedAction",
                cwd: input.cwd,
                detail: outsideDetail(input.cwd),
              }),
            )
          : Stream.callback<RunnerGitStackedActionEvent, GitManagerServiceError>((queue) =>
              gitWorkflow
                .runStackedAction(input, {
                  actionId: input.actionId,
                  progressReporter: {
                    publish: (event) =>
                      Queue.offer(queue, { _tag: "progress", event }).pipe(Effect.asVoid),
                  },
                })
                .pipe(
                  Effect.matchCauseEffect({
                    onFailure: (cause) => Queue.failCause(queue, cause),
                    onSuccess: (result) =>
                      Queue.offer(queue, { _tag: "result", result }).pipe(
                        Effect.andThen(Queue.end(queue)),
                      ),
                  }),
                ),
            ),
      "runner.git.resolvePullRequest": (input) =>
        guardGitManager("resolvePullRequest", input.cwd, gitWorkflow.resolvePullRequest(input)),
      "runner.git.preparePullRequestThread": (input) =>
        guardGitManager(
          "preparePullRequestThread",
          input.cwd,
          gitWorkflow.preparePullRequestThread(input),
        ),
      "runner.git.listRefs": (input) =>
        guardGitCommand("listRefs", input.cwd, gitWorkflow.listRefs(input)),
      "runner.git.createWorktree": (input) =>
        guardGitCommand("createWorktree", input.cwd, gitWorkflow.createWorktree(input)),
      "runner.git.removeWorktree": (input) =>
        guardGitCommand("removeWorktree", input.cwd, gitWorkflow.removeWorktree(input)),
      "runner.git.pruneWorktrees": (input) =>
        guardGitCommand("pruneWorktrees", input.cwd, gitWorkflow.pruneWorktrees(input)),
      "runner.git.createRef": (input) =>
        guardGitCommand("createRef", input.cwd, gitWorkflow.createRef(input)),
      "runner.git.switchRef": (input) =>
        guardGitCommand("switchRef", input.cwd, gitWorkflow.switchRef(input)),
      "runner.git.renameBranch": (input) =>
        guardGitManager("renameBranch", input.cwd, gitWorkflow.renameBranch(input)),
      "runner.git.fetchRemote": (input) =>
        guardGitCommand("fetchRemote", input.cwd, gitWorkflow.fetchRemote(input)),
      "runner.git.remoteExists": (input) =>
        guardGitCommand("remoteExists", input.cwd, gitWorkflow.remoteExists(input)),
      "runner.git.resolveRemoteTrackingCommit": (input) =>
        guardGitCommand(
          "resolveRemoteTrackingCommit",
          input.cwd,
          gitWorkflow.resolveRemoteTrackingCommit(input),
        ),

      // ── Review ───────────────────────────────────────────────────────
      "runner.review.getDiffPreview": (input) =>
        guardVcs("getDiffPreview", input.cwd, review.getDiffPreview(input)),
      "runner.review.getDiffFileContents": (input) =>
        guardVcs("getDiffFileContents", input.cwd, review.getDiffFileContents(input)),

      // ── Terminals ────────────────────────────────────────────────────
      "runner.terminal.open": (input) => guardTerminal(input, terminals.open(input)),
      "runner.terminal.attach": (input) =>
        input.threadId !== binding.threadId
          ? Stream.fail(
              new TerminalSessionLookupError({
                threadId: input.threadId,
                terminalId: input.terminalId,
              }),
            )
          : Stream.callback<TerminalAttachStreamEvent, TerminalError>((queue) =>
              Effect.acquireRelease(
                terminals.attachStream(input, (event) => Queue.offer(queue, event)),
                (unsubscribe) => Effect.sync(unsubscribe),
              ),
            ),
      "runner.terminal.write": (input) => guardTerminal(input, terminals.write(input)),
      "runner.terminal.resize": (input) => guardTerminal(input, terminals.resize(input)),
      "runner.terminal.clear": (input) => guardTerminal(input, terminals.clear(input)),
      "runner.terminal.restart": (input) => guardTerminal(input, terminals.restart(input)),
      "runner.terminal.close": (input) => guardTerminal(input, terminals.close(input)),
      "runner.terminal.events": () =>
        Stream.callback<TerminalEvent>((queue) =>
          Effect.acquireRelease(
            terminals.subscribe((event) => Queue.offer(queue, event)),
            (unsubscribe) => Effect.sync(unsubscribe),
          ),
        ),
      "runner.terminal.metadata": () =>
        Stream.callback<TerminalMetadataStreamEvent>((queue) =>
          Effect.acquireRelease(
            terminals.subscribeMetadata((event) => Queue.offer(queue, event)),
            (unsubscribe) => Effect.sync(unsubscribe),
          ),
        ),
    });
  }),
);
