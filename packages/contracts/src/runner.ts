/**
 * Runner protocol: the contract between a hub and a thread machine's runner.
 *
 * A hub (`T3CODE_SERVER_MODE=hub`) owns orchestration, projections and the
 * provider session directory but no checkout. Each thread's work runs on its
 * own machine, where `t3 runner` serves this RPC group for exactly one thread
 * over one authenticated WebSocket at `RUNNER_WS_PATH`.
 *
 * The protocol is versioned independently of the client protocol. The hub
 * sends its supported range in `runner.hello`; a runner outside that range, or
 * one bound to a different thread, refuses the handshake with a typed error.
 *
 * Payloads and results reuse the client contract schemas, so a routed call has
 * exactly the shape the in-process service already uses. Errors that already
 * have a contract schema (VCS, git, terminal, review, text generation) cross
 * the wire unchanged. Server-internal error unions (provider adapter and
 * workspace errors) travel inside `RunnerRemoteError`, encoded with the
 * server's own schema; hub and runner run the same build for a protocol
 * version, so the hub decodes them back to the original class.
 *
 * See docs/internals/thread-machines.md.
 *
 * @module runner
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import {
  ApprovalRequestId,
  CheckpointRef,
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";
import {
  GitActionProgressEvent,
  GitCommandError,
  GitManagerServiceError,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullRequestRefInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  GitRunStackedActionResult,
  TextGenerationError,
  VcsCreateRefInput,
  VcsCreateRefResult,
  VcsCreateWorktreeInput,
  VcsCreateWorktreeResult,
  VcsInitInput,
  VcsListRefsInput,
  VcsListRefsResult,
  VcsPullResult,
  VcsRemoveWorktreeInput,
  VcsStatusInput,
  VcsStatusLocalResult,
  VcsStatusRemoteResult,
  VcsStatusResult,
  VcsStatusStreamEvent,
  VcsSwitchRefInput,
  VcsSwitchRefResult,
} from "./git.ts";
import {
  ChatAttachment,
  ModelSelection,
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
} from "./orchestration.ts";
import {
  ProjectListEntriesInput,
  ProjectListEntriesResult,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectSearchContentsInput,
  ProjectSearchContentsResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project.ts";
import {
  ProviderSendTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
  ProviderTurnStartResult,
} from "./provider.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { ThreadMachineState } from "./threadMachine.ts";
import { ProviderRuntimeEvent } from "./providerRuntime.ts";
import {
  ReviewDiffFileContentsInput,
  ReviewDiffFileContentsResult,
  ReviewDiffPreviewError,
  ReviewDiffPreviewInput,
  ReviewDiffPreviewResult,
} from "./review.ts";
import { ServerProvider } from "./server.ts";
import {
  TerminalAttachInput,
  TerminalAttachStreamEvent,
  TerminalClearInput,
  TerminalCloseInput,
  TerminalError,
  TerminalEvent,
  TerminalMetadataStreamEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal.ts";
import { VcsError } from "./vcs.ts";

/** Current runner protocol version. Bump when an RPC changes incompatibly. */
export const RUNNER_PROTOCOL_VERSION = 1;
/** Oldest protocol version this build still speaks. */
export const RUNNER_MIN_PROTOCOL_VERSION = 1;
export const RUNNER_WS_PATH = "/runner/ws";

// ── Checkout paths ─────────────────────────────────────────────────────

/** Default root of per-thread checkouts on thread machines. */
export const THREAD_CHECKOUT_ROOT = "/workspace/t";
/** Root of the virtual project roots a hub assigns; nothing reads them. */
export const PROJECT_VIRTUAL_ROOT = "/workspace/p";

const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, "");

/** Thread ids are opaque; encode them so each is exactly one safe path segment. */
function encodePathSegment(value: string): string {
  const encoded = encodeURIComponent(value);
  return encoded === "." || encoded === ".." ? encoded.replaceAll(".", "%2E") : encoded;
}

function decodePathSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The checkout path of a thread: `<root>/<threadId>`. */
export function threadCheckoutPath(threadId: string, root: string = THREAD_CHECKOUT_ROOT): string {
  return `${trimTrailingSlashes(root)}/${encodePathSegment(threadId)}`;
}

