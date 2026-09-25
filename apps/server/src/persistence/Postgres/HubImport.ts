/**
 * HubImport - copies a standalone server's state into a hub tenant.
 *
 * Reads a standalone state directory (the one holding `state.sqlite`) and
 * writes the tenant's rows in one Postgres transaction, so an import either
 * lands completely or not at all:
 *
 *   - orchestration events, receipts, projections, checkpoint diffs, and
 *     provider session runtime rows, paged by rowid so memory stays bounded;
 *   - settings.json, keybindings.json, environment-id, and anonymous-id as
 *     hub documents (the environment id is kept, so clients see the same
 *     environment);
 *   - attachment files as hub attachments, within the upload size limit;
 *   - provider environment secrets, re-encrypted with the hub secret key.
 *
 * Auth sessions, pairing links, and other secrets (signing keys, T3 Connect
 * credentials) stay behind: they belong to the old server's origin.
 *
 * A tenant that already has rows is refused unless `replace` is set, which
 * deletes them first in the same transaction. JSON text keeps its content
 * except `\u0000` escapes, which become `�` (Postgres JSON operators
 * reject them). Only counts are reported.
 *
 * @module HubImport
 */
import { PROVIDER_SEND_TURN_MAX_FILE_BYTES, RepositoryIdentity } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  parseAttachmentIdFromRelativePath,
  parseThreadSegmentFromAttachmentId,
} from "../../attachmentStore.ts";
import { migrationEntries } from "../Migrations.ts";
import type { HubDatabaseShape } from "./HubDatabase.ts";
import { encryptHubSecret, parseHubSecretKey } from "./HubSecretCipher.ts";
import { HUB_BASELINE_TENANT_TABLES } from "./migrations/001_HubBaseline.ts";

