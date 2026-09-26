/**
 * A hub's database.
 *
 * - `migrateHubDatabase` (`t3 hub migrate`): applies every pending hub
 *   migration with the admin URL (or the runtime URL when none is configured)
 *   and grants the runtime role access. It touches no tenant data.
 * - `makeHubDatabase` connects the tenant-scoped runtime client. A tenant
 *   process normally has no admin URL: it then only verifies that the schema
 *   has every migration this build knows and fails clearly when it does not,
 *   never attempting DDL with the runtime role. Given an admin URL
 *   (development, tests) it migrates first, as `t3 hub migrate` would.
 *
 * Loaded only in hub mode.
 *
 * @module HubDatabaseLive
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import type { HubDatabaseShape } from "./HubDatabase.ts";
import {
  HubTenantIdError,
  isValidHubTenantId,
  makeHubPool,
  makeTenantSqlClient,
} from "./HubClient.ts";
import { type HubMigrationEntry, pendingHubMigrations, runHubMigrations } from "./HubMigrator.ts";
import { hubMigrations } from "./migrations/index.ts";

export interface HubDatabaseOptions {
  readonly databaseUrl: string;
  readonly databaseAdminUrl?: string | undefined;
  /** Required; optional only because hub configuration without a database has none. */
  readonly tenantId: string | undefined;
}

const quoteIdentifier = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

/** The hub schema lacks migrations this build needs; run `t3 hub migrate`. */
export class HubSchemaNotMigratedError extends Schema.TaggedErrorClass<HubSchemaNotMigratedError>()(
  "HubSchemaNotMigratedError",
  { missing: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return `The hub database schema is missing migrations ${this.missing.join(", ")}. Run \`t3 hub migrate\` with the migration role before starting hub processes.`;
  }
}

/** Grants the runtime role DML on the admin role's hub tables (see `grantRuntimeRole`). */
const grantStatements = (admin: SqlClient.SqlClient, runtimeRole: string) =>
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
  });

/**
 * Lets a separate runtime role use the tables the admin role owns. Idempotent;
 * during a hub's own startup a failure is logged rather than fatal because a
 * platform may manage grants itself, and a missing grant still fails loudly on
 * first use.
 */
const grantRuntimeRole = (admin: SqlClient.SqlClient, runtimeRole: string) =>
  grantStatements(admin, runtimeRole).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not grant the hub runtime role access to hub tables.", {
        cause,
      }),
    ),
  );

export interface HubMigrateOptions {
  readonly databaseUrl: string;
  /** The schema owner; the runtime role migrates when absent. */
  readonly databaseAdminUrl?: string | undefined;
  /** For tests; defaults to every hub migration this build has. */
  readonly migrations?: ReadonlyArray<HubMigrationEntry>;
}

export interface HubMigrateReport {
  readonly applied: ReadonlyArray<Pick<HubMigrationEntry, "id" | "name">>;
  /** The runtime role that was granted access, when it differs from the admin role. */
  readonly grantedRole: string | null;
}

/**
 * `t3 hub migrate`: applies every pending hub migration and grants the runtime
 * role access. Idempotent, tenant-independent, and strict: a failed grant
 * fails the command, because tenant processes cannot migrate or grant.
 */
export const migrateHubDatabase = (options: HubMigrateOptions) =>
  Effect.gen(function* () {
    const runtimePool = yield* makeHubPool({
      url: options.databaseUrl,
      maxConnections: 1,
      applicationName: "t3-hub-migrate",
    });
    const [runtime] = yield* runtimePool<{ readonly role: string }>`SELECT current_user AS role`;
    const admin = options.databaseAdminUrl
      ? yield* makeHubPool({
          url: options.databaseAdminUrl,
          maxConnections: 1,
          applicationName: "t3-hub-migrate",
        })
      : runtimePool;
    const applied = yield* runHubMigrations(options.migrations ?? hubMigrations).pipe(
      Effect.provideService(SqlClient.SqlClient, admin),
    );
    const [adminRow] = yield* admin<{ readonly role: string }>`SELECT current_user AS role`;
    const grantedRole =
      options.databaseAdminUrl && runtime && adminRow && adminRow.role !== runtime.role
        ? runtime.role
        : null;
    if (grantedRole !== null) yield* grantStatements(admin, grantedRole);
    return { applied, grantedRole } satisfies HubMigrateReport;
  }).pipe(Effect.scoped, Effect.provide(Reactivity.layer));

export const makeHubDatabase = (options: HubDatabaseOptions) =>
  Effect.gen(function* () {
    const tenantId = options.tenantId;
    if (tenantId === undefined || !isValidHubTenantId(tenantId)) {
      return yield* Effect.die(new HubTenantIdError());
    }

    const runtimePool = yield* makeHubPool({ url: options.databaseUrl });
    const [runtime] = yield* runtimePool<{ readonly role: string }>`SELECT current_user AS role`;

    if (options.databaseAdminUrl) {
      // Development and tests: migrate here, as `t3 hub migrate` would.
      yield* Effect.scoped(
        Effect.gen(function* () {
          const admin = yield* makeHubPool({
            url: options.databaseAdminUrl!,
            maxConnections: 1,
            applicationName: "t3-hub-migrate",
          });
          yield* runHubMigrations(hubMigrations).pipe(
            Effect.provideService(SqlClient.SqlClient, admin),
          );
          if (runtime) yield* grantRuntimeRole(admin, runtime.role);
        }),
      );
    } else {
      // A tenant process never changes the schema: it only checks it is current.
      const pending = yield* pendingHubMigrations(hubMigrations).pipe(
        Effect.provideService(SqlClient.SqlClient, runtimePool),
      );
      if (pending.length > 0) {
        return yield* new HubSchemaNotMigratedError({
          missing: pending.map((entry) => `${String(entry.id).padStart(3, "0")}_${entry.name}`),
        });
      }
    }

    const sql = yield* makeTenantSqlClient(runtimePool, tenantId);
    return { tenantId, sql } satisfies HubDatabaseShape;
  }).pipe(Effect.provide(Reactivity.layer));
