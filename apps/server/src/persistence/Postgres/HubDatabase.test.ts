/**
 * Hub database foundation: migrations, the tenant-scoped client, and the
 * row-level-security backstop. Runs only with T3_HUB_TEST_DATABASE_URL (see
 * `hubTestDatabase.ts`).
 */
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { HubDatabase } from "./HubDatabase.ts";
import { makeHubPool, makeTenantSqlClient } from "./HubClient.ts";
import { orderHubMigrations, runHubMigrations, type HubMigrationEntry } from "./HubMigrator.ts";
import { hubMigrations } from "./migrations/index.ts";
import {
  hubTestDatabaseLayer,
  hubTestDatabaseUrl,
  makeHubTestSchema,
  type HubTestSchema,
} from "./hubTestDatabase.ts";

const withSchema = <A, E, R>(use: (schema: HubTestSchema) => Effect.Effect<A, E, R>) =>
  Effect.scoped(Effect.flatMap(makeHubTestSchema(hubTestDatabaseUrl!), use)).pipe(
    Effect.provide(Reactivity.layer),
  );

const tenantSetting = (sql: SqlClient.SqlClient) =>
  sql<{ readonly tenant: string | null }>`
    SELECT current_setting('hub.user_id', true) AS tenant
  `.pipe(Effect.map((rows) => rows[0]?.tenant ?? null));

