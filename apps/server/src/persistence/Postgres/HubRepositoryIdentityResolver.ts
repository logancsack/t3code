/**
 * Repository identity for a hub, which has no checkout to run `git remote` in.
 *
 * Projects record their identity at creation (`project.create` /
 * `project.meta.update` `repositoryIdentity`), and the hub answers from that
 * record: for a project's workspace root, or for a thread checkout path
 * through the thread's project.
 *
 * A hub without a database URL (tests and local development, persisting to
 * SQLite) records no identity, so every project resolves to none there and
 * thread machines start from an empty checkout.
 *
 * @module HubRepositoryIdentityResolver
 */
import { RepositoryIdentity } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { RepositoryIdentityResolver } from "../../project/RepositoryIdentityResolver.ts";
import { HubDatabase } from "./HubDatabase.ts";

const decodeIdentity = Schema.decodeUnknownEffect(Schema.fromJsonString(RepositoryIdentity));

export const layer = Layer.effect(
  RepositoryIdentityResolver,
  Effect.gen(function* () {
    const database = yield* HubDatabase;
    if (database === undefined) {
      return RepositoryIdentityResolver.of({ resolve: () => Effect.succeed(null) });
    }
    const { sql, tenantId } = database;

    return RepositoryIdentityResolver.of({
      resolve: (cwd) =>
        sql<{ readonly identity: string | null }>`
          SELECT repository_identity_json AS identity
          FROM projection_projects
          WHERE user_id = ${tenantId}
            AND workspace_root = ${cwd}
            AND deleted_at IS NULL
          UNION ALL
          SELECT projects.repository_identity_json AS identity
          FROM projection_threads threads
          JOIN projection_projects projects
            ON projects.user_id = threads.user_id
           AND projects.project_id = threads.project_id
          WHERE threads.user_id = ${tenantId}
            AND threads.worktree_path = ${cwd}
            AND threads.deleted_at IS NULL
          LIMIT 1
        `.pipe(
          Effect.flatMap(([row]) =>
            row?.identity ? decodeIdentity(row.identity) : Effect.succeed(null),
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning("Failed to read a recorded repository identity.", { cause }).pipe(
              Effect.as(null),
            ),
          ),
        ),
    });
  }),
);
