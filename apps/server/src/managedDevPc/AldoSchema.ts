/**
 * Tables only Aldo's managed workspaces need. They keep their own ledger, apart from the
 * server's migrations, so the two histories never compete for an id.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

const migrations: ReadonlyArray<readonly [id: number, name: string, statement: string]> = [
  [
    1,
    "TurnInstructionsSupplied",
    `CREATE TABLE aldo_turn_instructions (
      run_id TEXT PRIMARY KEY,
      contract TEXT NOT NULL,
      version INTEGER NOT NULL
    )`,
  ],
];

export const ensureAldoSchema = Effect.fn("AldoSchema.ensure")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS aldo_schema_migrations (
      migration_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    )
  `;
  const applied = yield* sql<{ readonly id: number | null }>`
    SELECT MAX(migration_id) AS id FROM aldo_schema_migrations
  `;
  const latest = applied[0]?.id ?? 0;
  for (const [id, name, statement] of migrations) {
    if (id <= latest) continue;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql.unsafe(statement);
        yield* sql`INSERT INTO aldo_schema_migrations (migration_id, name) VALUES (${id}, ${name})`;
      }),
    );
  }
});
