/**
 * RunnerProtocol - the hub <-> runner wire contract (prototype).
 *
 * The hub is a T3 server with no local checkout: it owns orchestration,
 * projections, settings and the provider session directory. A runner owns
 * one machine's checkout and runs the real provider drivers, git and
 * checkpoints for it. The hub reaches the runner through this Effect RPC
 * group over one authenticated WebSocket.
 *
 * Every payload reuses a `@t3tools/contracts` schema where one exists, so
 * the runner speaks exactly the shapes the in-process adapter already uses.
 *
 * Event delivery is the only stateful part: runners append every provider
 * runtime event to a durable outbox with a monotonically increasing
 * `sequence`; the hub subscribes from its last acknowledged sequence and
 * acknowledges once the events are ingested. See `RunnerOutbox.ts`.
 *
 * @module runner/RunnerProtocol
 */
import {
  ApprovalRequestId,
  ChatAttachment,
  CheckpointRef,
  ModelSelection,
  NonNegativeInt,
  ProviderApprovalDecision,
  ProviderInstanceId,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
  ProviderTurnStartResult,
  ProviderUserInputAnswers,
  ServerProvider,
  TextGenerationError,
  ThreadId,
  TurnId,
  VcsError,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../provider/Errors.ts";

export const RUNNER_PROTOCOL_VERSION = 1;
export const RUNNER_WS_PATH = "/runner/ws";

/** Adapter errors cross the wire with their original tags. */
export const RunnerProviderError = Schema.Union([
  ProviderAdapterValidationError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterRequestError,
  ProviderAdapterProcessError,
]);
export type RunnerProviderError = typeof RunnerProviderError.Type;

export class RunnerWorkspaceError extends Schema.TaggedErrorClass<RunnerWorkspaceError>()(
  "RunnerWorkspaceError",
  {
    operation: Schema.String,
    workspaceRoot: Schema.String,
    reason: Schema.Literals(["not-exists", "not-directory", "create-failed", "stat-failed"]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Runner workspace ${this.operation} failed for ${this.workspaceRoot}: ${this.detail}`;
  }
}

export const RunnerHello = Schema.Struct({
  protocolVersion: Schema.Number,
  /** Stable for the runner's state directory; survives restarts. */
  runnerId: Schema.String,
  /** Changes on every runner process start. */
  bootId: Schema.String,
  /** Highest sequence ever appended to the outbox (0 when empty). */
  headSequence: NonNegativeInt,
  /** Highest sequence the hub has acknowledged. */
  ackedSequence: NonNegativeInt,
  instances: Schema.Array(ProviderInstanceId),
});
export type RunnerHello = typeof RunnerHello.Type;

export const RunnerEventEnvelope = Schema.Struct({
  sequence: NonNegativeInt,
  bootId: Schema.String,
  event: ProviderRuntimeEvent,
});
export type RunnerEventEnvelope = typeof RunnerEventEnvelope.Type;

const InstanceScoped = { instanceId: ProviderInstanceId } as const;

export const RunnerThreadSnapshot = Schema.Struct({
  threadId: ThreadId,
  turns: Schema.Array(Schema.Struct({ id: TurnId, items: Schema.Array(Schema.Unknown) })),
});

// ── Provider adapter group ───────────────────────────────────────────────

export const RunnerHelloRpc = Rpc.make("runner.hello", {
  payload: Schema.Struct({}),
  success: RunnerHello,
});

export const RunnerStartSessionRpc = Rpc.make("runner.provider.startSession", {
  payload: Schema.Struct({ ...InstanceScoped, input: ProviderSessionStartInput }),
  success: ProviderSession,
  error: RunnerProviderError,
});

export const RunnerSendTurnRpc = Rpc.make("runner.provider.sendTurn", {
  payload: Schema.Struct({ ...InstanceScoped, input: ProviderSendTurnInput }),
  success: ProviderTurnStartResult,
  error: RunnerProviderError,
});

export const RunnerInterruptTurnRpc = Rpc.make("runner.provider.interruptTurn", {
  payload: Schema.Struct({
    ...InstanceScoped,
    threadId: ThreadId,
    turnId: Schema.optional(TurnId),
  }),
  success: Schema.Void,
  error: RunnerProviderError,
});

export const RunnerRespondToRequestRpc = Rpc.make("runner.provider.respondToRequest", {
  payload: Schema.Struct({
    ...InstanceScoped,
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  }),
  success: Schema.Void,
  error: RunnerProviderError,
});

export const RunnerRespondToUserInputRpc = Rpc.make("runner.provider.respondToUserInput", {
  payload: Schema.Struct({
    ...InstanceScoped,
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
  }),
  success: Schema.Void,
  error: RunnerProviderError,
});

export const RunnerStopSessionRpc = Rpc.make("runner.provider.stopSession", {
  payload: Schema.Struct({ ...InstanceScoped, threadId: ThreadId }),
  success: Schema.Void,
  error: RunnerProviderError,
});

export const RunnerListSessionsRpc = Rpc.make("runner.provider.listSessions", {
  payload: Schema.Struct({ ...InstanceScoped }),
  success: Schema.Array(ProviderSession),
  error: RunnerProviderError,
});

export const RunnerReadThreadRpc = Rpc.make("runner.provider.readThread", {
  payload: Schema.Struct({ ...InstanceScoped, threadId: ThreadId }),
  success: RunnerThreadSnapshot,
  error: RunnerProviderError,
});

export const RunnerRollbackThreadRpc = Rpc.make("runner.provider.rollbackThread", {
  payload: Schema.Struct({ ...InstanceScoped, threadId: ThreadId, numTurns: NonNegativeInt }),
  success: RunnerThreadSnapshot,
  error: RunnerProviderError,
});

/** Provider status/models snapshot as the runner's real driver sees it. */
export const RunnerGetCapabilitiesRpc = Rpc.make("runner.provider.getCapabilities", {
  payload: Schema.Struct({ ...InstanceScoped, refresh: Schema.optional(Schema.Boolean) }),
  success: Schema.Struct({
    snapshot: ServerProvider,
    sessionModelSwitch: Schema.Literals(["in-session", "unsupported"]),
  }),
  error: RunnerProviderError,
});

export const RunnerGenerateThreadTitleRpc = Rpc.make("runner.text.generateThreadTitle", {
  payload: Schema.Struct({
    ...InstanceScoped,
    cwd: Schema.String,
    message: Schema.String,
    previousTitle: Schema.optional(Schema.String),
    attachments: Schema.optional(Schema.Array(ChatAttachment)),
    modelSelection: ModelSelection,
  }),
  success: Schema.Struct({ title: Schema.String }),
  error: TextGenerationError,
});

export const RunnerGenerateBranchNameRpc = Rpc.make("runner.text.generateBranchName", {
  payload: Schema.Struct({
    ...InstanceScoped,
    cwd: Schema.String,
    message: Schema.String,
    attachments: Schema.optional(Schema.Array(ChatAttachment)),
    modelSelection: ModelSelection,
  }),
  success: Schema.Struct({ branch: Schema.String }),
  error: TextGenerationError,
});

// ── Event outbox ─────────────────────────────────────────────────────────

/**
 * Replays every outboxed event with `sequence > afterSequence`, then tails
 * live events. Idempotent: the hub may resubscribe from any acked point.
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

// ── Checkpoints (hidden git refs in the runner's checkout) ───────────────

export const RunnerIsGitRepositoryRpc = Rpc.make("runner.checkpoint.isGitRepository", {
  payload: Schema.Struct({ cwd: Schema.String }),
  success: Schema.Boolean,
  error: VcsError,
});

export const RunnerCaptureCheckpointRpc = Rpc.make("runner.checkpoint.capture", {
  payload: Schema.Struct({ cwd: Schema.String, checkpointRef: CheckpointRef }),
  success: Schema.Void,
  error: VcsError,
});

export const RunnerHasCheckpointRefRpc = Rpc.make("runner.checkpoint.hasRef", {
  payload: Schema.Struct({ cwd: Schema.String, checkpointRef: CheckpointRef }),
  success: Schema.Boolean,
  error: VcsError,
});

export const RunnerRestoreCheckpointRpc = Rpc.make("runner.checkpoint.restore", {
  payload: Schema.Struct({
    cwd: Schema.String,
    checkpointRef: CheckpointRef,
    fallbackToHead: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Boolean,
  error: VcsError,
});

export const RunnerDiffCheckpointsRpc = Rpc.make("runner.checkpoint.diff", {
  payload: Schema.Struct({
    cwd: Schema.String,
    fromCheckpointRef: CheckpointRef,
    toCheckpointRef: CheckpointRef,
    fallbackFromToHead: Schema.optional(Schema.Boolean),
    ignoreWhitespace: Schema.Boolean,
  }),
  success: Schema.String,
  error: VcsError,
});

export const RunnerDeleteCheckpointRefsRpc = Rpc.make("runner.checkpoint.deleteRefs", {
  payload: Schema.Struct({ cwd: Schema.String, checkpointRefs: Schema.Array(CheckpointRef) }),
  success: Schema.Void,
  error: VcsError,
});

// ── Workspace ────────────────────────────────────────────────────────────

export const RunnerNormalizeWorkspaceRootRpc = Rpc.make("runner.workspace.normalizeRoot", {
  payload: Schema.Struct({
    workspaceRoot: Schema.String,
    createIfMissing: Schema.optional(Schema.Boolean),
  }),
  success: Schema.String,
  error: RunnerWorkspaceError,
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
  RunnerIsGitRepositoryRpc,
  RunnerCaptureCheckpointRpc,
  RunnerHasCheckpointRefRpc,
  RunnerRestoreCheckpointRpc,
  RunnerDiffCheckpointsRpc,
  RunnerDeleteCheckpointRefsRpc,
  RunnerNormalizeWorkspaceRootRpc,
);
