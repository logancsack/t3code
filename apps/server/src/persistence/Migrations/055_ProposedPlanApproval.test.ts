import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";
import migration from "./055_ProposedPlanApproval.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("plan approval migration", (it) => {
  it.effect(
    "keeps existing implementations accepted and leaves proposals open across restarts",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 54 });
        yield* sql`INSERT INTO projection_thread_proposed_plans(plan_id,thread_id,turn_id,plan_markdown,implemented_at,created_at,updated_at)
      VALUES ('accepted','t','turn','# Build','2026-10-15T23:41:42.316Z','2026-10-15T23:00:00.000Z','2026-10-15T23:41:42.316Z'),
      ('proposed','t','turn','# Proposal',null,'2026-10-15T23:00:00.000Z','2026-10-15T23:00:00.000Z')`;
        yield* runMigrations();
        yield* migration;
        const rows =
          yield* sql`SELECT plan_id, approved_at FROM projection_thread_proposed_plans ORDER BY plan_id`;
        assert.deepEqual(rows, [
          { plan_id: "accepted", approved_at: "2026-10-15T23:41:42.316Z" },
          { plan_id: "proposed", approved_at: null },
        ]);
      }),
  );
});
