import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

layer("populated projection upgrades", (it) => {
  it.effect(
    "preserves the first projection schema's data and makes current metadata writable on repeated startup",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // 005 is the first persisted projection schema. Keep the historical
        // data-transform/repair tests; this replaces four empty-table column checks.
        yield* runMigrations({ toMigrationInclusive: 5 });
        yield* sql`
        INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
        VALUES ('project', 'Saved project', '/work/project', '[]', '2026-03-01', '2026-03-01')
      `;
        yield* sql`
        INSERT INTO projection_threads (thread_id, project_id, title, model, branch, created_at, updated_at)
        VALUES ('thread', 'project', 'Saved thread', 'gpt-5.4', 'work', '2026-03-01', '2026-03-01')
      `;
        yield* sql`
        INSERT INTO projection_thread_messages (message_id, thread_id, role, text, is_streaming, created_at, updated_at)
        VALUES ('message', 'thread', 'user', 'Unfinished work to preserve', 0, '2026-03-01', '2026-03-01')
      `;

        yield* runMigrations();
        const [project] = yield* sql`
        SELECT title, workspace_root, favicon_path, project_icon_json FROM projection_projects WHERE project_id = 'project'
      `;
        assert.deepEqual(project, {
          title: "Saved project",
          workspace_root: "/work/project",
          favicon_path: null,
          project_icon_json: null,
        });
        const [thread] = yield* sql`
        SELECT title, branch, title_regeneration_request_id, title_regeneration_started_at, linked_pull_request_json
        FROM projection_threads WHERE thread_id = 'thread'
      `;
        assert.deepEqual(thread, {
          title: "Saved thread",
          branch: "work",
          title_regeneration_request_id: null,
          title_regeneration_started_at: null,
          linked_pull_request_json: null,
        });
        const [message] =
          yield* sql`SELECT text FROM projection_thread_messages WHERE message_id = 'message'`;
        assert.equal(message?.text, "Unfinished work to preserve");

        const linked = encodeJson({
          repository: "acme/project",
          number: 42,
          url: "https://github.com/acme/project/pull/42",
        });
        const icon = encodeJson({ kind: "emoji", emoji: "🌿" });
        yield* sql`UPDATE projection_projects SET favicon_path = '/favicon.png', project_icon_json = ${icon} WHERE project_id = 'project'`;
        yield* sql`UPDATE projection_threads SET title_regeneration_request_id = 'request', title_regeneration_started_at = '2026-10-16', linked_pull_request_json = ${linked} WHERE thread_id = 'thread'`;
        // Startup runs migrations every time; it must preserve newly written state too.
        yield* runMigrations();
        const [updatedProject] =
          yield* sql`SELECT favicon_path, project_icon_json FROM projection_projects WHERE project_id = 'project'`;
        assert.deepEqual(updatedProject, { favicon_path: "/favicon.png", project_icon_json: icon });
        const [updatedThread] =
          yield* sql`SELECT title_regeneration_request_id, title_regeneration_started_at, linked_pull_request_json FROM projection_threads WHERE thread_id = 'thread'`;
        assert.deepEqual(updatedThread, {
          title_regeneration_request_id: "request",
          title_regeneration_started_at: "2026-10-16",
          linked_pull_request_json: linked,
        });
      }),
  );
});