describe.skipIf(hubTestDatabaseUrl === undefined)("hub database", () => {
  it.effect("applies migrations once, in id order, under concurrent starts", () =>
    withSchema((schema) =>
      Effect.gen(function* () {
        const applied = yield* Effect.all(
          Array.from({ length: 4 }, () =>
            Effect.scoped(
              Effect.gen(function* () {
                const pool = yield* makeHubPool({ url: schema.adminUrl, maxConnections: 1 });
                return yield* runHubMigrations(hubMigrations).pipe(
                  Effect.provideService(SqlClient.SqlClient, pool),
                );
              }),
            ),
          ),
          { concurrency: "unbounded" },
        );
        // Each migration is applied exactly once across the concurrent starts,
        // and each start applies what it applied in id order.
        assert.deepStrictEqual(
          applied
            .flat()
            .map((entry) => entry.id)
            .toSorted((left, right) => left - right),
          hubMigrations.map((entry) => entry.id),
        );
        for (const run of applied) {
          const ids = run.map((entry) => entry.id);
          assert.deepStrictEqual(
            ids,
            ids.toSorted((left, right) => left - right),
          );
        }

        // A later migration with a lower id than an applied one still applies.
        const pool = yield* makeHubPool({ url: schema.adminUrl, maxConnections: 1 });
        const extra: ReadonlyArray<HubMigrationEntry> = [
          ...hubMigrations,
          {
            id: 60,
            name: "RunnerProbe",
            migration: Effect.flatMap(SqlClient.SqlClient, (sql) =>
              sql`CREATE TABLE runner_probe (id integer)`.pipe(Effect.asVoid),
            ),
          },
          {
            id: 49,
            name: "HubProbe",
            migration: Effect.flatMap(SqlClient.SqlClient, (sql) =>
              sql`CREATE TABLE hub_probe (id integer)`.pipe(Effect.asVoid),
            ),
          },
        ];
        const second = yield* runHubMigrations(extra).pipe(
          Effect.provideService(SqlClient.SqlClient, pool),
        );
        assert.deepStrictEqual(
          second.map((entry) => entry.id),
          [49, 60],
        );
        const rerun = yield* runHubMigrations(extra).pipe(
          Effect.provideService(SqlClient.SqlClient, pool),
        );
        assert.deepStrictEqual(rerun, []);
      }),
    ),
  );

  it("rejects duplicate migration ids", () => {
    const migration = Effect.void;
    assert.throws(() =>
      orderHubMigrations([
        { id: 2, name: "A", migration },
        { id: 2, name: "B", migration },
      ]),
    );
  });

  it.effect("applies the tenant to statements and transactions", () =>
    withSchema((schema) =>
      Effect.gen(function* () {
        const database = yield* HubDatabase;
        assert.isDefined(database);
        const sql = database!.sql;

        assert.strictEqual(yield* tenantSetting(sql), "tenant-a");
        assert.strictEqual(yield* sql.withTransaction(tenantSetting(sql)), "tenant-a");

        // The tenant is set with SET LOCAL, so a snapshot transaction can still
        // choose its isolation level first.
        const isolation = yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
            const rows = yield* sql<{
              readonly level: string;
            }>`SELECT current_setting('transaction_isolation') AS level`;
            return rows[0]?.level;
          }),
        );
        assert.strictEqual(isolation, "repeatable read");

        // The setting never outlives its transaction on the pooled connection.
        const plain = yield* makeHubPool({ url: schema.runtimeUrl, maxConnections: 1 });
        const leaked = yield* tenantSetting(plain);
        assert.isTrue(leaked === null || leaked === "");
      }).pipe(Effect.provide(hubTestDatabaseLayer(schema, "tenant-a"))),
    ),
  );

  it.effect("fails closed for a role without BYPASSRLS", (context) =>
    withSchema((schema) =>
      Effect.gen(function* () {
        if (!schema.runtimeSubjectToRls) {
          // A remote database whose only role bypasses RLS; roles are never
          // created outside a local cluster.
          context.skip();
          return;
        }
        const database = yield* HubDatabase;
        const tenantA = database!.sql;
        const runtime = yield* makeHubPool({ url: schema.runtimeUrl, maxConnections: 2 });

        const [role] = yield* runtime<{
          readonly rolsuper: boolean;
          readonly rolbypassrls: boolean;
        }>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
        assert.isFalse(role?.rolsuper);
        assert.isFalse(role?.rolbypassrls);

        yield* tenantA`
          INSERT INTO hub_documents (user_id, name, contents)
          VALUES ('tenant-a', 'settings.json', '{}')
        `;
        const tenantB = yield* makeTenantSqlClient(runtime, "tenant-b");

        const count = (sql: SqlClient.SqlClient) =>
          sql<{ readonly count: number }>`SELECT count(*) AS count FROM hub_documents`.pipe(
            Effect.map((rows) => rows[0]?.count ?? -1),
          );
        assert.strictEqual(yield* count(tenantA), 1);
        assert.strictEqual(yield* count(tenantB), 0);
        // No tenant set: the policy compares with NULL and matches nothing.
        assert.strictEqual(yield* count(runtime), 0);

        const forged = yield* tenantB`
          INSERT INTO hub_documents (user_id, name, contents)
          VALUES ('tenant-a', 'keybindings.json', '[]')
        `.pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(forged));
        const untenanted = yield* runtime`
          INSERT INTO hub_documents (user_id, name, contents)
          VALUES ('tenant-a', 'anonymous-id', 'x')
        `.pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(untenanted));

        const updated = yield* tenantB<{ readonly name: string }>`
          UPDATE hub_documents SET contents = 'stolen' RETURNING name
        `;
        assert.strictEqual(updated.length, 0);
        const deleted = yield* tenantB<{ readonly name: string }>`
          DELETE FROM hub_documents RETURNING name
        `;
        assert.strictEqual(deleted.length, 0);
        const [row] = yield* tenantA<{ readonly contents: string }>`
          SELECT contents FROM hub_documents WHERE user_id = 'tenant-a'
        `;
        assert.strictEqual(row?.contents, "{}");

        if (schema.separateRuntimeRole) {
          // The runtime role reads the migration history but cannot rewrite it.
          const history = yield* runtime<{
            readonly id: number;
          }>`SELECT id FROM hub_schema_migrations`;
          assert.isAbove(history.length, 0);
          const rewrite = yield* runtime`DELETE FROM hub_schema_migrations`.pipe(Effect.exit);
          assert.isTrue(Exit.isFailure(rewrite));
        }
      }).pipe(Effect.provide(hubTestDatabaseLayer(schema, "tenant-a"))),
    ),
  );
});
