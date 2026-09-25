/**
 * SQLite implementations of the hub thread-machine repositories.
 *
 * Used only in hub mode without `T3CODE_HUB_DATABASE_URL` (tests and local
 * development). The tables are created on first use instead of through a
 * numbered migration so standalone databases never gain hub-only tables; the
 * production schema is hub Postgres migration 050.
 *
 * @module HubThreadMachineStateSqlite
 */
import { VcsStatusLocalResult, VcsStatusRemoteResult, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  CheckpointTurnDiff,
  CheckpointTurnDiffKey,
  CheckpointTurnDiffStore,
  RunnerCursor,
  RunnerCursorStore,
  ThreadVcsStatus,
  ThreadVcsStatusStore,
} from "../Services/HubThreadMachineState.ts";

const HUB_SQLITE_TABLES = [
  `CREATE TABLE IF NOT EXISTS hub_runner_cursors (
    thread_id TEXT PRIMARY KEY,
    outbox_id TEXT NOT NULL,
    boot_id TEXT NOT NULL,
    acked_sequence INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS hub_checkpoint_turn_diffs (
    thread_id TEXT NOT NULL,
    from_turn_count INTEGER NOT NULL,
    to_turn_count INTEGER NOT NULL,
    ignore_whitespace INTEGER NOT NULL,
    diff TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (thread_id, from_turn_count, to_turn_count, ignore_whitespace)
  )`,
  `CREATE TABLE IF NOT EXISTS hub_thread_vcs_status (
    thread_id TEXT PRIMARY KEY,
    local_json TEXT NOT NULL,
    remote_json TEXT,
    updated_at TEXT NOT NULL
  )`,
] as const;

const ensureTables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of HUB_SQLITE_TABLES) {
    yield* sql.unsafe(statement);
  }
}).pipe(Effect.mapError(toPersistenceSqlError("HubThreadMachineState.ensureTables")));

const sqlOrDecode = (operation: string) => (cause: unknown) =>
  Schema.isSchemaError(cause)
    ? toPersistenceDecodeError(operation)(cause)
    : toPersistenceSqlError(operation)(cause);

const RunnerCursorRow = RunnerCursor;

export const makeRunnerCursorStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* ensureTables;

  const selectOne = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: RunnerCursorRow,
    execute: (threadId) => sql`
      SELECT thread_id AS "threadId", outbox_id AS "outboxId", boot_id AS "bootId",
        acked_sequence AS "ackedSequence", updated_at AS "updatedAt"
      FROM hub_runner_cursors WHERE thread_id = ${threadId}
    `,
  });
  const selectAll = SqlSchema.findAll({
    Request: Schema.Void,
    Result: RunnerCursorRow,
    execute: () => sql`
      SELECT thread_id AS "threadId", outbox_id AS "outboxId", boot_id AS "bootId",
        acked_sequence AS "ackedSequence", updated_at AS "updatedAt"
      FROM hub_runner_cursors ORDER BY thread_id
    `,
  });
  const upsert = SqlSchema.void({
    Request: RunnerCursorRow,
    execute: (row) => sql`
      INSERT INTO hub_runner_cursors (thread_id, outbox_id, boot_id, acked_sequence, updated_at)
      VALUES (${row.threadId}, ${row.outboxId}, ${row.bootId}, ${row.ackedSequence}, ${row.updatedAt})
      ON CONFLICT (thread_id) DO UPDATE SET
        outbox_id = excluded.outbox_id,
        boot_id = excluded.boot_id,
        acked_sequence = excluded.acked_sequence,
        updated_at = excluded.updated_at
    `,
  });

  return RunnerCursorStore.of({
    get: (threadId) =>
      selectOne(threadId).pipe(Effect.mapError(sqlOrDecode("RunnerCursorStore.get"))),
    list: () => selectAll(undefined).pipe(Effect.mapError(sqlOrDecode("RunnerCursorStore.list"))),
    saveAll: (cursors) =>
      sql
        .withTransaction(Effect.forEach(cursors, (cursor) => upsert(cursor), { discard: true }))
        .pipe(Effect.mapError(sqlOrDecode("RunnerCursorStore.saveAll"))),
    remove: (threadId) =>
      sql`DELETE FROM hub_runner_cursors WHERE thread_id = ${threadId}`.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("RunnerCursorStore.remove")),
      ),
  });
});

export const makeCheckpointTurnDiffStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* ensureTables;

  const selectDiff = SqlSchema.findOneOption({
    Request: CheckpointTurnDiffKey,
    Result: Schema.Struct({ diff: Schema.String }),
    execute: (key) => sql`
      SELECT diff FROM hub_checkpoint_turn_diffs
      WHERE thread_id = ${key.threadId}
        AND from_turn_count = ${key.fromTurnCount}
        AND to_turn_count = ${key.toTurnCount}
        AND ignore_whitespace = ${key.ignoreWhitespace ? 1 : 0}
    `,
  });
  const upsert = SqlSchema.void({
    Request: CheckpointTurnDiff,
    execute: (row) => sql`
      INSERT INTO hub_checkpoint_turn_diffs (
        thread_id, from_turn_count, to_turn_count, ignore_whitespace, diff, created_at
      )
      VALUES (
        ${row.threadId}, ${row.fromTurnCount}, ${row.toTurnCount},
        ${row.ignoreWhitespace ? 1 : 0}, ${row.diff}, ${row.createdAt}
      )
      ON CONFLICT (thread_id, from_turn_count, to_turn_count, ignore_whitespace)
      DO UPDATE SET diff = excluded.diff, created_at = excluded.created_at
    `,
  });

  return CheckpointTurnDiffStore.of({
    get: (key) =>
      selectDiff(key).pipe(
        Effect.map(Option.map((row) => row.diff)),
        Effect.mapError(sqlOrDecode("CheckpointTurnDiffStore.get")),
      ),
    put: (row) => upsert(row).pipe(Effect.mapError(sqlOrDecode("CheckpointTurnDiffStore.put"))),
    invalidateFromTurn: ({ threadId, turnCount }) =>
      sql`
        DELETE FROM hub_checkpoint_turn_diffs
        WHERE thread_id = ${threadId}
          AND (to_turn_count >= ${turnCount} OR from_turn_count >= ${turnCount})
      `.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("CheckpointTurnDiffStore.invalidateFromTurn")),
      ),
    removeThread: (threadId: ThreadId) =>
      sql`DELETE FROM hub_checkpoint_turn_diffs WHERE thread_id = ${threadId}`.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("CheckpointTurnDiffStore.removeThread")),
      ),
  });
});

const ThreadVcsStatusRow = ThreadVcsStatus.mapFields((fields) => ({
  ...fields,
  local: Schema.fromJsonString(VcsStatusLocalResult),
  remote: Schema.NullOr(Schema.fromJsonString(VcsStatusRemoteResult)),
}));

export const makeThreadVcsStatusStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* ensureTables;

  const selectAll = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ThreadVcsStatusRow,
    execute: () => sql`
      SELECT thread_id AS "threadId", local_json AS "local", remote_json AS "remote",
        updated_at AS "updatedAt"
      FROM hub_thread_vcs_status
    `,
  });
  const upsert = SqlSchema.void({
    Request: ThreadVcsStatusRow,
    execute: (row) => sql`
      INSERT INTO hub_thread_vcs_status (thread_id, local_json, remote_json, updated_at)
      VALUES (${row.threadId}, ${row.local}, ${row.remote}, ${row.updatedAt})
      ON CONFLICT (thread_id) DO UPDATE SET
        local_json = excluded.local_json,
        remote_json = excluded.remote_json,
        updated_at = excluded.updated_at
    `,
  });

  return ThreadVcsStatusStore.of({
    list: () =>
      selectAll(undefined).pipe(Effect.mapError(sqlOrDecode("ThreadVcsStatusStore.list"))),
    put: (row) => upsert(row).pipe(Effect.mapError(sqlOrDecode("ThreadVcsStatusStore.put"))),
    remove: (threadId) =>
      sql`DELETE FROM hub_thread_vcs_status WHERE thread_id = ${threadId}`.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("ThreadVcsStatusStore.remove")),
      ),
  });
});

/** All three repositories over the configured SQLite client. */
export const HubThreadMachineStateSqliteLive = Layer.mergeAll(
  Layer.effect(RunnerCursorStore, makeRunnerCursorStore),
  Layer.effect(CheckpointTurnDiffStore, makeCheckpointTurnDiffStore),
  Layer.effect(ThreadVcsStatusStore, makeThreadVcsStatusStore),
);
