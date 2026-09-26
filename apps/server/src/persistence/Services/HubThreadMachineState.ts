/**
 * Hub-only persistence for thread machines.
 *
 * A hub serves history, diffs and git status without waking machines, and
 * resumes runner event delivery exactly where it stopped. These repositories
 * hold that state:
 *
 * - `RunnerCursorStore`: per thread, the runner outbox identity, the last boot
 *   the hub saw, and the highest event sequence whose effects are durable.
 * - `CheckpointTurnDiffStore`: the patch between two checkpoints of a thread,
 *   captured while the machine was awake.
 * - `ThreadVcsStatusStore`: the last git status a runner reported per thread.
 * - `ThreadMachineStatusStore`: the last machine state the directory reported
 *   per thread, shown on thread shells without asking the directory again.
 * - `ProviderSnapshotStore`: the last provider snapshot a runner reported per
 *   provider instance, so a hub shows providers before any machine runs.
 * - `McpCredentialStore`: the hashes and scopes of the MCP credentials the hub
 *   minted for provider sessions on thread machines, which outlive the hub.
 *
 * Postgres implementations live in `persistence/Postgres/HubThreadMachineState.ts`
 * (hub migrations 050 and 051); the SQLite implementations back hub mode without a
 * database URL (tests and local development) and are never built in
 * standalone mode.
 *
 * @module HubThreadMachineState
 */
import {
  IsoDateTime,
  NonNegativeInt,
  ProviderInstanceId,
  ServerProvider,
  ThreadId,
  ThreadMachineState,
  TrimmedNonEmptyString,
  VcsStatusLocalResult,
  VcsStatusRemoteResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const RunnerCursor = Schema.Struct({
  threadId: ThreadId,
  /** `runnerId` of the outbox the sequence belongs to; a new outbox restarts at 0. */
  outboxId: TrimmedNonEmptyString,
  /** Last runner boot the hub reconciled against. */
  bootId: TrimmedNonEmptyString,
  ackedSequence: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type RunnerCursor = typeof RunnerCursor.Type;

export interface RunnerCursorStoreShape {
  readonly get: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<RunnerCursor>, ProjectionRepositoryError>;
  readonly list: () => Effect.Effect<ReadonlyArray<RunnerCursor>, ProjectionRepositoryError>;
  /** Upserts every cursor in one transaction. */
  readonly saveAll: (
    cursors: ReadonlyArray<RunnerCursor>,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly remove: (threadId: ThreadId) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class RunnerCursorStore extends Context.Service<RunnerCursorStore, RunnerCursorStoreShape>()(
  "t3/persistence/Services/HubThreadMachineState/RunnerCursorStore",
) {}

export const CheckpointTurnDiffKey = Schema.Struct({
  threadId: ThreadId,
  fromTurnCount: NonNegativeInt,
  toTurnCount: NonNegativeInt,
  ignoreWhitespace: Schema.Boolean,
});
export type CheckpointTurnDiffKey = typeof CheckpointTurnDiffKey.Type;

export const CheckpointTurnDiff = Schema.Struct({
  ...CheckpointTurnDiffKey.fields,
  diff: Schema.String,
  createdAt: IsoDateTime,
});
export type CheckpointTurnDiff = typeof CheckpointTurnDiff.Type;

export interface CheckpointTurnDiffStoreShape {
  readonly get: (
    key: CheckpointTurnDiffKey,
  ) => Effect.Effect<Option.Option<string>, ProjectionRepositoryError>;
  readonly put: (row: CheckpointTurnDiff) => Effect.Effect<void, ProjectionRepositoryError>;
  /**
   * Drops every diff that reads the checkpoint at `turnCount` or later. Called
   * when that checkpoint is recaptured, restored past, or deleted.
   */
  readonly invalidateFromTurn: (input: {
    readonly threadId: ThreadId;
    readonly turnCount: number;
  }) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly removeThread: (threadId: ThreadId) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class CheckpointTurnDiffStore extends Context.Service<
  CheckpointTurnDiffStore,
  CheckpointTurnDiffStoreShape
>()("t3/persistence/Services/HubThreadMachineState/CheckpointTurnDiffStore") {}

export const ThreadVcsStatus = Schema.Struct({
  threadId: ThreadId,
  local: VcsStatusLocalResult,
  remote: Schema.NullOr(VcsStatusRemoteResult),
  updatedAt: IsoDateTime,
});
export type ThreadVcsStatus = typeof ThreadVcsStatus.Type;

export interface ThreadVcsStatusStoreShape {
  readonly list: () => Effect.Effect<ReadonlyArray<ThreadVcsStatus>, ProjectionRepositoryError>;
  readonly put: (row: ThreadVcsStatus) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly remove: (threadId: ThreadId) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ThreadVcsStatusStore extends Context.Service<
  ThreadVcsStatusStore,
  ThreadVcsStatusStoreShape
>()("t3/persistence/Services/HubThreadMachineState/ThreadVcsStatusStore") {}

export const ThreadMachineStatusRow = Schema.Struct({
  threadId: ThreadId,
  state: ThreadMachineState,
  detail: Schema.NullOr(Schema.String),
  bootId: Schema.NullOr(Schema.String),
  updatedAt: IsoDateTime,
});
export type ThreadMachineStatusRow = typeof ThreadMachineStatusRow.Type;

export interface ThreadMachineStatusStoreShape {
  readonly list: () => Effect.Effect<
    ReadonlyArray<ThreadMachineStatusRow>,
    ProjectionRepositoryError
  >;
  readonly put: (row: ThreadMachineStatusRow) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly remove: (threadId: ThreadId) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ThreadMachineStatusStore extends Context.Service<
  ThreadMachineStatusStore,
  ThreadMachineStatusStoreShape
>()("t3/persistence/Services/HubThreadMachineState/ThreadMachineStatusStore") {}

export const ProviderSnapshotRow = Schema.Struct({
  instanceId: ProviderInstanceId,
  snapshot: ServerProvider,
  updatedAt: IsoDateTime,
});
export type ProviderSnapshotRow = typeof ProviderSnapshotRow.Type;

export interface ProviderSnapshotStoreShape {
  readonly list: () => Effect.Effect<ReadonlyArray<ProviderSnapshotRow>, ProjectionRepositoryError>;
  readonly put: (row: ProviderSnapshotRow) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProviderSnapshotStore extends Context.Service<
  ProviderSnapshotStore,
  ProviderSnapshotStoreShape
>()("t3/persistence/Services/HubThreadMachineState/ProviderSnapshotStore") {}

export const McpCredentialRow = Schema.Struct({
  tokenHash: TrimmedNonEmptyString,
  environmentId: Schema.String,
  threadId: Schema.String,
  providerSessionId: Schema.String,
  providerInstanceId: Schema.String,
  capabilities: Schema.Array(Schema.String),
  issuedAt: Schema.Number,
  lastAliveAt: Schema.Number,
});
export type McpCredentialRow = typeof McpCredentialRow.Type;

export interface McpCredentialStoreShape {
  readonly list: () => Effect.Effect<ReadonlyArray<McpCredentialRow>, ProjectionRepositoryError>;
  readonly put: (row: McpCredentialRow) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly touch: (
    tokenHashes: ReadonlyArray<string>,
    lastAliveAt: number,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly remove: (
    tokenHashes: ReadonlyArray<string>,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class McpCredentialStore extends Context.Service<
  McpCredentialStore,
  McpCredentialStoreShape
>()("t3/persistence/Services/HubThreadMachineState/McpCredentialStore") {}
