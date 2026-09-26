/**
 * Hub migration 051: state behind the hub's thread-machine services.
 *
 * - `hub_thread_machine_status`: the last machine state the directory reported
 *   per thread, so thread shells show it without asking the directory again.
 *
 * Every table leads its key with `user_id` and carries the forced tenant policy
 * from the baseline (`hubTenantPolicyStatements`). The statements are
 * idempotent.
 *
 * @module 051_HubThreadMachineServices
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { hubTenantPolicyStatements } from "./001_HubBaseline.ts";

const c = `COLLATE "C"`;

export const HUB_THREAD_MACHINE_SERVICE_TABLES = ["hub_thread_machine_status"] as const;

const statements: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS hub_thread_machine_status (
    user_id text ${c} NOT NULL,
    thread_id text ${c} NOT NULL,
    state text ${c} NOT NULL,
    detail text,
    boot_id text ${c},
    updated_at text ${c} NOT NULL,
    PRIMARY KEY (user_id, thread_id)
  )`,
  ...HUB_THREAD_MACHINE_SERVICE_TABLES.flatMap(hubTenantPolicyStatements),
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) {
    yield* sql.unsafe(statement);
  }
});
