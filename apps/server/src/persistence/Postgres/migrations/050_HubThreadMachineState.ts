/**
 * Hub Postgres migration 050: thread-machine state.
 *
 * - `hub_runner_cursors`: per thread, the runner outbox identity, the last
 *   runner boot the hub reconciled, and the highest runner event sequence whose
 *   effects are durable in the hub.
 * - `hub_checkpoint_turn_diffs`: patches between two checkpoints of a thread,
 *   captured while the machine was awake, so diffs never wake a machine.
 * - `hub_thread_vcs_status`: the last git status a runner reported per thread.
 *
 * Every table leads with `user_id` and carries the same row-level-security
 * backstop as the hub baseline (`hub.user_id` transaction setting).
 *
 * Registration: hub migrations 001-049 belong to the hub persistence
 * framework (feature/tm-hub). TODO(tm-hub integration): add this module to
 * that framework's migration list as id 50, name "HubThreadMachineState".
 * Until then `HUB_MIGRATION_050` can be applied directly; every statement is
 * idempotent.
 *
 * @module 050_HubThreadMachineState
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export const HUB_MIGRATION_050_ID = 50;
export const HUB_MIGRATION_050_NAME = "HubThreadMachineState";

const c = `COLLATE "C"`;

export const HUB_THREAD_MACHINE_STATE_TABLES = [
  "hub_runner_cursors",
  "hub_checkpoint_turn_diffs",
  "hub_thread_vcs_status",
] as const;

export const HUB_MIGRATION_050_STATEMENTS: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS hub_runner_cursors (
    user_id text ${c} NOT NULL,
    thread_id text ${c} NOT NULL,
    outbox_id text ${c} NOT NULL,
    boot_id text ${c} NOT NULL,
    acked_sequence bigint NOT NULL,
    updated_at text ${c} NOT NULL,
    PRIMARY KEY (user_id, thread_id)
  )`,
  `CREATE TABLE IF NOT EXISTS hub_checkpoint_turn_diffs (
    user_id text ${c} NOT NULL,
    thread_id text ${c} NOT NULL,
    from_turn_count integer NOT NULL,
    to_turn_count integer NOT NULL,
    ignore_whitespace boolean NOT NULL,
    diff text NOT NULL,
    created_at text ${c} NOT NULL,
    PRIMARY KEY (user_id, thread_id, from_turn_count, to_turn_count, ignore_whitespace)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_hub_checkpoint_turn_diffs_thread_to_turn
    ON hub_checkpoint_turn_diffs (user_id, thread_id, to_turn_count)`,
  `CREATE TABLE IF NOT EXISTS hub_thread_vcs_status (
    user_id text ${c} NOT NULL,
    thread_id text ${c} NOT NULL,
    local_json text NOT NULL,
    remote_json text,
    updated_at text ${c} NOT NULL,
    PRIMARY KEY (user_id, thread_id)
  )`,
  ...HUB_THREAD_MACHINE_STATE_TABLES.flatMap((table) => [
    `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`,
    `DROP POLICY IF EXISTS hub_tenant_isolation ON ${table}`,
    `CREATE POLICY hub_tenant_isolation ON ${table}
      USING (user_id = current_setting('hub.user_id', true))
      WITH CHECK (user_id = current_setting('hub.user_id', true))`,
  ]),
];

/** Applies migration 050 idempotently in one transaction. */
export const HUB_MIGRATION_050 = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.withTransaction(
    Effect.forEach(HUB_MIGRATION_050_STATEMENTS, (statement) => sql.unsafe(statement), {
      discard: true,
    }),
  );
});

export default HUB_MIGRATION_050;
