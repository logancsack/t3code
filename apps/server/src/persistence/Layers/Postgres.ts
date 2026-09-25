import * as PgClient from "@effect/sql-pg/PgClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { HUB_BASELINE_STATEMENTS, HUB_SCHEMA_VERSION } from "../Postgres/Schema.ts";

export interface HubPostgresConfig {
  readonly url: string;
  readonly maxConnections?: number;
  readonly applicationName?: string;
}

// node-postgres returns int8/numeric as strings. Hub sequences, COUNT(*) and
// MAX(sequence) are int8, and the shared row schemas decode numbers, so parse
// them here. Values stay far below 2^53 (sequences are per user).
const identity = (value: string) => value;
const toNumber = (value: string) => Number(value);
const HUB_TYPE_PARSERS: Record<number, (value: string) => unknown> = {
  16: (value) => value === "t", // bool
  20: toNumber, // int8
  21: toNumber, // int2
  23: toNumber, // int4
  26: toNumber, // oid
  700: toNumber, // float4
  701: toNumber, // float8
  1700: toNumber, // numeric (SUM of int8)
  114: (value) => JSON.parse(value), // json
  3802: (value) => JSON.parse(value), // jsonb
};

export const hubPgTypes = {
  getTypeParser: (oid: number, format?: string) =>
    format === "binary" ? identity : (HUB_TYPE_PARSERS[oid] ?? identity),
} as unknown as NonNullable<PgClient.PgClientConfig["types"]>;

export const makeHubPgClientLayer = (config: HubPostgresConfig) =>
  PgClient.layer({
    url: Redacted.make(config.url),
    maxConnections: config.maxConnections ?? 10,
    applicationName: config.applicationName ?? "t3-hub",
    types: hubPgTypes,
  });

// Arbitrary constant; serializes concurrent hub processes applying the baseline.
const HUB_SCHEMA_LOCK_KEY = 7_330_001;

/**
 * Applies the baseline idempotently. Transaction-scoped advisory locks are safe
 * behind PgBouncer transaction pooling; session-level locks are not.
 */
export const ensureHubSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`SELECT pg_advisory_xact_lock(${HUB_SCHEMA_LOCK_KEY})`;
      for (const statement of HUB_BASELINE_STATEMENTS) {
        yield* sql.unsafe(statement);
      }
      yield* sql`
        INSERT INTO hub_schema_version (version)
        VALUES (${HUB_SCHEMA_VERSION})
        ON CONFLICT (version) DO NOTHING
      `;
    }),
  );
});

/** Shared pool plus schema, provided once per hub process. */
export const makeHubPostgresPersistenceLive = (config: HubPostgresConfig) =>
  Layer.provideMerge(Layer.effectDiscard(ensureHubSchema), makeHubPgClientLayer(config));
