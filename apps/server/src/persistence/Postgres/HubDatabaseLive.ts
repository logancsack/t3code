/**
 * Builds a hub's database: applies hub migrations (with the admin URL when one
 * is configured), grants the runtime role access, and connects the
 * tenant-scoped runtime client. Loaded only in hub mode.
 *
 * @module HubDatabaseLive
 */
import * as Effect from "effect/Effect";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import type { HubDatabaseShape } from "./HubDatabase.ts";
import {
  HubTenantIdError,
  isValidHubTenantId,
  makeHubPool,
  makeTenantSqlClient,
} from "./HubClient.ts";
import { runHubMigrations } from "./HubMigrator.ts";
import { hubMigrations } from "./migrations/index.ts";

export interface HubDatabaseOptions {
  readonly databaseUrl: string;
  readonly databaseAdminUrl?: string | undefined;
  readonly tenantId: string;
}

const quoteIdentifier = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

/**
 * Lets a separate runtime role use the tables the admin role owns. Idempotent;
 * a failure is logged rather than fatal because a platform may manage grants
 * itself, and a missing grant still fails loudly on first use.
 */
const grantRuntimeRole = (admin: SqlClient.SqlClient, runtimeRole: string) =>
  Effect.gen(function* () {
    const [row] = yield* admin<{
      readonly adminRole: string;
      readonly schema: string;
    }>`SELECT current_user AS "adminRole", current_schema() AS "schema"`;
    if (!row || row.adminRole === runtimeRole) {
      return;
    }
    const role = quoteIdentifier(runtimeRole);
    const schema = quoteIdentifier(row.schema);
    yield* admin.unsafe(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    yield* admin.unsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`,
    );
    yield* admin.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role}`);
    // The runtime role may read the migration history but not rewrite it.
    yield* admin.unsafe(
      `REVOKE INSERT, UPDATE, DELETE ON ${schema}.hub_schema_migrations FROM ${role}`,
    );
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not grant the hub runtime role access to hub tables.", {
        cause,
      }),
    ),
  );

export const makeHubDatabase = (options: HubDatabaseOptions) =>
  Effect.gen(function* () {
    if (!isValidHubTenantId(options.tenantId)) {
      return yield* Effect.die(new HubTenantIdError());
    }

    const runtimePool = yield* makeHubPool({ url: options.databaseUrl });
    const [runtime] = yield* runtimePool<{ readonly role: string }>`SELECT current_user AS role`;

    yield* Effect.scoped(
      Effect.gen(function* () {
        const admin = options.databaseAdminUrl
          ? yield* makeHubPool({
              url: options.databaseAdminUrl,
              maxConnections: 1,
              applicationName: "t3-hub-migrate",
            })
          : runtimePool;
        yield* runHubMigrations(hubMigrations).pipe(
          Effect.provideService(SqlClient.SqlClient, admin),
        );
        if (options.databaseAdminUrl && runtime) {
          yield* grantRuntimeRole(admin, runtime.role);
        }
      }),
    );

    const sql = yield* makeTenantSqlClient(runtimePool, options.tenantId);
    return { tenantId: options.tenantId, sql } satisfies HubDatabaseShape;
  }).pipe(Effect.provide(Reactivity.layer));
