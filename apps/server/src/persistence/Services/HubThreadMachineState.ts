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
 *
 * Postgres implementations live in `persistence/Postgres/HubThreadMachineState.ts`
 * (hub migration 050); the SQLite implementations back hub mode without a
 * database URL (tests and local development) and are never built in
 * standalone mode.
 *
 * @module HubThreadMachineState
 */
import {
  IsoDateTime,
  NonNegativeInt,
  ThreadId,
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
