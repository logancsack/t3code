/**
 * HubAttachments - durable attachment bytes for a hub.
 *
 * Attachment code works with files under `ServerConfig.attachmentsDir`. In a
 * hub that directory is a disposable cache and `hub_attachments` holds the
 * bytes: a file is persisted when it becomes durable (an upload completes, a
 * pending upload is claimed by a turn, an inline image is written), restored
 * into the cache before it is looked up by id, and deleted when the files are.
 * Outside hub mode every helper here is a no-op.
 *
 * Bytes live in `bytea` within the existing upload limits for now; object
 * storage can replace the table behind the same helpers.
 *
 * @module HubAttachments
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  parseAttachmentIdFromRelativePath,
  parseThreadSegmentFromAttachmentId,
  PENDING_ATTACHMENT_THREAD_SEGMENT,
  resolveAttachmentPathById,
} from "../../attachmentStore.ts";
import {
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "../../attachmentPaths.ts";
import { HubDatabase, type HubDatabaseShape } from "./HubDatabase.ts";

const withHubDatabase = <A, E, R>(
  use: (database: HubDatabaseShape) => Effect.Effect<A, E, R>,
): Effect.Effect<void, E, R> =>
  Effect.gen(function* () {
    const database = yield* HubDatabase;
    if (database !== undefined) {
      yield* use(database);
    }
  });

const logFailure =
  (message: string, annotations: Record<string, unknown>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.asVoid,
      Effect.catchCause((cause) => Effect.logWarning(message, { ...annotations, cause })),
    );

/**
 * Stores a finished attachment file (`relativePath` under `attachmentsDir`).
 * Fails when the bytes cannot be made durable.
 */
export const persistHubAttachment = (input: {
  readonly attachmentsDir: string;
  readonly relativePath: string;
}) =>
  withHubDatabase(({ sql, tenantId }) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const relativePath = normalizeAttachmentRelativePath(input.relativePath);
      const attachmentId = relativePath ? parseAttachmentIdFromRelativePath(relativePath) : null;
      const threadSegment = attachmentId ? parseThreadSegmentFromAttachmentId(attachmentId) : null;
      if (!relativePath || !attachmentId || !threadSegment) {
        return yield* Effect.die(new Error("Refusing to persist an invalid attachment path."));
      }
      const content = yield* fileSystem.readFile(path.join(input.attachmentsDir, relativePath));
      yield* sql`
        INSERT INTO hub_attachments (
          user_id,
          relative_path,
          attachment_id,
          thread_segment,
          size_bytes,
          content,
          created_at
        )
        VALUES (
          ${tenantId},
          ${relativePath},
          ${attachmentId},
          ${threadSegment},
          ${content.byteLength},
          ${content},
          now()
        )
        ON CONFLICT (user_id, relative_path)
        DO UPDATE SET
          size_bytes = excluded.size_bytes,
          content = excluded.content,
          created_at = excluded.created_at
      `;
    }),
  );

/**
 * Restores an attachment into the local cache when it is not already there,
 * so id-based lookups that follow find the file. Best effort: a failure is
 * logged and the lookup then reports the attachment as missing.
 */
export const hydrateHubAttachment = (input: {
  readonly attachmentsDir: string;
  readonly attachmentId: string;
}) =>
  withHubDatabase(({ sql, tenantId }) =>
    Effect.gen(function* () {
      if (resolveAttachmentPathById(input) !== null) {
        return;
      }
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const rows = yield* sql<{ readonly relativePath: string; readonly content: Uint8Array }>`
        SELECT relative_path AS "relativePath", content
        FROM hub_attachments
        WHERE user_id = ${tenantId}
          AND attachment_id = ${input.attachmentId}
      `;
      for (const row of rows) {
        const filePath = resolveAttachmentRelativePath({
          attachmentsDir: input.attachmentsDir,
          relativePath: row.relativePath,
        });
        if (!filePath) {
          continue;
        }
        yield* fileSystem.makeDirectory(path.dirname(filePath), { recursive: true });
        // Write beside the target and rename so a concurrent reader never sees
        // a partial file.
        const partPath = `${filePath}.${process.pid}.hydrate.part`;
        yield* fileSystem.writeFile(partPath, row.content);
        yield* fileSystem.rename(partPath, filePath);
      }
    }).pipe(
      logFailure("Failed to restore a hub attachment.", { attachmentId: input.attachmentId }),
    ),
  );

/** Deletes stored attachments by relative path. Best effort, like file removal. */
export const removeHubAttachments = (relativePaths: ReadonlyArray<string>) =>
  withHubDatabase(({ sql, tenantId }) => {
    const normalized = relativePaths.flatMap((relativePath) => {
      const value = normalizeAttachmentRelativePath(relativePath);
      return value ? [value] : [];
    });
    return normalized.length === 0
      ? Effect.void
      : sql`
          DELETE FROM hub_attachments
          WHERE user_id = ${tenantId}
            AND relative_path IN ${sql.in(normalized)}
        `.pipe(logFailure("Failed to delete hub attachments.", { count: normalized.length }));
  });

/** Deletes a stored attachment by id (every extension it was stored under). */
export const removeHubAttachmentById = (attachmentId: string) =>
  withHubDatabase(({ sql, tenantId }) =>
    sql`
      DELETE FROM hub_attachments
      WHERE user_id = ${tenantId}
        AND attachment_id = ${attachmentId}
    `.pipe(logFailure("Failed to delete a hub attachment.", { attachmentId })),
  );

/**
 * Deletes a thread's stored attachments, keeping `keptRelativePaths` when
 * given (a revert prunes only what the remaining messages no longer use).
 */
export const removeHubThreadAttachments = (
  threadSegment: string,
  keptRelativePaths?: ReadonlySet<string>,
) =>
  withHubDatabase(({ sql, tenantId }) => {
    const kept = [...(keptRelativePaths ?? [])];
    return sql`
      DELETE FROM hub_attachments
      WHERE user_id = ${tenantId}
        AND thread_segment = ${threadSegment}
        ${kept.length > 0 ? sql`AND relative_path NOT IN ${sql.in(kept)}` : sql``}
    `.pipe(logFailure("Failed to delete a thread's hub attachments.", { threadSegment }));
  });

/** Deletes pending uploads older than `maxAgeMs` that no turn claimed. */
export const sweepHubPendingAttachments = (maxAgeMs: number) =>
  withHubDatabase(({ sql, tenantId }) =>
    sql`
      DELETE FROM hub_attachments
      WHERE user_id = ${tenantId}
        AND thread_segment = ${PENDING_ATTACHMENT_THREAD_SEGMENT}
        AND created_at < now() - make_interval(secs => ${maxAgeMs / 1000})
    `.pipe(logFailure("Failed to sweep pending hub attachments.", {})),
  );
