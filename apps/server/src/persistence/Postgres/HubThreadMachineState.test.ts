/**
 * Hub thread-machine state on Postgres (migration 050): the same repositories
 * as the SQLite variant, tenant-scoped through `HubDatabase`, with the
 * row-level-security backstop. Runs only with T3_HUB_TEST_DATABASE_URL (see
 * `hubTestDatabase.ts`).
 */
import { assert, describe, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  CheckpointTurnDiffStore,
  RunnerCursorStore,
  ThreadVcsStatusStore,
} from "../Services/HubThreadMachineState.ts";
import { HubDatabase } from "./HubDatabase.ts";
import { HubThreadMachineStatePostgresLive } from "./HubThreadMachineState.ts";
import { hubTenantLayer } from "./HubTenant.ts";
import { HUB_THREAD_MACHINE_STATE_TABLES } from "./migrations/050_HubThreadMachineState.ts";
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

const threadId = ThreadId.make("thread-shared");

/** The stores of one hub process for `tenantId`, over its tenant client. */
const storesFor = (schema: HubTestSchema, tenantId: string) =>
  Layer.unwrap(
    Effect.map(HubDatabase, (database) =>
      HubThreadMachineStatePostgresLive.pipe(
        Layer.provide(hubTenantLayer(database!.tenantId)),
        Layer.provide(Layer.succeed(SqlClient.SqlClient, database!.sql)),
      ),
    ),
  ).pipe(Layer.provideMerge(hubTestDatabaseLayer(schema, tenantId)));

const local = {
  isRepo: true,
  hasPrimaryRemote: true,
  isDefaultRef: false,
  refName: "t3/work",
  hasWorkingTreeChanges: true,
  workingTree: {
    files: [{ path: "a.ts", insertions: 2, deletions: 1 }],
    insertions: 2,
    deletions: 1,
  },
};

const writeAs = (sequence: number, label: string) =>
  Effect.gen(function* () {
    yield* (yield* RunnerCursorStore).saveAll([
      { threadId, outboxId: "runner", bootId: label, ackedSequence: sequence, updatedAt: "t" },
    ]);
    const diffs = yield* CheckpointTurnDiffStore;
    for (const ignoreWhitespace of [true, false]) {
      yield* diffs.put({
        threadId,
        fromTurnCount: 0,
        toTurnCount: 1,
        ignoreWhitespace,
        diff: `diff of ${label}${ignoreWhitespace ? "" : " (exact)"}`,
        createdAt: "t",
      });
    }
    yield* (yield* ThreadVcsStatusStore).put({
      threadId,
      local: { ...local, refName: label },
      remote: { hasUpstream: true, aheadCount: sequence, behindCount: 0, pr: null },
      updatedAt: "t",
    });
  });

const read = Effect.gen(function* () {
  const cursor = yield* (yield* RunnerCursorStore).get(threadId);
  const diffs = yield* CheckpointTurnDiffStore;
  const diff = (ignoreWhitespace: boolean) =>
    diffs
      .get({ threadId, fromTurnCount: 0, toTurnCount: 1, ignoreWhitespace })
      .pipe(Effect.map(Option.getOrNull));
  const statuses = yield* (yield* ThreadVcsStatusStore).list();
  return {
    cursor: Option.getOrNull(cursor)?.bootId ?? null,
    sequence: Option.getOrNull(cursor)?.ackedSequence ?? null,
    diff: yield* diff(true),
    exactDiff: yield* diff(false),
    statuses: statuses.map((row) => [row.local.refName, row.remote?.aheadCount ?? null]),
  };
});

describe.skipIf(hubTestDatabaseUrl === undefined)("hub thread-machine state on Postgres", () => {
  it.effect("keeps cursors, diffs and git status per tenant", () =>
    withSchema((schema) =>
      Effect.gen(function* () {
        yield* writeAs(3, "user-a").pipe(Effect.provide(storesFor(schema, "user-a")));
        yield* writeAs(7, "user-b").pipe(Effect.provide(storesFor(schema, "user-b")));

        assert.deepStrictEqual(yield* read.pipe(Effect.provide(storesFor(schema, "user-a"))), {
          cursor: "user-a",
          sequence: 3,
          diff: "diff of user-a",
          exactDiff: "diff of user-a (exact)",
          statuses: [["user-a", 3]],
        });

        yield* Effect.gen(function* () {
          yield* (yield* CheckpointTurnDiffStore).invalidateFromTurn({ threadId, turnCount: 1 });
          yield* (yield* ThreadVcsStatusStore).remove(threadId);
          yield* (yield* RunnerCursorStore).remove(threadId);
        }).pipe(Effect.provide(storesFor(schema, "user-a")));

        assert.deepStrictEqual(yield* read.pipe(Effect.provide(storesFor(schema, "user-a"))), {
          cursor: null,
          sequence: null,
          diff: null,
          exactDiff: null,
          statuses: [],
        });
        assert.deepStrictEqual(yield* read.pipe(Effect.provide(storesFor(schema, "user-b"))), {
          cursor: "user-b",
          sequence: 7,
          diff: "diff of user-b",
          exactDiff: "diff of user-b (exact)",
          statuses: [["user-b", 7]],
        });
      }),
    ),
  );

  it.effect("applies migration 050 with the forced tenant policy on every table", () =>
    withSchema((schema) =>
      Effect.gen(function* () {
        yield* writeAs(1, "user-a").pipe(Effect.provide(storesFor(schema, "user-a")));

        yield* Effect.gen(function* () {
          const { sql } = (yield* HubDatabase)!;
          const migrations = yield* sql<{ readonly id: number; readonly name: string }>`
            SELECT id, name FROM hub_schema_migrations WHERE id >= 50 ORDER BY id
          `;
          assert.deepStrictEqual(
            migrations.map((row) => [row.id, row.name]),
            [[50, "HubThreadMachineState"]],
          );
          const tables = yield* sql<{
            readonly table: string;
            readonly enabled: boolean;
            readonly forced: boolean;
          }>`
            SELECT relname AS "table", relrowsecurity AS enabled, relforcerowsecurity AS forced
            FROM pg_class
            WHERE relnamespace = current_schema()::regnamespace
              AND relname IN ${sql.in(HUB_THREAD_MACHINE_STATE_TABLES)}
            ORDER BY relname
          `;
          assert.deepStrictEqual(
            tables.map((row) => [row.table, row.enabled, row.forced]),
            HUB_THREAD_MACHINE_STATE_TABLES.toSorted().map((table) => [table, true, true]),
          );

          if (!schema.runtimeSubjectToRls) {
            return;
          }
          // Without any user_id predicate, another tenant's client sees nothing
          // and cannot write rows for someone else.
          for (const table of HUB_THREAD_MACHINE_STATE_TABLES) {
            const [row] = yield* sql<{ readonly count: number }>`
              SELECT count(*) AS count FROM ${sql(table)}
            `;
            assert.strictEqual(row?.count, 0, table);
          }
          const forged = yield* sql`
            INSERT INTO hub_runner_cursors (
              user_id, thread_id, outbox_id, boot_id, acked_sequence, updated_at
            )
            VALUES ('user-a', 'thread-forged', 'runner', 'boot', 1, 't')
          `.pipe(Effect.exit);
          assert.isTrue(Exit.isFailure(forged));
        }).pipe(Effect.provide(hubTestDatabaseLayer(schema, "user-b")));
      }),
    ),
  );
});
