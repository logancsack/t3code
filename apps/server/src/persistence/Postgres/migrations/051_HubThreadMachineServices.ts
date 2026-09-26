/**
 * Hub migration 051: state behind the hub's thread-machine services.
 *
 * - `hub_thread_machine_status`: the last machine state the directory reported
 *   per thread, so thread shells show it without asking the directory again.
 * - `hub_provider_snapshots`: the last provider snapshot (status, auth, models)
 *   a runner reported per provider instance.
 * - `hub_mcp_credentials`: hashes and scopes of the MCP credentials minted for
 *   provider sessions, which run on thread machines and outlive the hub.
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

export const HUB_THREAD_MACHINE_SERVICE_TABLES = [
  "hub_thread_machine_status",
  "hub_provider_snapshots",
  "hub_mcp_credentials",
] as const;

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
  `CREATE TABLE IF NOT EXISTS hub_provider_snapshots (
    user_id text ${c} NOT NULL,
    instance_id text ${c} NOT NULL,
    snapshot_json text NOT NULL,
    updated_at text ${c} NOT NULL,
    PRIMARY KEY (user_id, instance_id)
  )`,
  `CREATE TABLE IF NOT EXISTS hub_mcp_credentials (
    user_id text ${c} NOT NULL,
    token_hash text ${c} NOT NULL,
    environment_id text ${c} NOT NULL,
    thread_id text ${c} NOT NULL,
    provider_session_id text ${c} NOT NULL,
    provider_instance_id text ${c} NOT NULL,
    capabilities_json text NOT NULL,
    issued_at bigint NOT NULL,
    last_alive_at bigint NOT NULL,
    PRIMARY KEY (user_id, token_hash)
  )`,
  ...HUB_THREAD_MACHINE_SERVICE_TABLES.flatMap(hubTenantPolicyStatements),
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) {
    yield* sql.unsafe(statement);
  }
});
