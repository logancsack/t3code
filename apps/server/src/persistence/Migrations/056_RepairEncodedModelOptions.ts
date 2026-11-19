import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Migration 026 on SQLite 3.54.1 could quote its aggregate's scalar-subquery
// result. Repair already-applied rows too, preserving every option and boolean.
// CASE guards malformed JSON; valid arrays and unrelated payloads stay untouched.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE projection_threads
    SET model_selection_json = json_set(
      model_selection_json, '$.options', json(json_extract(model_selection_json, '$.options'))
    )
    WHERE CASE WHEN json_valid(model_selection_json) THEN
      CASE WHEN json_type(model_selection_json, '$.options') = 'text'
        AND json_valid(json_extract(model_selection_json, '$.options'))
      THEN json_type(json_extract(model_selection_json, '$.options')) END
    END = 'array'
  `;

  yield* sql`
    UPDATE projection_projects
    SET default_model_selection_json = json_set(
      default_model_selection_json, '$.options', json(json_extract(default_model_selection_json, '$.options'))
    )
    WHERE CASE WHEN json_valid(default_model_selection_json) THEN
      CASE WHEN json_type(default_model_selection_json, '$.options') = 'text'
        AND json_valid(json_extract(default_model_selection_json, '$.options'))
      THEN json_type(json_extract(default_model_selection_json, '$.options')) END
    END = 'array'
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(
      payload_json, '$.modelSelection.options', json(json_extract(payload_json, '$.modelSelection.options'))
    )
    WHERE CASE WHEN json_valid(payload_json) THEN
      CASE WHEN json_type(payload_json, '$.modelSelection.options') = 'text'
        AND json_valid(json_extract(payload_json, '$.modelSelection.options'))
      THEN json_type(json_extract(payload_json, '$.modelSelection.options')) END
    END = 'array'
      AND event_type IN ('thread.created', 'thread.meta-updated', 'thread.turn-start-requested')
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(
      payload_json, '$.defaultModelSelection.options', json(json_extract(payload_json, '$.defaultModelSelection.options'))
    )
    WHERE CASE WHEN json_valid(payload_json) THEN
      CASE WHEN json_type(payload_json, '$.defaultModelSelection.options') = 'text'
        AND json_valid(json_extract(payload_json, '$.defaultModelSelection.options'))
      THEN json_type(json_extract(payload_json, '$.defaultModelSelection.options')) END
    END = 'array'
      AND event_type IN ('project.created', 'project.meta-updated')
  `;
});
