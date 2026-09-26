/**
 * HubMigrator - ordered, idempotent hub schema migrations.
 *
 * Each pending migration runs in its own transaction that first takes a
 * transaction-scoped advisory lock, re-reads the applied set, applies the
 * lowest pending id, and records it in `hub_schema_migrations`. Concurrent hub
 * processes therefore serialize and never apply a migration twice, and the lock
 * is released with the transaction, which keeps it safe behind a
 * transaction-mode pooler (a session-level advisory lock is not).
 *
 * Migrations are applied by id, not by list position, and an id missing below
 * an applied one is still applied: separately owned ranges (001-049 hub
 * persistence, 050-099 thread machines) can land in any order.
 *
 * @module HubMigrator
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

export type HubMigration = Effect.Effect<void, SqlError, SqlClient.SqlClient>;

export interface HubMigrationEntry {
  readonly id: number;
  readonly name: string;
  readonly migration: HubMigration;
}

// Arbitrary constant shared by every hub process.
const HUB_MIGRATION_LOCK_KEY = 7_330_001;

/** Sorts entries by id and rejects duplicate or invalid ids. */
export const orderHubMigrations = (
  entries: ReadonlyArray<HubMigrationEntry>,
): ReadonlyArray<HubMigrationEntry> => {
  const seen = new Set<number>();
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.id) || entry.id <= 0) {
      throw new Error(`Hub migration ${entry.name} has an invalid id ${entry.id}.`);
    }
    if (seen.has(entry.id)) {
      throw new Error(`Hub migration id ${entry.id} is used more than once.`);
    }
    seen.add(entry.id);
  }
  return entries.toSorted((left, right) => left.id - right.id);
};

/** Applies every pending migration; returns the ones this call applied. */
export const runHubMigrations = (entries: ReadonlyArray<HubMigrationEntry>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const ordered = orderHubMigrations(entries);
    const applied: Array<Pick<HubMigrationEntry, "id" | "name">> = [];

    const applyNext = sql.withTransaction(
      Effect.gen(function* () {
        yield* sql.unsafe(`SELECT pg_advisory_xact_lock(${HUB_MIGRATION_LOCK_KEY})`);
        yield* sql.unsafe(`CREATE TABLE IF NOT EXISTS hub_schema_migrations (
          id integer PRIMARY KEY,
          name text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        )`);
        const rows = yield* sql<{ readonly id: number }>`SELECT id FROM hub_schema_migrations`;
        const done = new Set(rows.map((row) => Number(row.id)));
        const next = ordered.find((entry) => !done.has(entry.id));
        if (next === undefined) {
          return undefined;
        }
        yield* next.migration;
        yield* sql`INSERT INTO hub_schema_migrations (id, name) VALUES (${next.id}, ${next.name})`;
        return next;
      }),
    );

    while (true) {
      const next = yield* applyNext;
      if (next === undefined) {
        return applied;
      }
      applied.push({ id: next.id, name: next.name });
      yield* Effect.logInfo("Applied hub migration.", { id: next.id, name: next.name });
    }
  });

/**
 * The migrations `hub_schema_migrations` does not record yet (all of them
 * when the table does not exist). Reads only; safe for the runtime role.
 */
export const pendingHubMigrations = (entries: ReadonlyArray<HubMigrationEntry>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const ordered = orderHubMigrations(entries);
    const [table] = yield* sql<{ readonly exists: boolean }>`
      SELECT to_regclass('hub_schema_migrations') IS NOT NULL AS exists
    `;
    if (!table?.exists) return ordered;
    const rows = yield* sql<{ readonly id: number }>`SELECT id FROM hub_schema_migrations`;
    const done = new Set(rows.map((row) => Number(row.id)));
    return ordered.filter((entry) => !done.has(entry.id));
  });