/** The virtual workspace root of a project in hub mode. */
export function projectVirtualRoot(projectId: string): string {
  return `${PROJECT_VIRTUAL_ROOT}/${encodePathSegment(projectId)}`;
}

/**
 * The thread whose checkout contains `path`, or null when the path is not
 * inside `<root>/<threadId>`. Paths inside the checkout (`<root>/<id>/src`)
 * resolve to the same thread; `.` and `..` segments are rejected rather than
 * normalized, so a path can never escape into another thread's checkout.
 */
export function parseThreadCheckoutPath(
  path: string,
  root: string = THREAD_CHECKOUT_ROOT,
): ThreadId | null {
  const prefix = `${trimTrailingSlashes(root)}/`;
  if (!path.startsWith(prefix)) return null;
  const segments = path.slice(prefix.length).split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) return null;
  const [threadSegment = ""] = segments;
  if (threadSegment.length === 0) return null;
  const threadId = decodePathSegment(threadSegment);
  if (threadId === null || threadId.trim().length === 0 || threadId !== threadId.trim()) {
    return null;
  }
  return ThreadId.make(threadId);
}

// ── Thread machine directory ───────────────────────────────────────────

/** Lifecycle state reported by the machine directory (shared with thread shells). */
export { ThreadMachineState } from "./threadMachine.ts";

/** Repository a new thread machine checks out, from the project's identity. */
export const ThreadMachineRepository = Schema.Struct({
  url: TrimmedNonEmptyString,
  ref: Schema.NullOr(TrimmedNonEmptyString),
});
export type ThreadMachineRepository = typeof ThreadMachineRepository.Type;

/** `POST /threads/{threadId}/machine` body. */
export const ThreadMachineEnsureRequest = Schema.Struct({
  projectId: Schema.NullOr(ProjectId),
  repository: Schema.NullOr(ThreadMachineRepository),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  checkout: TrimmedNonEmptyString,
  wake: Schema.Boolean,
});
export type ThreadMachineEnsureRequest = typeof ThreadMachineEnsureRequest.Type;

export const ThreadMachineRunnerEndpoint = Schema.Struct({
  url: TrimmedNonEmptyString,
  token: TrimmedNonEmptyString,
  expiresAt: Schema.optional(Schema.NullOr(IsoDateTime)),
});
export type ThreadMachineRunnerEndpoint = typeof ThreadMachineRunnerEndpoint.Type;

/** Machine directory response for `POST` and `GET`. */
export const ThreadMachineStatus = Schema.Struct({
  state: ThreadMachineState,
  runner: Schema.optional(Schema.NullOr(ThreadMachineRunnerEndpoint)),
  bootId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  detail: Schema.optional(Schema.NullOr(Schema.String)),
});
export type ThreadMachineStatus = typeof ThreadMachineStatus.Type;

export const ThreadMachineUnavailableReason = Schema.Literals([
  /** The machine is paused, saved, or not created, and the call must not wake it. */
  "asleep",
  /** Waking did not reach `running` in time. */
  "wake-timeout",
  /** The directory reports the machine failed. */
  "failed",
  /** The machine was released (thread archived or deleted). */
  "released",
  /** The machine is running but its runner could not be reached. */
  "unreachable",
  /** The runner speaks an incompatible protocol or serves another thread. */
  "incompatible",
  /** The machine directory itself failed or is not configured. */
  "directory",
  /** The path does not name a thread checkout, so no machine owns it. */
  "not-a-thread-checkout",
]);
export type ThreadMachineUnavailableReason = typeof ThreadMachineUnavailableReason.Type;

/**
 * A thread's machine cannot serve a call right now. `asleep` is the typed
 * "machine asleep" result for reads that never wake a machine; clients can
 * render it as a resumable state rather than as a failure.
 */
export class ThreadMachineUnavailableError extends Schema.TaggedErrorClass<ThreadMachineUnavailableError>()(
  "ThreadMachineUnavailableError",
  {
    threadId: Schema.NullOr(ThreadId),
    reason: ThreadMachineUnavailableReason,
    state: Schema.optional(ThreadMachineState),
    operation: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    const subject =
      this.threadId === null ? "No thread machine" : `Thread machine ${this.threadId}`;
    return `${subject} is unavailable for ${this.operation} (${this.reason}): ${this.detail}`;
  }
}

const isThreadMachineUnavailableError = Schema.is(ThreadMachineUnavailableError);

