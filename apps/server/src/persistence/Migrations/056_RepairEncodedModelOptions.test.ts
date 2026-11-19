import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";
import repair from "./056_RepairEncodedModelOptions.ts";

const Json = Schema.fromJsonString(Schema.Unknown);
const encode = Schema.encodeSync(Json);
const decode = Schema.decodeSync(Json);

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("encoded model options repair", (it) => {
  it.effect("repairs an already-migrated database without changing valid or unrelated data", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 55 });
      const options = [
        { id: "effort", value: "max" },
        { id: "fastMode", value: true },
        { id: "thinking", value: false },
      ];
      const selection = (value: unknown) => ({
        instanceId: "codex",
        model: "gpt-5.4",
        options: value,
      });
      const cases = [
        { name: "encoded", before: selection(encode(options)), after: selection(options) },
        { name: "empty", before: selection("[]"), after: selection([]) },
        ...[
          ["array", selection(options)],
          ["object", selection({ effort: "max" })],
          ["bad-string", selection("[broken")],
          ["object-string", selection('{"effort":"max"}')],
          ["scalar-string", selection("true")],
          ["null", null],
          ["missing", { instanceId: "codex", model: "gpt-5.4" }],
        ].map(([name, before]) => ({ name: String(name), before, after: before })),
      ];
      const expected = new Map<string, { before: string; after: string }>();
      for (const sample of cases) {
        const before = encode(sample.before);
        const after = encode(sample.after);
        expected.set(`project-${sample.name}`, { before, after });
        expected.set(`thread-${sample.name}`, { before, after });
        yield* sql`INSERT INTO projection_projects
          (project_id, title, workspace_root, default_model_selection_json, scripts_json, created_at, updated_at)
          VALUES (${`project-${sample.name}`}, 'Fixture', '/tmp/fixture', ${before}, '[]', '2026-01-01', '2026-01-01')`;
        yield* sql`INSERT INTO projection_threads
          (thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode, created_at, updated_at)
          VALUES (${`thread-${sample.name}`}, ${`project-${sample.name}`}, 'Fixture', ${before}, 'full-access', 'default', '2026-01-01', '2026-01-01')`;
        for (const type of [
          "thread.created",
          "thread.meta-updated",
          "thread.turn-start-requested",
          "project.created",
          "project.meta-updated",
          "thread.activity-appended",
        ]) {
          const key = `${sample.name}-${type}`;
          const field = type.startsWith("project.") ? "defaultModelSelection" : "modelSelection";
          const original = {
            [field]: sample.before,
            untouched: { text: 'user "content"', flag: false },
          };
          const updated = { ...original, [field]: sample.after };
          expected.set(key, {
            before: encode(original),
            after: encode(type === "thread.activity-appended" ? original : updated),
          });
          yield* sql`INSERT INTO orchestration_events
            (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, actor_kind, payload_json, metadata_json)
            VALUES (${key}, 'thread', ${key}, 1, ${type}, '2026-01-01', 'user', ${encode(original)}, '{}')`;
        }
      }
      // Malformed outer JSON must neither abort startup nor be rewritten.
      yield* sql`INSERT INTO projection_projects
        (project_id, title, workspace_root, default_model_selection_json, scripts_json, created_at, updated_at)
        VALUES ('malformed', 'Fixture', '/tmp/fixture', '{broken', '[]', '2026-01-01', '2026-01-01')`;
      expected.set("malformed", { before: "{broken", after: "{broken" });

      const read = () => sql<{ id: string; value: string }>`
        SELECT project_id AS id, default_model_selection_json AS value FROM projection_projects
        UNION ALL SELECT thread_id AS id, model_selection_json AS value FROM projection_threads
        UNION ALL SELECT event_id AS id, payload_json AS value FROM orchestration_events
        ORDER BY id`;
      yield* runMigrations();
      const rows = yield* read();
      assert.strictEqual(rows.length, expected.size);
      for (const row of rows) {
        const target = expected.get(row.id);
        assert.isDefined(target);
        if (!target) continue;
        if (target.before === target.after) assert.strictEqual(row.value, target.before, row.id);
        else assert.deepStrictEqual(decode(row.value), decode(target.after), row.id);
      }
      yield* repair;
      assert.deepStrictEqual(yield* read(), rows);
    }),
  );
});
