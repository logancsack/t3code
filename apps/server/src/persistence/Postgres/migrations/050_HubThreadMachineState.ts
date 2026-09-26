/**
 * Hub migration 050: thread-machine state, the first of the 050-099 range.
 *
 * - `hub_runner_cursors`: per thread, the runner outbox identity, the last
 *   runner boot the hub reconciled, and the highest runner event sequence whose
 *   effects are durable in the hub.
 * - `hub_checkpoint_turn_diffs`: patches between two checkpoints of a thread in
 *   both whitespace modes, captured while the machine was awake, so diffs never
 *   wake a machine. This is the hub's only diff table; the standalone
 *   `checkpoint_diff_blobs` table has no hub counterpart.
 * - `hub_thread_vcs_status`: the last git status a runner reported per thread.
 *
 * Every table leads its key with `user_id` and carries the forced tenant policy
 * from the baseline (`hubTenantPolicyStatements`). The statements are
 * idempotent, so a database where an earlier build created these tables
 * outside the migrator still migrates.
 *
 * @module 050_HubThreadMachineState
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { hubTenantPolicyStatements } from "./001_HubBaseline.ts";

const c = `COLLATE "C"`;

export const HUB_THREAD_MACHINE_STATE_TABLES = [
  "hub_runner_cursors",
  "hub_checkpoint_turn_diffs",
  "hub_thread_vcs_status",
] as const;

const statements: ReadonlyArray<string> = [
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
  ...HUB_THREAD_MACHINE_STATE_TABLES.flatMap(hubTenantPolicyStatements),
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) {
    yield* sql.unsafe(statement);
  }
});