export class HubImportError extends Schema.TaggedErrorClass<HubImportError>()("HubImportError", {
  reason: Schema.Literals([
    "source-missing",
    "source-version",
    "schema-mismatch",
    "tenant-not-empty",
  ]),
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

/** Standalone tables copied into the hub, in dependency-free order. */
const IMPORTED_TABLES: ReadonlyArray<{ readonly table: string; readonly pageRows: number }> = [
  { table: "projection_projects", pageRows: 500 },
  { table: "projection_threads", pageRows: 500 },
  { table: "projection_thread_sessions", pageRows: 500 },
  { table: "projection_turns", pageRows: 500 },
  { table: "projection_thread_proposed_plans", pageRows: 200 },
  { table: "projection_pending_approvals", pageRows: 500 },
  { table: "projection_state", pageRows: 500 },
  { table: "projection_thread_messages", pageRows: 200 },
  { table: "projection_thread_activities", pageRows: 200 },
  { table: "orchestration_events", pageRows: 200 },
  { table: "orchestration_command_receipts", pageRows: 1000 },
  { table: "checkpoint_diff_blobs", pageRows: 50 },
  { table: "provider_session_runtime", pageRows: 500 },
];

// Hub-generated columns with no standalone counterpart.
const HUB_ONLY_COLUMNS = new Set(["user_id", "row_id", "repository_identity_json"]);

const IMPORTED_DOCUMENTS = ["settings.json", "keybindings.json", "environment-id", "anonymous-id"];

// ServerSettings keeps sensitive provider environment values in these secrets.
const IMPORTED_SECRET_PREFIX = "provider-env-";

// Postgres caps a statement at 65535 bind parameters.
const MAX_PARAMETERS_PER_INSERT = 30_000;

/** Replaces `\u0000` JSON escapes (not escaped backslashes before "u0000"). */
export const neutralizeJsonNulEscapes = (json: string): string =>
  json.includes("\\u0000") ? json.replace(/(?<!\\)((?:\\\\)*)\\u0000/g, "$1\\ufffd") : json;

export interface HubImportReport {
  readonly rows: Readonly<Record<string, number>>;
  readonly lastEventSequence: number;
  readonly documents: number;
  readonly attachments: number;
  readonly attachmentsSkipped: number;
  readonly secrets: number;
  readonly repositoryIdentities: number;
  readonly replacedExisting: boolean;
}

export interface HubImportInput {
  /** Standalone state directory containing `state.sqlite`. */
  readonly stateDir: string;
  /** Read-only client over the standalone `state.sqlite`. */
  readonly source: SqlClient.SqlClient;
  readonly hub: HubDatabaseShape;
  readonly secretKey: string;
  readonly replace: boolean;
  /** Resolves a project's repository identity from its checkout, when present. */
  readonly resolveRepositoryIdentity?: (
    workspaceRoot: string,
  ) => Effect.Effect<RepositoryIdentity | null>;
}

const encodeRepositoryIdentityJson = Schema.encodeSync(Schema.fromJsonString(RepositoryIdentity));

const quoteIdentifier = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

const verifySourceVersion = (source: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const expected = Math.max(...migrationEntries.map(([id]) => id));
    const rows = yield* source<{ readonly id: number | null }>`
      SELECT max(migration_id) AS id FROM effect_sql_migrations
    `.pipe(Effect.orElseSucceed(() => [{ id: null }]));
    const actual = rows[0]?.id ?? null;
    if (actual !== expected) {
      return yield* new HubImportError({
        reason: "source-version",
        detail:
          actual === null || actual < expected
            ? `The standalone database is at migration ${actual ?? "none"}; start this T3 version on it once so it migrates to ${expected}, then import.`
            : `The standalone database is at migration ${actual}, newer than this T3 version (${expected}).`,
      });
    }
  });

const importTable = (
  source: SqlClient.SqlClient,
  hub: HubDatabaseShape,
  table: string,
  pageRows: number,
) =>
  Effect.gen(function* () {
    const sourceColumns = (yield* source<{ readonly name: string }>`
      SELECT name FROM pragma_table_info(${table})
    `)
      .map((row) => row.name)
      .filter((name) => !HUB_ONLY_COLUMNS.has(name));
    const hubColumns = new Set(
      (yield* hub.sql<{ readonly name: string }>`
        SELECT column_name AS name
        FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = ${table}
      `).map((row) => row.name),
    );
    const missing = sourceColumns.filter((name) => !hubColumns.has(name));
    if (sourceColumns.length === 0 || missing.length > 0) {
      return yield* new HubImportError({
        reason: "schema-mismatch",
        detail: `Table ${table} has columns the hub schema lacks: ${missing.join(", ") || "(table missing)"}.`,
      });
    }

    const columnList = sourceColumns.map(quoteIdentifier).join(", ");
    const jsonColumns = sourceColumns.map((name) => name.endsWith("_json"));
    const rowsPerInsert = Math.max(
      1,
      Math.min(pageRows, Math.floor(MAX_PARAMETERS_PER_INSERT / (sourceColumns.length + 1))),
    );
    let lastRowId = -1;
    let copied = 0;
    while (true) {
      const page = yield* source.unsafe<Record<string, unknown>>(
        `SELECT rowid AS "__rowid", ${columnList} FROM ${quoteIdentifier(table)}
         WHERE rowid > ? ORDER BY rowid LIMIT ?`,
        [lastRowId, rowsPerInsert],
      );
      if (page.length === 0) {
        return copied;
      }
      const params: Array<unknown> = [];
      const tuples = page.map((row) => {
        const placeholders = [`$${params.push(hub.tenantId)}`];
        sourceColumns.forEach((column, index) => {
          const value = row[column];
          placeholders.push(
            `$${params.push(
              jsonColumns[index] && typeof value === "string"
                ? neutralizeJsonNulEscapes(value)
                : typeof value === "bigint"
                  ? Number(value)
                  : (value ?? null),
            )}`,
          );
        });
        return `(${placeholders.join(", ")})`;
      });
      yield* hub.sql.unsafe(
        `INSERT INTO ${quoteIdentifier(table)} (user_id, ${columnList}) VALUES ${tuples.join(", ")}`,
        params,
      );
      copied += page.length;
      lastRowId = Number(page[page.length - 1]!["__rowid"]);
    }
  });

/** Copies the standalone state into the hub tenant in one transaction. */
export const importStandaloneState = (input: HubImportInput) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { hub, source } = input;
    const key = yield* Effect.sync(() => parseHubSecretKey(input.secretKey));
    yield* verifySourceVersion(source);

    return yield* hub.sql.withTransaction(
      Effect.gen(function* () {
        const occupied: Array<string> = [];
        for (const table of HUB_BASELINE_TENANT_TABLES) {
          const [row] = yield* hub.sql<{ readonly present: boolean }>`
            SELECT EXISTS (
              SELECT 1 FROM ${hub.sql(table)} WHERE user_id = ${hub.tenantId}
            ) AS present
          `;
          if (row?.present) occupied.push(table);
        }
        if (occupied.length > 0 && !input.replace) {
          return yield* new HubImportError({
            reason: "tenant-not-empty",
            detail: `Tenant already has hub data (${occupied.length} tables); rerun with --replace to overwrite it.`,
          });
        }
        for (const table of occupied) {
          yield* hub.sql`DELETE FROM ${hub.sql(table)} WHERE user_id = ${hub.tenantId}`;
        }

        const rows: Record<string, number> = {};
        for (const { table, pageRows } of IMPORTED_TABLES) {
          rows[table] = yield* importTable(source, hub, table, pageRows);
        }

        const [sequence] = yield* source<{ readonly last: number | null }>`
          SELECT max(sequence) AS last FROM orchestration_events
        `;
        const lastEventSequence = Number(sequence?.last ?? 0);
        yield* hub.sql`
          INSERT INTO hub_users (user_id, last_event_sequence)
          VALUES (${hub.tenantId}, ${lastEventSequence})
          ON CONFLICT (user_id) DO UPDATE SET last_event_sequence = excluded.last_event_sequence
        `;

        let documents = 0;
        for (const name of IMPORTED_DOCUMENTS) {
          const filePath = path.join(input.stateDir, name);
          if (!(yield* fileSystem.exists(filePath))) continue;
          const contents = yield* fileSystem.readFileString(filePath);
          yield* hub.sql`
            INSERT INTO hub_documents (user_id, name, contents)
            VALUES (${hub.tenantId}, ${name}, ${contents})
          `;
          documents += 1;
        }

        let secrets = 0;
        const secretsDir = path.join(input.stateDir, "secrets");
        if (yield* fileSystem.exists(secretsDir)) {
          for (const entry of (yield* fileSystem.readDirectory(secretsDir)).toSorted()) {
            if (!entry.startsWith(IMPORTED_SECRET_PREFIX) || !entry.endsWith(".bin")) continue;
            const name = entry.slice(0, -".bin".length);
            const plaintext = yield* fileSystem.readFile(path.join(secretsDir, entry));
            const stored = encryptHubSecret({ key, tenantId: hub.tenantId, name, plaintext });
            yield* hub.sql`
              INSERT INTO hub_secrets (user_id, name, format, nonce, ciphertext)
              VALUES (${hub.tenantId}, ${name}, ${stored.format}, ${stored.nonce}, ${stored.ciphertext})
            `;
            secrets += 1;
          }
        }

        let attachments = 0;
        let attachmentsSkipped = 0;
        const attachmentsDir = path.join(input.stateDir, "attachments");
        if (yield* fileSystem.exists(attachmentsDir)) {
          for (const entry of (yield* fileSystem.readDirectory(attachmentsDir)).toSorted()) {
            const attachmentId = entry.endsWith(".part")
              ? null
              : parseAttachmentIdFromRelativePath(entry);
            const threadSegment = attachmentId
              ? parseThreadSegmentFromAttachmentId(attachmentId)
              : null;
            const filePath = path.join(attachmentsDir, entry);
            const info = yield* fileSystem.stat(filePath);
            if (
              !attachmentId ||
              !threadSegment ||
              info.type !== "File" ||
              Number(info.size) > PROVIDER_SEND_TURN_MAX_FILE_BYTES
            ) {
              attachmentsSkipped += 1;
              continue;
            }
            const content = yield* fileSystem.readFile(filePath);
            yield* hub.sql`
              INSERT INTO hub_attachments (
                user_id, relative_path, attachment_id, thread_segment, size_bytes, content
              )
              VALUES (
                ${hub.tenantId}, ${entry}, ${attachmentId}, ${threadSegment},
                ${content.byteLength}, ${content}
              )
            `;
            attachments += 1;
          }
        }

        let repositoryIdentities = 0;
        if (input.resolveRepositoryIdentity !== undefined) {
          const projects = yield* hub.sql<{
            readonly projectId: string;
            readonly workspaceRoot: string;
          }>`
            SELECT project_id AS "projectId", workspace_root AS "workspaceRoot"
            FROM projection_projects
            WHERE user_id = ${hub.tenantId} AND deleted_at IS NULL
          `;
          for (const project of projects) {
            if (!(yield* fileSystem.exists(project.workspaceRoot))) continue;
            const identity = yield* input.resolveRepositoryIdentity(project.workspaceRoot);
            if (identity === null) continue;
            yield* hub.sql`
              UPDATE projection_projects
              SET repository_identity_json = ${encodeRepositoryIdentityJson(identity)}
              WHERE user_id = ${hub.tenantId} AND project_id = ${project.projectId}
            `;
            repositoryIdentities += 1;
          }
        }

        return {
          rows,
          lastEventSequence,
          documents,
          attachments,
          attachmentsSkipped,
          secrets,
          repositoryIdentities,
          replacedExisting: occupied.length > 0,
        } satisfies HubImportReport;
      }),
    );
  });