export const isThreadMachineAsleep = (error: unknown): boolean =>
  isThreadMachineUnavailableError(error) && error.reason === "asleep";

/** A feature that has no hub-mode implementation. Never falls back to the hub's disk. */
export class HubModeUnsupportedError extends Schema.TaggedErrorClass<HubModeUnsupportedError>()(
  "HubModeUnsupportedError",
  {
    operation: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `${this.operation} is not available on a hub: ${this.detail}`;
  }
}

// ── Handshake ──────────────────────────────────────────────────────────

export const RunnerHelloInput = Schema.Struct({
  protocolVersion: NonNegativeInt,
  minProtocolVersion: NonNegativeInt,
  threadId: ThreadId,
});
export type RunnerHelloInput = typeof RunnerHelloInput.Type;

export const RunnerHello = Schema.Struct({
  protocolVersion: NonNegativeInt,
  /** Stable for the runner's state disk; its outbox sequences belong to it. */
  runnerId: TrimmedNonEmptyString,
  /** Changes on every runner process start. */
  bootId: TrimmedNonEmptyString,
  threadId: ThreadId,
  checkout: TrimmedNonEmptyString,
  /** Highest sequence ever appended to the outbox (0 when empty). */
  headSequence: NonNegativeInt,
  /** Highest sequence the hub has acknowledged. */
  ackedSequence: NonNegativeInt,
  /** Lowest retained sequence; events below it past `ackedSequence` were dropped. */
  firstRetainedSequence: NonNegativeInt,
  instances: Schema.Array(ProviderInstanceId),
});
export type RunnerHello = typeof RunnerHello.Type;

export class RunnerProtocolMismatchError extends Schema.TaggedErrorClass<RunnerProtocolMismatchError>()(
  "RunnerProtocolMismatchError",
  {
    runnerProtocolVersion: NonNegativeInt,
    runnerMinProtocolVersion: NonNegativeInt,
    hubProtocolVersion: NonNegativeInt,
    hubMinProtocolVersion: NonNegativeInt,
  },
) {
  override get message(): string {
    return `Runner protocol ${this.runnerMinProtocolVersion}-${this.runnerProtocolVersion} does not overlap hub protocol ${this.hubMinProtocolVersion}-${this.hubProtocolVersion}.`;
  }
}

export class RunnerThreadMismatchError extends Schema.TaggedErrorClass<RunnerThreadMismatchError>()(
  "RunnerThreadMismatchError",
  {
    requestedThreadId: Schema.String,
    runnerThreadId: Schema.String,
  },
) {
  override get message(): string {
    return `Runner serves thread ${this.runnerThreadId}, not ${this.requestedThreadId}.`;
  }
}

/** A cwd outside the runner's checkout; the runner never serves other paths. */
export class RunnerCwdOutsideCheckoutError extends Schema.TaggedErrorClass<RunnerCwdOutsideCheckoutError>()(
  "RunnerCwdOutsideCheckoutError",
  {
    cwd: Schema.String,
    checkout: Schema.String,
    operation: Schema.String,
  },
) {
  override get message(): string {
    return `${this.operation}: ${this.cwd} is outside the runner checkout ${this.checkout}.`;
  }
}

/**
 * A server-internal error forwarded from the runner, encoded with the
 * server's own schema for that error union. `errorTag` and `message` stay
 * readable when the hub cannot decode `encoded`.
 */
export class RunnerRemoteError extends Schema.TaggedErrorClass<RunnerRemoteError>()(
  "RunnerRemoteError",
  {
    errorTag: Schema.String,
    detail: Schema.String,
    encoded: Schema.Unknown,
  },
) {
  override get message(): string {
    return `Runner error ${this.errorTag}: ${this.detail}`;
  }
}

