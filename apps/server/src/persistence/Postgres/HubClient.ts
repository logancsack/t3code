/**
 * Postgres clients for the hub.
 *
 * The runtime client applies the tenant to every unit of work so the
 * row-level-security policies (see migration 001) can check it: transactions
 * begin with `SET LOCAL hub.user_id = '<tenant>'`, and statements issued outside
 * a transaction run in their own tenant transaction. Nothing is set per
 * session, so the client is safe behind a transaction-mode pooler (PgBouncer):
 * the setting never outlives the transaction that carries it.
 *
 * `SET LOCAL` is a utility statement and takes no snapshot, so a transaction
 * may still start with `SET TRANSACTION ISOLATION LEVEL ...` after it.
 *
 * @module HubClient
 */
import * as PgClient from "@effect/sql-pg/PgClient";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type * as SqlConnection from "effect/unstable/sql/SqlConnection";
import type { SqlError } from "effect/unstable/sql/SqlError";

/** The transaction-local setting the row-level-security policies compare with `user_id`. */
export const HUB_TENANT_SETTING = "hub.user_id";

// Aldo user ids are opaque but plain (UUIDs, `user_...`). Restricting the
// alphabet keeps the tenant safe to embed as a literal in `SET LOCAL`, which
// cannot take a bind parameter.
const HUB_TENANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,199}$/;

export const isValidHubTenantId = (tenantId: string): boolean =>
  HUB_TENANT_ID_PATTERN.test(tenantId);

export class HubTenantIdError extends Error {
  constructor() {
    super(
      "T3CODE_HUB_TENANT_ID must be 1-200 characters of letters, digits, '_', '.', ':', '@', or '-'.",
    );
    this.name = "HubTenantIdError";
  }
}

export const hubTenantSettingStatement = (tenantId: string): string => {
  if (!isValidHubTenantId(tenantId)) {
    throw new HubTenantIdError();
  }
  return `SET LOCAL ${HUB_TENANT_SETTING} = '${tenantId}'`;
};

// node-postgres returns int8/numeric as strings and bytea as hex text. Hub
// sequences, COUNT(*) and MAX(sequence) are int8, and the shared row schemas
// decode numbers, so parse them here. Values stay far below 2^53 (sequences
// are per user).
const identity = (value: string) => value;
const toNumber = (value: string) => Number(value);
const HUB_TYPE_PARSERS: Record<number, (value: string) => unknown> = {
  16: (value) => value === "t", // bool
  17: (value) => Buffer.from(value.slice(2), "hex"), // bytea (\x...)
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

export interface HubPoolOptions {
  readonly url: string;
  readonly maxConnections?: number;
  readonly applicationName?: string;
}

/** A plain pooled client: migrations and administration only (no tenant). */
export const makeHubPool = (options: HubPoolOptions) =>
  PgClient.make({
    url: Redacted.make(options.url),
    // Many hub processes share one database, and PlanetScale's direct port
    // allows few connections. One user's engine is a single writer, so a
    // handful of connections is enough.
    maxConnections: options.maxConnections ?? 4,
    idleTimeout: "30 seconds",
    connectTimeout: "10 seconds",
    applicationName: options.applicationName ?? "t3-hub",
    types: hubPgTypes,
  });

const withTenantTransaction = <A>(
  connection: SqlConnection.Connection,
  begin: string,
  effect: Effect.Effect<A, SqlError>,
) =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      yield* connection.executeUnprepared(begin, [], undefined);
      const exit = yield* Effect.exit(restore(effect));
      if (Exit.isSuccess(exit)) {
        yield* connection.executeUnprepared("COMMIT", [], undefined);
        return exit.value;
      }
      yield* connection.executeUnprepared("ROLLBACK", [], undefined).pipe(Effect.ignore);
      return yield* exit;
    }),
  );

// Postgres `text` cannot hold U+0000, which SQLite stores happily (provider
// output occasionally contains it). Replace it in string parameters instead of
// failing the write; JSON text keeps its escaped `\u0000` form and is handled
// where it is parsed.
const withoutNul = (params: ReadonlyArray<unknown>): ReadonlyArray<unknown> =>
  params.some((param) => typeof param === "string" && param.includes("\u0000"))
    ? params.map((param) =>
        typeof param === "string" ? param.replaceAll("\u0000", "\uFFFD") : param,
      )
    : params;

const sanitizingParameters = (connection: SqlConnection.Connection): SqlConnection.Connection => ({
  execute: (sql, params, transformRows) =>
    connection.execute(sql, withoutNul(params), transformRows),
  executeRaw: (sql, params) => connection.executeRaw(sql, withoutNul(params)),
  executeValues: (sql, params) => connection.executeValues(sql, withoutNul(params)),
  executeValuesUnprepared: (sql, params) =>
    connection.executeValuesUnprepared(sql, withoutNul(params)),
  executeUnprepared: (sql, params, transformRows) =>
    connection.executeUnprepared(sql, withoutNul(params), transformRows),
  executeStream: (sql, params, transformRows) =>
    connection.executeStream(sql, withoutNul(params), transformRows),
});

/**
 * Wraps a pooled client so every statement and transaction carries the tenant.
 *
 * Transactions cost no extra round trip (`BEGIN` and `SET LOCAL` travel as one
 * simple query). A statement outside a transaction costs two more (the tenant
 * `BEGIN` and `COMMIT`), which is the price of the RLS backstop behind a pooler.
 */
export const makeTenantSqlClient = (base: PgClient.PgClient, tenantId: string) =>
  Effect.gen(function* () {
    const setTenant = hubTenantSettingStatement(tenantId);
    const begin = `BEGIN; ${setTenant}`;

    const autocommit = (connection: SqlConnection.Connection): SqlConnection.Connection => ({
      execute: (sql, params, transformRows) =>
        withTenantTransaction(connection, begin, connection.execute(sql, params, transformRows)),
      executeRaw: (sql, params) =>
        withTenantTransaction(connection, begin, connection.executeRaw(sql, params)),
      executeValues: (sql, params) =>
        withTenantTransaction(connection, begin, connection.executeValues(sql, params)),
      executeValuesUnprepared: (sql, params) =>
        withTenantTransaction(connection, begin, connection.executeValuesUnprepared(sql, params)),
      executeUnprepared: (sql, params, transformRows) =>
        withTenantTransaction(
          connection,
          begin,
          connection.executeUnprepared(sql, params, transformRows),
        ),
      executeStream: (sql, params, transformRows) =>
        Stream.unwrap(
          Effect.acquireRelease(connection.executeUnprepared(begin, [], undefined), (_, exit) =>
            connection
              .executeUnprepared(Exit.isSuccess(exit) ? "COMMIT" : "ROLLBACK", [], undefined)
              .pipe(Effect.ignore),
          ).pipe(Effect.as(connection.executeStream(sql, params, transformRows))),
        ),
    });

    return yield* SqlClient.make({
      // `reserve` pins one pooled connection for the statement, so the tenant
      // transaction and the statement share it.
      acquirer: Effect.map(base.reserve, (connection) =>
        autocommit(sanitizingParameters(connection)),
      ),
      transactionAcquirer: Effect.map(base.reserve, sanitizingParameters),
      compiler: PgClient.makeCompiler(),
      spanAttributes: [
        ["db.system.name", "postgresql"],
        ["db.namespace", base.config.database ?? base.config.username ?? "postgres"],
      ],
      beginTransaction: begin,
    });
  });
