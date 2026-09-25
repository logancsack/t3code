/**
 * Disposable hub databases for Postgres-backed tests.
 *
 * Tests run only when `T3_HUB_TEST_DATABASE_URL` points at a database the test
 * may create schemas in, e.g. a private local cluster:
 *
 *   T3_HUB_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54359/postgres
 *
 * Each test schema is created with a unique name and dropped afterwards. When
 * the connecting role is a superuser or has `BYPASSRLS` (a local cluster), a
 * throwaway login role without those attributes is created too and used as the
 * hub runtime role, so row-level security is exercised end to end. Otherwise
 * the connecting role is used directly; `FORCE ROW LEVEL SECURITY` makes the
 * policies apply to it as the table owner.
 *
 * @module hubTestDatabase
 */
import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";

import { HubDatabase } from "./HubDatabase.ts";
import { makeHubDatabase } from "./HubDatabaseLive.ts";
import { makeHubPool } from "./HubClient.ts";

export const hubTestDatabaseUrl = process.env.T3_HUB_TEST_DATABASE_URL?.trim() || undefined;

export interface HubTestSchema {
  readonly schema: string;
  /** Owner of the schema's tables; applies migrations. */
  readonly adminUrl: string;
  /** The hub runtime role; subject to row-level security. */
  readonly runtimeUrl: string;
  /** Whether a separate role without BYPASSRLS was created for the runtime. */
  readonly separateRuntimeRole: boolean;
}

const withSearchPath = (url: string, schema: string, credentials?: [string, string]) => {
  const parsed = new URL(url);
  parsed.searchParams.set("options", `-c search_path=${schema}`);
  if (credentials) {
    parsed.username = credentials[0];
    parsed.password = credentials[1];
  }
  return parsed.toString();
};

/** Creates a unique schema (and runtime role when possible); drops both on scope close. */
export const makeHubTestSchema = (baseUrl: string) =>
  Effect.gen(function* () {
    const suffix = NodeCrypto.randomBytes(6).toString("hex");
    const schema = `tm_hub_test_${suffix}`;
    const admin = yield* makeHubPool({
      url: baseUrl,
      maxConnections: 1,
      applicationName: "t3-hub-test",
    });
    const [attributes] = yield* admin<{
      readonly rolsuper: boolean;
      readonly rolbypassrls: boolean;
    }>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    const needsRuntimeRole = attributes?.rolsuper === true || attributes?.rolbypassrls === true;
    const runtimeRole = `${schema}_app`;
    const runtimePassword = NodeCrypto.randomBytes(12).toString("hex");

    yield* Effect.acquireRelease(
      Effect.gen(function* () {
        yield* admin.unsafe(`CREATE SCHEMA ${schema}`);
        if (needsRuntimeRole) {
          yield* admin.unsafe(
            `CREATE ROLE ${runtimeRole} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${runtimePassword}'`,
          );
        }
      }),
      () =>
        Effect.gen(function* () {
          if (needsRuntimeRole) {
            yield* admin.unsafe(
              `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '${runtimeRole}'`,
            );
          }
          yield* admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
          if (needsRuntimeRole) {
            yield* admin.unsafe(`DROP OWNED BY ${runtimeRole}`);
            yield* admin.unsafe(`DROP ROLE IF EXISTS ${runtimeRole}`);
          }
        }).pipe(Effect.orDie),
    );

    const adminUrl = withSearchPath(baseUrl, schema);
    return {
      schema,
      adminUrl,
      runtimeUrl: needsRuntimeRole
        ? withSearchPath(baseUrl, schema, [runtimeRole, runtimePassword])
        : adminUrl,
      separateRuntimeRole: needsRuntimeRole,
    } satisfies HubTestSchema;
  }).pipe(Effect.provide(Reactivity.layer));

/** A migrated hub database for one tenant in the given test schema. */
export const hubTestDatabaseLayer = (schema: HubTestSchema, tenantId: string) =>
  Layer.effect(
    HubDatabase,
    makeHubDatabase({
      databaseUrl: schema.runtimeUrl,
      databaseAdminUrl: schema.separateRuntimeRole ? schema.adminUrl : undefined,
      tenantId,
    }),
  );
