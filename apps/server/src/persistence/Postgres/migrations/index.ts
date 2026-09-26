/**
 * Hub migration registry. Add a numbered file under this directory and list it
 * in the range that owns it; `runHubMigrations` orders entries by id, so the
 * position in these lists does not matter.
 *
 * Tenant tables lead every key and index with `user_id` and enable the tenant
 * policy (`hubTenantPolicyStatements` in 001). Migrations must stay compatible
 * with the previous hub release, which may still be running.
 */
import { orderHubMigrations, type HubMigrationEntry } from "../HubMigrator.ts";
import Migration001 from "./001_HubBaseline.ts";
import Migration050 from "./050_HubThreadMachineState.ts";
import Migration051 from "./051_HubThreadMachineServices.ts";

/** 001–049: hub persistence (orchestration, auth, settings, secrets, attachments). */
const hubPersistenceMigrations: ReadonlyArray<HubMigrationEntry> = [
  { id: 1, name: "HubBaseline", migration: Migration001 },
];

/**
 * 050–099: thread-machine state (runner cursors, per-turn diffs, git status,
 * machine states, provider snapshots, MCP credentials).
 */
const threadMachineMigrations: ReadonlyArray<HubMigrationEntry> = [
  { id: 50, name: "HubThreadMachineState", migration: Migration050 },
  { id: 51, name: "HubThreadMachineServices", migration: Migration051 },
];

export const hubMigrations = orderHubMigrations([
  ...hubPersistenceMigrations,
  ...threadMachineMigrations,
]);