export class RunnerCheckoutError extends Schema.TaggedErrorClass<RunnerCheckoutError>()(
  "RunnerCheckoutError",
  {
    operation: Schema.String,
    checkout: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Preparing checkout ${this.checkout} failed in ${this.operation}: ${this.detail}`;
  }
}

// ── Events ─────────────────────────────────────────────────────────────

export const RunnerEventEnvelope = Schema.Struct({
  sequence: NonNegativeInt,
  /** Boot of the runner process that appended the event. */
  bootId: TrimmedNonEmptyString,
  event: ProviderRuntimeEvent,
});
export type RunnerEventEnvelope = typeof RunnerEventEnvelope.Type;

// ── Provider sessions ──────────────────────────────────────────────────

/** The hub-minted MCP credential and the hub's public MCP endpoint for a session. */
export const RunnerMcpSession = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
  providerSessionId: TrimmedNonEmptyString,
  providerInstanceId: ProviderInstanceId,
  endpoint: TrimmedNonEmptyString,
  authorizationHeader: TrimmedNonEmptyString,
});
export type RunnerMcpSession = typeof RunnerMcpSession.Type;

/**
 * Attachment bytes shipped with a turn. The runner writes them into its own
 * attachment store and replaces `hubPath` in the prompt with its local path.
 */
export const RunnerAttachmentFile = Schema.Struct({
  attachment: ChatAttachment,
  hubPath: TrimmedNonEmptyString,
  bytesBase64: Schema.String,
});
export type RunnerAttachmentFile = typeof RunnerAttachmentFile.Type;

export const RunnerThreadSnapshot = Schema.Struct({
  threadId: ThreadId,
  turns: Schema.Array(Schema.Struct({ id: TurnId, items: Schema.Array(Schema.Unknown) })),
});
export type RunnerThreadSnapshot = typeof RunnerThreadSnapshot.Type;

const InstanceScoped = { instanceId: ProviderInstanceId } as const;
const CwdScoped = { cwd: TrimmedNonEmptyString } as const;

export const RunnerHelloRpc = Rpc.make("runner.hello", {
  payload: RunnerHelloInput,
  success: RunnerHello,
  error: Schema.Union([RunnerProtocolMismatchError, RunnerThreadMismatchError]),
});

export const RunnerStartSessionRpc = Rpc.make("runner.provider.startSession", {
  payload: Schema.Struct({
    ...InstanceScoped,
    input: ProviderSessionStartInput,
    mcp: Schema.NullOr(RunnerMcpSession),
  }),
  success: ProviderSession,
  error: RunnerRemoteError,
});

export const RunnerSendTurnRpc = Rpc.make("runner.provider.sendTurn", {
  payload: Schema.Struct({
    ...InstanceScoped,
    input: ProviderSendTurnInput,
    attachments: Schema.Array(RunnerAttachmentFile),
  }),
  success: ProviderTurnStartResult,
  error: RunnerRemoteError,
});

export const RunnerInterruptTurnRpc = Rpc.make("runner.provider.interruptTurn", {
  payload: Schema.Struct({
    ...InstanceScoped,
    threadId: ThreadId,
    turnId: Schema.optional(TurnId),
  }),
  error: RunnerRemoteError,
});

export const RunnerRespondToRequestRpc = Rpc.make("runner.provider.respondToRequest", {
  payload: Schema.Struct({
    ...InstanceScoped,
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  }),
  error: RunnerRemoteError,
});

export const RunnerRespondToUserInputRpc = Rpc.make("runner.provider.respondToUserInput", {
  payload: Schema.Struct({
    ...InstanceScoped,
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
  }),
  error: RunnerRemoteError,
});

export const RunnerStopSessionRpc = Rpc.make("runner.provider.stopSession", {
  payload: Schema.Struct({ ...InstanceScoped, threadId: ThreadId }),
  error: RunnerRemoteError,
});

export const RunnerListSessionsRpc = Rpc.make("runner.provider.listSessions", {
  payload: Schema.Struct(InstanceScoped),
  success: Schema.Array(ProviderSession),
  error: RunnerRemoteError,
});

export const RunnerReadThreadRpc = Rpc.make("runner.provider.readThread", {
  payload: Schema.Struct({ ...InstanceScoped, threadId: ThreadId }),
  success: RunnerThreadSnapshot,
  error: RunnerRemoteError,
});

export const RunnerRollbackThreadRpc = Rpc.make("runner.provider.rollbackThread", {
  payload: Schema.Struct({ ...InstanceScoped, threadId: ThreadId, numTurns: NonNegativeInt }),
  success: RunnerThreadSnapshot,
  error: RunnerRemoteError,
});

/** Provider status and models as the runner's real driver sees them. */
export const RunnerGetCapabilitiesRpc = Rpc.make("runner.provider.getCapabilities", {
  payload: Schema.Struct({ ...InstanceScoped, refresh: Schema.optional(Schema.Boolean) }),
  success: Schema.Struct({
    snapshot: ServerProvider,
    sessionModelSwitch: Schema.Literals(["in-session", "unsupported"]),
  }),
  error: RunnerRemoteError,
});

// ── Text generation ────────────────────────────────────────────────────

const TextGenerationPayload = {
  ...InstanceScoped,
  ...CwdScoped,
  message: Schema.String,
  attachments: Schema.Array(RunnerAttachmentFile),
  modelSelection: ModelSelection,
} as const;

export const RunnerGenerateThreadTitleRpc = Rpc.make("runner.text.generateThreadTitle", {
  payload: Schema.Struct({
    ...TextGenerationPayload,
    previousTitle: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({ title: Schema.String }),
  error: TextGenerationError,
});

export const RunnerGenerateBranchNameRpc = Rpc.make("runner.text.generateBranchName", {
  payload: Schema.Struct(TextGenerationPayload),
  success: Schema.Struct({ branch: Schema.String }),
  error: TextGenerationError,
});

// ── Event outbox ───────────────────────────────────────────────────────

/**
 * Replays every retained event with `sequence > afterSequence`, then tails
 * live events. The hub may resubscribe from any point at or after its ack.
 */
export const RunnerSubscribeEventsRpc = Rpc.make("runner.events.subscribe", {
  payload: Schema.Struct({ afterSequence: NonNegativeInt }),
  success: RunnerEventEnvelope,
  stream: true,
});

/** Marks every event with `sequence <= throughSequence` durable on the hub. */
export const RunnerAckEventsRpc = Rpc.make("runner.events.ack", {
  payload: Schema.Struct({ throughSequence: NonNegativeInt }),
  success: Schema.Struct({ ackedSequence: NonNegativeInt, retained: NonNegativeInt }),
});

// ── Checkout ───────────────────────────────────────────────────────────

export const RunnerPrepareCheckoutInput = Schema.Struct({
  threadId: ThreadId,
  checkout: TrimmedNonEmptyString,
  repository: Schema.NullOr(ThreadMachineRepository),
  /** Branch the thread works on; created from `baseRef` when missing. */
  branch: Schema.NullOr(TrimmedNonEmptyString),
  baseRef: Schema.NullOr(TrimmedNonEmptyString),
});
export type RunnerPrepareCheckoutInput = typeof RunnerPrepareCheckoutInput.Type;

export const RunnerPrepareCheckoutResult = Schema.Struct({
  checkout: TrimmedNonEmptyString,
  isRepository: Schema.Boolean,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  headCommit: Schema.NullOr(TrimmedNonEmptyString),
  /** True when this call cloned or initialized the checkout. */
  created: Schema.Boolean,
});
export type RunnerPrepareCheckoutResult = typeof RunnerPrepareCheckoutResult.Type;

/** Idempotent: clones or fetches with the machine's git credentials and checks out `branch`. */
export const RunnerPrepareCheckoutRpc = Rpc.make("runner.checkout.prepare", {
  payload: RunnerPrepareCheckoutInput,
  success: RunnerPrepareCheckoutResult,
  error: RunnerCheckoutError,
});

// ── Checkpoints ────────────────────────────────────────────────────────

export const RunnerIsGitRepositoryRpc = Rpc.make("runner.checkpoint.isGitRepository", {
  payload: Schema.Struct(CwdScoped),
  success: Schema.Boolean,
  error: VcsError,
});

export const RunnerCaptureCheckpointRpc = Rpc.make("runner.checkpoint.capture", {
  payload: Schema.Struct({ ...CwdScoped, checkpointRef: CheckpointRef }),
  error: VcsError,
});

export const RunnerHasCheckpointRefRpc = Rpc.make("runner.checkpoint.hasRef", {
  payload: Schema.Struct({ ...CwdScoped, checkpointRef: CheckpointRef }),
  success: Schema.Boolean,
  error: VcsError,
});

export const RunnerRestoreCheckpointRpc = Rpc.make("runner.checkpoint.restore", {
  payload: Schema.Struct({
    ...CwdScoped,
    checkpointRef: CheckpointRef,
    fallbackToHead: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Boolean,
  error: VcsError,
});

export const RunnerDiffCheckpointsRpc = Rpc.make("runner.checkpoint.diff", {
  payload: Schema.Struct({
    ...CwdScoped,
    fromCheckpointRef: CheckpointRef,
    toCheckpointRef: CheckpointRef,
    fallbackFromToHead: Schema.optional(Schema.Boolean),
    ignoreWhitespace: Schema.Boolean,
  }),
  success: Schema.String,
  error: VcsError,
});

export const RunnerDeleteCheckpointRefsRpc = Rpc.make("runner.checkpoint.deleteRefs", {
  payload: Schema.Struct({ ...CwdScoped, checkpointRefs: Schema.Array(CheckpointRef) }),
  error: VcsError,
});

// ── Workspace files ────────────────────────────────────────────────────

export const RunnerListEntriesRpc = Rpc.make("runner.workspace.listEntries", {
  payload: ProjectListEntriesInput,
  success: ProjectListEntriesResult,
  error: RunnerRemoteError,
});

export const RunnerSearchEntriesRpc = Rpc.make("runner.workspace.searchEntries", {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
  error: RunnerRemoteError,
});

export const RunnerSearchContentsRpc = Rpc.make("runner.workspace.searchContents", {
  payload: ProjectSearchContentsInput,
  success: ProjectSearchContentsResult,
  error: RunnerRemoteError,
});

export const RunnerReadFileRpc = Rpc.make("runner.workspace.readFile", {
  payload: ProjectReadFileInput,
  success: ProjectReadFileResult,
  error: RunnerRemoteError,
});

export const RunnerWriteFileRpc = Rpc.make("runner.workspace.writeFile", {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: RunnerRemoteError,
});

export const RunnerRefreshWorkspaceIndexRpc = Rpc.make("runner.workspace.refreshIndex", {
  payload: Schema.Struct(CwdScoped),
});

// ── VCS and git ────────────────────────────────────────────────────────

export const RunnerVcsStatusRpc = Rpc.make("runner.vcs.status", {
  payload: VcsStatusInput,
  success: VcsStatusResult,
  error: GitManagerServiceError,
});

export const RunnerVcsLocalStatusRpc = Rpc.make("runner.vcs.localStatus", {
  payload: VcsStatusInput,
  success: VcsStatusLocalResult,
  error: GitManagerServiceError,
});

export const RunnerVcsRemoteStatusRpc = Rpc.make("runner.vcs.remoteStatus", {
  payload: VcsStatusInput,
  success: Schema.NullOr(VcsStatusRemoteResult),
  error: GitManagerServiceError,
});

export const RunnerVcsRefreshStatusRpc = Rpc.make("runner.vcs.refreshStatus", {
  payload: Schema.Struct(CwdScoped),
  success: VcsStatusResult,
  error: GitManagerServiceError,
});

export const RunnerVcsRefreshLocalStatusRpc = Rpc.make("runner.vcs.refreshLocalStatus", {
  payload: Schema.Struct(CwdScoped),
  success: VcsStatusLocalResult,
  error: GitManagerServiceError,
});

/** Pushes the checkout's status to the hub cache while a connection is open. */
export const RunnerVcsStreamStatusRpc = Rpc.make("runner.vcs.streamStatus", {
  payload: VcsStatusInput,
  success: VcsStatusStreamEvent,
  error: GitManagerServiceError,
  stream: true,
});

export const RunnerVcsInitRpc = Rpc.make("runner.vcs.init", {
  payload: VcsInitInput,
  error: VcsError,
});

export const RunnerGitPullRpc = Rpc.make("runner.git.pull", {
  payload: Schema.Struct(CwdScoped),
  success: VcsPullResult,
  error: GitCommandError,
});

export const RunnerGitStackedActionEvent = Schema.Union([
  Schema.TaggedStruct("progress", { event: GitActionProgressEvent }),
  Schema.TaggedStruct("result", { result: GitRunStackedActionResult }),
]);
export type RunnerGitStackedActionEvent = typeof RunnerGitStackedActionEvent.Type;

/** Commit, push and PR creation run on the runner; progress streams back, then the result. */
export const RunnerGitRunStackedActionRpc = Rpc.make("runner.git.runStackedAction", {
  payload: GitRunStackedActionInput,
  success: RunnerGitStackedActionEvent,
  error: GitManagerServiceError,
  stream: true,
});

export const RunnerGitResolvePullRequestRpc = Rpc.make("runner.git.resolvePullRequest", {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
  error: GitManagerServiceError,
});

export const RunnerGitPreparePullRequestThreadRpc = Rpc.make(
  "runner.git.preparePullRequestThread",
  {
    payload: GitPreparePullRequestThreadInput,
    success: GitPreparePullRequestThreadResult,
    error: GitManagerServiceError,
  },
);

export const RunnerGitListRefsRpc = Rpc.make("runner.git.listRefs", {
  payload: VcsListRefsInput,
  success: VcsListRefsResult,
  error: GitCommandError,
});

export const RunnerGitCreateWorktreeRpc = Rpc.make("runner.git.createWorktree", {
  payload: VcsCreateWorktreeInput,
  success: VcsCreateWorktreeResult,
  error: GitCommandError,
});

export const RunnerGitRemoveWorktreeRpc = Rpc.make("runner.git.removeWorktree", {
  payload: VcsRemoveWorktreeInput,
  error: GitCommandError,
});

export const RunnerGitPruneWorktreesRpc = Rpc.make("runner.git.pruneWorktrees", {
  payload: Schema.Struct(CwdScoped),
  error: GitCommandError,
});

export const RunnerGitCreateRefRpc = Rpc.make("runner.git.createRef", {
  payload: VcsCreateRefInput,
  success: VcsCreateRefResult,
  error: GitCommandError,
});

export const RunnerGitSwitchRefRpc = Rpc.make("runner.git.switchRef", {
  payload: VcsSwitchRefInput,
  success: VcsSwitchRefResult,
  error: GitCommandError,
});

export const RunnerGitRenameBranchRpc = Rpc.make("runner.git.renameBranch", {
  payload: Schema.Struct({ ...CwdScoped, oldBranch: Schema.String, newBranch: Schema.String }),
  success: Schema.Struct({ branch: Schema.String }),
  error: GitManagerServiceError,
});

export const RunnerGitFetchRemoteRpc = Rpc.make("runner.git.fetchRemote", {
  payload: Schema.Struct({ ...CwdScoped, remoteName: Schema.String }),
  error: GitCommandError,
});

export const RunnerGitRemoteExistsRpc = Rpc.make("runner.git.remoteExists", {
  payload: Schema.Struct({ ...CwdScoped, remoteName: Schema.String }),
  success: Schema.Boolean,
  error: GitCommandError,
});

export const RunnerGitResolveRemoteTrackingCommitRpc = Rpc.make(
  "runner.git.resolveRemoteTrackingCommit",
  {
    payload: Schema.Struct({
      ...CwdScoped,
      refName: Schema.String,
      fallbackRemoteName: Schema.String,
    }),
    success: Schema.Struct({ commitSha: Schema.String, remoteRefName: Schema.String }),
    error: GitCommandError,
  },
);

// ── Review ─────────────────────────────────────────────────────────────

export const RunnerReviewDiffPreviewRpc = Rpc.make("runner.review.getDiffPreview", {
  payload: ReviewDiffPreviewInput,
  success: ReviewDiffPreviewResult,
  error: ReviewDiffPreviewError,
});

export const RunnerReviewDiffFileContentsRpc = Rpc.make("runner.review.getDiffFileContents", {
  payload: ReviewDiffFileContentsInput,
  success: ReviewDiffFileContentsResult,
  error: ReviewDiffPreviewError,
});

// ── Terminals ──────────────────────────────────────────────────────────

export const RunnerTerminalOpenRpc = Rpc.make("runner.terminal.open", {
  payload: TerminalOpenInput,
  success: TerminalSessionSnapshot,
  error: TerminalError,
});

export const RunnerTerminalAttachRpc = Rpc.make("runner.terminal.attach", {
  payload: TerminalAttachInput,
  success: TerminalAttachStreamEvent,
  error: TerminalError,
  stream: true,
});

export const RunnerTerminalWriteRpc = Rpc.make("runner.terminal.write", {
  payload: TerminalWriteInput,
  error: TerminalError,
});

export const RunnerTerminalResizeRpc = Rpc.make("runner.terminal.resize", {
  payload: TerminalResizeInput,
  error: TerminalError,
});

export const RunnerTerminalClearRpc = Rpc.make("runner.terminal.clear", {
  payload: TerminalClearInput,
  error: TerminalError,
});

export const RunnerTerminalRestartRpc = Rpc.make("runner.terminal.restart", {
  payload: TerminalRestartInput,
  success: TerminalSessionSnapshot,
  error: TerminalError,
});

export const RunnerTerminalCloseRpc = Rpc.make("runner.terminal.close", {
  payload: TerminalCloseInput,
  error: TerminalError,
});

export const RunnerTerminalEventsRpc = Rpc.make("runner.terminal.events", {
  payload: Schema.Struct({}),
  success: TerminalEvent,
  stream: true,
});

/** Starts with a full snapshot of the runner's terminals, then upserts and removes. */
export const RunnerTerminalMetadataRpc = Rpc.make("runner.terminal.metadata", {
  payload: Schema.Struct({}),
  success: TerminalMetadataStreamEvent,
  stream: true,
});

export const RunnerRpcGroup = RpcGroup.make(
  RunnerHelloRpc,
  RunnerStartSessionRpc,
  RunnerSendTurnRpc,
  RunnerInterruptTurnRpc,
  RunnerRespondToRequestRpc,
  RunnerRespondToUserInputRpc,
  RunnerStopSessionRpc,
  RunnerListSessionsRpc,
  RunnerReadThreadRpc,
  RunnerRollbackThreadRpc,
  RunnerGetCapabilitiesRpc,
  RunnerGenerateThreadTitleRpc,
  RunnerGenerateBranchNameRpc,
  RunnerSubscribeEventsRpc,
  RunnerAckEventsRpc,
  RunnerPrepareCheckoutRpc,
  RunnerIsGitRepositoryRpc,
  RunnerCaptureCheckpointRpc,
  RunnerHasCheckpointRefRpc,
  RunnerRestoreCheckpointRpc,
  RunnerDiffCheckpointsRpc,
  RunnerDeleteCheckpointRefsRpc,
  RunnerListEntriesRpc,
  RunnerSearchEntriesRpc,
  RunnerSearchContentsRpc,
  RunnerReadFileRpc,
  RunnerWriteFileRpc,
  RunnerRefreshWorkspaceIndexRpc,
  RunnerVcsStatusRpc,
  RunnerVcsLocalStatusRpc,
  RunnerVcsRemoteStatusRpc,
  RunnerVcsRefreshStatusRpc,
  RunnerVcsRefreshLocalStatusRpc,
  RunnerVcsStreamStatusRpc,
  RunnerVcsInitRpc,
  RunnerGitPullRpc,
  RunnerGitRunStackedActionRpc,
  RunnerGitResolvePullRequestRpc,
  RunnerGitPreparePullRequestThreadRpc,
  RunnerGitListRefsRpc,
  RunnerGitCreateWorktreeRpc,
  RunnerGitRemoveWorktreeRpc,
  RunnerGitPruneWorktreesRpc,
  RunnerGitCreateRefRpc,
  RunnerGitSwitchRefRpc,
  RunnerGitRenameBranchRpc,
  RunnerGitFetchRemoteRpc,
  RunnerGitRemoteExistsRpc,
  RunnerGitResolveRemoteTrackingCommitRpc,
  RunnerReviewDiffPreviewRpc,
  RunnerReviewDiffFileContentsRpc,
  RunnerTerminalOpenRpc,
  RunnerTerminalAttachRpc,
  RunnerTerminalWriteRpc,
  RunnerTerminalResizeRpc,
  RunnerTerminalClearRpc,
  RunnerTerminalRestartRpc,
  RunnerTerminalCloseRpc,
  RunnerTerminalEventsRpc,
  RunnerTerminalMetadataRpc,
);

/** Whether a runner speaking `[runnerMin, runnerMax]` can serve a hub speaking `[hubMin, hubMax]`. */
export function runnerProtocolsOverlap(input: {
  readonly runnerProtocolVersion: number;
  readonly runnerMinProtocolVersion: number;
  readonly hubProtocolVersion: number;
  readonly hubMinProtocolVersion: number;
}): boolean {
  return (
    input.runnerMinProtocolVersion <= input.hubProtocolVersion &&
    input.hubMinProtocolVersion <= input.runnerProtocolVersion
  );
}

/** The version both sides speak: the highest version in the overlap. */
export function negotiatedRunnerProtocolVersion(input: {
  readonly runnerProtocolVersion: number;
  readonly hubProtocolVersion: number;
}): number {
  return Math.min(input.runnerProtocolVersion, input.hubProtocolVersion);
}
