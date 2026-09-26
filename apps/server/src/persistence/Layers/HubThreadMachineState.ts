/**
 * SQLite implementations of the hub thread-machine repositories.
 *
 * Used only in hub mode without `T3CODE_HUB_DATABASE_URL` (tests and local
 * development). The tables are created on first use instead of through a
 * numbered migration so standalone databases never gain hub-only tables; the
 * production schema is hub Postgres migrations 050 and 051.
 *
 * @module HubThreadMachineStateSqlite
 */
import {
  ServerProvider,
  VcsStatusLocalResult,
  VcsStatusRemoteResult,
  type ThreadId,
} from "@t3tools/contracts";
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
  McpCredentialRow,
  McpCredentialStore,
  ProviderSnapshotRow,
  ProviderSnapshotStore,
  RunnerCursor,
  RunnerCursorStore,
  ThreadMachineStatusRow,
  ThreadMachineStatusStore,
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
  `CREATE TABLE IF NOT EXISTS hub_thread_machine_status (
    thread_id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    detail TEXT,
    boot_id TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS hub_provider_snapshots (
    instance_id TEXT PRIMARY KEY,
    snapshot_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS hub_mcp_credentials (
    token_hash TEXT PRIMARY KEY,
    environment_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    provider_session_id TEXT NOT NULL,
    provider_instance_id TEXT NOT NULL,
    capabilities_json TEXT NOT NULL,
    issued_at INTEGER NOT NULL,
    last_alive_at INTEGER NOT NULL
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

export const makeThreadMachineStatusStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* ensureTables;

  const selectAll = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ThreadMachineStatusRow,
    execute: () => sql`
      SELECT thread_id AS "threadId", state, detail, boot_id AS "bootId",
        updated_at AS "updatedAt"
      FROM hub_thread_machine_status
    `,
  });
  const upsert = SqlSchema.void({
    Request: ThreadMachineStatusRow,
    execute: (row) => sql`
      INSERT INTO hub_thread_machine_status (thread_id, state, detail, boot_id, updated_at)
      VALUES (${row.threadId}, ${row.state}, ${row.detail}, ${row.bootId}, ${row.updatedAt})
      ON CONFLICT (thread_id) DO UPDATE SET
        state = excluded.state,
        detail = excluded.detail,
        boot_id = excluded.boot_id,
        updated_at = excluded.updated_at
    `,
  });

  return ThreadMachineStatusStore.of({
    list: () =>
      selectAll(undefined).pipe(Effect.mapError(sqlOrDecode("ThreadMachineStatusStore.list"))),
    put: (row) => upsert(row).pipe(Effect.mapError(sqlOrDecode("ThreadMachineStatusStore.put"))),
    remove: (threadId) =>
      sql`DELETE FROM hub_thread_machine_status WHERE thread_id = ${threadId}`.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("ThreadMachineStatusStore.remove")),
      ),
  });
});

const ProviderSnapshotDbRow = ProviderSnapshotRow.mapFields((fields) => ({
  ...fields,
  snapshot: Schema.fromJsonString(ServerProvider),
}));

export const makeProviderSnapshotStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* ensureTables;

  const selectAll = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProviderSnapshotDbRow,
    execute: () => sql`
      SELECT instance_id AS "instanceId", snapshot_json AS snapshot, updated_at AS "updatedAt"
      FROM hub_provider_snapshots
    `,
  });
  const upsert = SqlSchema.void({
    Request: ProviderSnapshotDbRow,
    execute: (row) => sql`
      INSERT INTO hub_provider_snapshots (instance_id, snapshot_json, updated_at)
      VALUES (${row.instanceId}, ${row.snapshot}, ${row.updatedAt})
      ON CONFLICT (instance_id) DO UPDATE SET
        snapshot_json = excluded.snapshot_json,
        updated_at = excluded.updated_at
    `,
  });

  return ProviderSnapshotStore.of({
    list: () =>
      selectAll(undefined).pipe(Effect.mapError(sqlOrDecode("ProviderSnapshotStore.list"))),
    put: (row) => upsert(row).pipe(Effect.mapError(sqlOrDecode("ProviderSnapshotStore.put"))),
  });
});

const McpCredentialDbRow = McpCredentialRow.mapFields((fields) => ({
  ...fields,
  capabilities: Schema.fromJsonString(fields.capabilities),
}));

export const makeMcpCredentialStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* ensureTables;

  const selectAll = SqlSchema.findAll({
    Request: Schema.Void,
    Result: McpCredentialDbRow,
    execute: () => sql`
      SELECT token_hash AS "tokenHash", environment_id AS "environmentId",
        thread_id AS "threadId", provider_session_id AS "providerSessionId",
        provider_instance_id AS "providerInstanceId", capabilities_json AS capabilities,
        issued_at AS "issuedAt", last_alive_at AS "lastAliveAt"
      FROM hub_mcp_credentials
    `,
  });
  const insert = SqlSchema.void({
    Request: McpCredentialDbRow,
    execute: (row) => sql`
      INSERT INTO hub_mcp_credentials (
        token_hash, environment_id, thread_id, provider_session_id, provider_instance_id,
        capabilities_json, issued_at, last_alive_at
      )
      VALUES (
        ${row.tokenHash}, ${row.environmentId}, ${row.threadId}, ${row.providerSessionId},
        ${row.providerInstanceId}, ${row.capabilities}, ${row.issuedAt}, ${row.lastAliveAt}
      )
      ON CONFLICT (token_hash) DO UPDATE SET last_alive_at = excluded.last_alive_at
    `,
  });

  return McpCredentialStore.of({
    list: () => selectAll(undefined).pipe(Effect.mapError(sqlOrDecode("McpCredentialStore.list"))),
    put: (row) => insert(row).pipe(Effect.mapError(sqlOrDecode("McpCredentialStore.put"))),
    touch: (tokenHashes, lastAliveAt) =>
      tokenHashes.length === 0
        ? Effect.void
        : sql`
            UPDATE hub_mcp_credentials SET last_alive_at = ${lastAliveAt}
            WHERE token_hash IN ${sql.in(tokenHashes)}
          `.pipe(Effect.asVoid, Effect.mapError(toPersistenceSqlError("McpCredentialStore.touch"))),
    remove: (tokenHashes) =>
      tokenHashes.length === 0
        ? Effect.void
        : sql`DELETE FROM hub_mcp_credentials WHERE token_hash IN ${sql.in(tokenHashes)}`.pipe(
            Effect.asVoid,
            Effect.mapError(toPersistenceSqlError("McpCredentialStore.remove")),
          ),
  });
});

/** Every repository over the configured SQLite client. */
export const HubThreadMachineStateSqliteLive = Layer.mergeAll(
  Layer.effect(RunnerCursorStore, makeRunnerCursorStore),
  Layer.effect(CheckpointTurnDiffStore, makeCheckpointTurnDiffStore),
  Layer.effect(ThreadVcsStatusStore, makeThreadVcsStatusStore),
  Layer.effect(ThreadMachineStatusStore, makeThreadMachineStatusStore),
  Layer.effect(ProviderSnapshotStore, makeProviderSnapshotStore),
  Layer.effect(McpCredentialStore, makeMcpCredentialStore),
);
