/**
 * Postgres implementations of the hub thread-machine repositories
 * (tables from hub migrations 050 and 051). Every statement is scoped to the
 * `HubTenant` user, like the rest of the hub schema.
 *
 * @module HubThreadMachineStatePostgres
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
import { HubTenant } from "./HubTenant.ts";

const sqlOrDecode = (operation: string) => (cause: unknown) =>
  Schema.isSchemaError(cause)
    ? toPersistenceDecodeError(operation)(cause)
    : toPersistenceSqlError(operation)(cause);

export const makeRunnerCursorStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const { userId } = yield* HubTenant;

  const selectOne = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: RunnerCursor,
    execute: (threadId) => sql`
      SELECT thread_id AS "threadId", outbox_id AS "outboxId", boot_id AS "bootId",
        acked_sequence AS "ackedSequence", updated_at AS "updatedAt"
      FROM hub_runner_cursors WHERE user_id = ${userId} AND thread_id = ${threadId}
    `,
  });
  const selectAll = SqlSchema.findAll({
    Request: Schema.Void,
    Result: RunnerCursor,
    execute: () => sql`
      SELECT thread_id AS "threadId", outbox_id AS "outboxId", boot_id AS "bootId",
        acked_sequence AS "ackedSequence", updated_at AS "updatedAt"
      FROM hub_runner_cursors WHERE user_id = ${userId} ORDER BY thread_id
    `,
  });
  const upsert = SqlSchema.void({
    Request: RunnerCursor,
    execute: (row) => sql`
      INSERT INTO hub_runner_cursors (
        user_id, thread_id, outbox_id, boot_id, acked_sequence, updated_at
      )
      VALUES (
        ${userId}, ${row.threadId}, ${row.outboxId}, ${row.bootId}, ${row.ackedSequence},
        ${row.updatedAt}
      )
      ON CONFLICT (user_id, thread_id) DO UPDATE SET
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
      sql`DELETE FROM hub_runner_cursors WHERE user_id = ${userId} AND thread_id = ${threadId}`.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("RunnerCursorStore.remove")),
      ),
  });
});

export const makeCheckpointTurnDiffStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const { userId } = yield* HubTenant;

  const selectDiff = SqlSchema.findOneOption({
    Request: CheckpointTurnDiffKey,
    Result: Schema.Struct({ diff: Schema.String }),
    execute: (key) => sql`
      SELECT diff FROM hub_checkpoint_turn_diffs
      WHERE user_id = ${userId}
        AND thread_id = ${key.threadId}
        AND from_turn_count = ${key.fromTurnCount}
        AND to_turn_count = ${key.toTurnCount}
        AND ignore_whitespace = ${key.ignoreWhitespace}
    `,
  });
  const upsert = SqlSchema.void({
    Request: CheckpointTurnDiff,
    execute: (row) => sql`
      INSERT INTO hub_checkpoint_turn_diffs (
        user_id, thread_id, from_turn_count, to_turn_count, ignore_whitespace, diff, created_at
      )
      VALUES (
        ${userId}, ${row.threadId}, ${row.fromTurnCount}, ${row.toTurnCount},
        ${row.ignoreWhitespace}, ${row.diff}, ${row.createdAt}
      )
      ON CONFLICT (user_id, thread_id, from_turn_count, to_turn_count, ignore_whitespace)
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
        WHERE user_id = ${userId}
          AND thread_id = ${threadId}
          AND (to_turn_count >= ${turnCount} OR from_turn_count >= ${turnCount})
      `.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("CheckpointTurnDiffStore.invalidateFromTurn")),
      ),
    removeThread: (threadId: ThreadId) =>
      sql`
        DELETE FROM hub_checkpoint_turn_diffs WHERE user_id = ${userId} AND thread_id = ${threadId}
      `.pipe(
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
  const { userId } = yield* HubTenant;

  const selectAll = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ThreadVcsStatusRow,
    execute: () => sql`
      SELECT thread_id AS "threadId", local_json AS "local", remote_json AS "remote",
        updated_at AS "updatedAt"
      FROM hub_thread_vcs_status WHERE user_id = ${userId}
    `,
  });
  const upsert = SqlSchema.void({
    Request: ThreadVcsStatusRow,
    execute: (row) => sql`
      INSERT INTO hub_thread_vcs_status (user_id, thread_id, local_json, remote_json, updated_at)
      VALUES (${userId}, ${row.threadId}, ${row.local}, ${row.remote}, ${row.updatedAt})
      ON CONFLICT (user_id, thread_id) DO UPDATE SET
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
      sql`
        DELETE FROM hub_thread_vcs_status WHERE user_id = ${userId} AND thread_id = ${threadId}
      `.pipe(Effect.asVoid, Effect.mapError(toPersistenceSqlError("ThreadVcsStatusStore.remove"))),
  });
});

export const makeThreadMachineStatusStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const { userId } = yield* HubTenant;

  const selectAll = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ThreadMachineStatusRow,
    execute: () => sql`
      SELECT thread_id AS "threadId", state, detail, boot_id AS "bootId",
        updated_at AS "updatedAt"
      FROM hub_thread_machine_status WHERE user_id = ${userId}
    `,
  });
  const upsert = SqlSchema.void({
    Request: ThreadMachineStatusRow,
    execute: (row) => sql`
      INSERT INTO hub_thread_machine_status (
        user_id, thread_id, state, detail, boot_id, updated_at
      )
      VALUES (
        ${userId}, ${row.threadId}, ${row.state}, ${row.detail}, ${row.bootId}, ${row.updatedAt}
      )
      ON CONFLICT (user_id, thread_id) DO UPDATE SET
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
      sql`
        DELETE FROM hub_thread_machine_status WHERE user_id = ${userId} AND thread_id = ${threadId}
      `.pipe(
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
  const { userId } = yield* HubTenant;

  const selectAll = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProviderSnapshotDbRow,
    execute: () => sql`
      SELECT instance_id AS "instanceId", snapshot_json AS snapshot, updated_at AS "updatedAt"
      FROM hub_provider_snapshots WHERE user_id = ${userId}
    `,
  });
  const upsert = SqlSchema.void({
    Request: ProviderSnapshotDbRow,
    execute: (row) => sql`
      INSERT INTO hub_provider_snapshots (user_id, instance_id, snapshot_json, updated_at)
      VALUES (${userId}, ${row.instanceId}, ${row.snapshot}, ${row.updatedAt})
      ON CONFLICT (user_id, instance_id) DO UPDATE SET
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
  issuedAt: Schema.NumberFromString,
  lastAliveAt: Schema.NumberFromString,
}));

export const makeMcpCredentialStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const { userId } = yield* HubTenant;

  const selectAll = SqlSchema.findAll({
    Request: Schema.Void,
    Result: McpCredentialDbRow,
    execute: () => sql`
      SELECT token_hash AS "tokenHash", environment_id AS "environmentId",
        thread_id AS "threadId", provider_session_id AS "providerSessionId",
        provider_instance_id AS "providerInstanceId", capabilities_json AS capabilities,
        issued_at::text AS "issuedAt", last_alive_at::text AS "lastAliveAt"
      FROM hub_mcp_credentials WHERE user_id = ${userId}
    `,
  });
  const insert = SqlSchema.void({
    Request: McpCredentialDbRow,
    execute: (row) => sql`
      INSERT INTO hub_mcp_credentials (
        user_id, token_hash, environment_id, thread_id, provider_session_id,
        provider_instance_id, capabilities_json, issued_at, last_alive_at
      )
      VALUES (
        ${userId}, ${row.tokenHash}, ${row.environmentId}, ${row.threadId},
        ${row.providerSessionId}, ${row.providerInstanceId}, ${row.capabilities},
        ${row.issuedAt}::bigint, ${row.lastAliveAt}::bigint
      )
      ON CONFLICT (user_id, token_hash) DO UPDATE SET last_alive_at = excluded.last_alive_at
    `,
  });

  return McpCredentialStore.of({
    list: () => selectAll(undefined).pipe(Effect.mapError(sqlOrDecode("McpCredentialStore.list"))),
    put: (row) => insert(row).pipe(Effect.mapError(sqlOrDecode("McpCredentialStore.put"))),
    touch: (tokenHashes, lastAliveAt) =>
      tokenHashes.length === 0
        ? Effect.void
        : sql`
            UPDATE hub_mcp_credentials SET last_alive_at = ${String(lastAliveAt)}::bigint
            WHERE user_id = ${userId} AND token_hash IN ${sql.in(tokenHashes)}
          `.pipe(Effect.asVoid, Effect.mapError(toPersistenceSqlError("McpCredentialStore.touch"))),
    remove: (tokenHashes) =>
      tokenHashes.length === 0
        ? Effect.void
        : sql`
            DELETE FROM hub_mcp_credentials
            WHERE user_id = ${userId} AND token_hash IN ${sql.in(tokenHashes)}
          `.pipe(
            Effect.asVoid,
            Effect.mapError(toPersistenceSqlError("McpCredentialStore.remove")),
          ),
  });
});

/** Every repository; requires the hub Postgres `SqlClient` and `HubTenant`. */
export const HubThreadMachineStatePostgresLive = Layer.mergeAll(
  Layer.effect(RunnerCursorStore, makeRunnerCursorStore),
  Layer.effect(CheckpointTurnDiffStore, makeCheckpointTurnDiffStore),
  Layer.effect(ThreadVcsStatusStore, makeThreadVcsStatusStore),
  Layer.effect(ThreadMachineStatusStore, makeThreadMachineStatusStore),
  Layer.effect(ProviderSnapshotStore, makeProviderSnapshotStore),
  Layer.effect(McpCredentialStore, makeMcpCredentialStore),
);
