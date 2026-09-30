/**
 * HubDocuments - the small documents a standalone server keeps as files in its
 * state directory (settings.json, keybindings.json, environment-id,
 * anonymous-id), stored as tenant rows in `hub_documents`.
 *
 * Documents are keyed by the file's base name, so `t3 hub import` can copy a
 * standalone state directory verbatim.
 *
 * @module HubDocuments
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { HubDatabaseShape } from "./HubDatabase.ts";

export const makeHubDocuments = (database: HubDatabaseShape) => {
  const { sql, tenantId } = database;

  const read = (name: string) =>
    sql<{ readonly contents: string }>`
      SELECT contents
      FROM hub_documents
      WHERE user_id = ${tenantId}
        AND name = ${name}
    `.pipe(Effect.map((rows) => Option.fromNullishOr(rows[0]?.contents)));

  const write = (name: string, contents: string) =>
    sql`
      INSERT INTO hub_documents (user_id, name, contents, updated_at)
      VALUES (${tenantId}, ${name}, ${contents}, now())
      ON CONFLICT (user_id, name)
      DO UPDATE SET contents = excluded.contents, updated_at = excluded.updated_at
    `.pipe(Effect.asVoid);

  /**
   * Stores `contents` unless the document exists and returns the stored value,
   * so concurrent initializers agree on one winner. The read is a separate
   * statement so it sees a winner that committed while the insert waited.
   */
  const createIfAbsent = (name: string, contents: string) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO hub_documents (user_id, name, contents)
            VALUES (${tenantId}, ${name}, ${contents})
            ON CONFLICT (user_id, name) DO NOTHING
          `;
          return yield* read(name);
        }),
      )
      .pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.die(new Error(`Hub document ${name} vanished during creation.`)),
            onSome: Effect.succeed,
          }),
        ),
      );

  return { read, write, createIfAbsent };
};

export type HubDocuments = ReturnType<typeof makeHubDocuments>;
