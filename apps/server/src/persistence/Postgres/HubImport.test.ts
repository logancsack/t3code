/**
 * `t3 hub import`: a synthetic standalone state directory copied into a hub
 * tenant must read back exactly as it did standalone. Runs only with
 * T3_HUB_TEST_DATABASE_URL (see `hubTestDatabase.ts`); the NUL-escape rule is
 * checked without a database.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { createAttachmentId } from "../../attachmentStore.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../config.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { OrchestrationLayerLive } from "../../orchestration/runtimeLayer.ts";
import { RepositoryIdentityResolver } from "../../project/RepositoryIdentityResolver.ts";
import {
  layerConfig as ServerPersistenceLive,
  makeSqlitePersistenceLive,
} from "../Layers/Sqlite.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import { HubDatabase } from "./HubDatabase.ts";
import {
  importStandaloneState,
  neutralizeJsonNulEscapes,
  type HubImportReport,
} from "./HubImport.ts";
import {
  HUB_TEST_SECRET_KEY,
  hubTestDatabaseLayer,
  hubTestDatabaseUrl,
  hubTestServerConfigLayer,
  makeHubTestSchema,
  type HubTestSchema,
} from "./hubTestDatabase.ts";
import { orchestrationScenario, readScenario, threadId } from "./hubTestScenario.ts";

const TENANT = "tenant-import";

const withSchema = <A, E, R>(use: (schema: HubTestSchema) => Effect.Effect<A, E, R>) =>
  Effect.scoped(Effect.flatMap(makeHubTestSchema(hubTestDatabaseUrl!), use)).pipe(
    Effect.provide(Reactivity.layer),
  );

const platform = Layer.mergeAll(
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-hub-import-" }),
  Layer.succeed(RepositoryIdentityResolver, { resolve: () => Effect.succeed(null) }),
).pipe(Layer.provideMerge(NodeServices.layer));

const hub = (schema: HubTestSchema) =>
  ServerPersistenceLive.pipe(
    Layer.provideMerge(hubTestDatabaseLayer(schema, TENANT)),
    Layer.provide(platform),
  );

/** Standalone strings with a NUL read back from the hub with U+FFFD instead (plain data only). */
const withNulReplaced = (value: unknown): unknown => {
  if (typeof value === "string") return value.replaceAll("\u0000", "�");
  if (Array.isArray(value)) return value.map(withNulReplaced);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, withNulReplaced(inner)]),
    );
  }
  return value;
};

const repositoryIdentity = {
  canonicalKey: "github.com/aldo/app",
  locator: {
    source: "git-remote" as const,
    remoteName: "origin",
    remoteUrl: "git@github.com:aldo/app.git",
  },
  provider: "github",
  owner: "aldo",
  name: "app",
};

describe("neutralizeJsonNulEscapes", () => {
  it("replaces NUL escapes but not escaped backslashes followed by u0000", () => {
    assert.strictEqual(neutralizeJsonNulEscapes('{"a":"x\\u0000y"}'), '{"a":"x\\ufffdy"}');
    assert.strictEqual(
      neutralizeJsonNulEscapes('{"a":"\\u0000\\u0000"}'),
      '{"a":"\\ufffd\\ufffd"}',
    );
    assert.strictEqual(neutralizeJsonNulEscapes('{"a":"\\\\u0000"}'), '{"a":"\\\\u0000"}');
    assert.strictEqual(neutralizeJsonNulEscapes('{"a":"\\\\\\u0000"}'), '{"a":"\\\\\\ufffd"}');
    assert.strictEqual(neutralizeJsonNulEscapes('{"a":1}'), '{"a":1}');
  });
});

describe.skipIf(hubTestDatabaseUrl === undefined)("hub import", () => {
  it.effect("copies a standalone state directory into a tenant, once", () =>
    withSchema((schema) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const stateDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-standalone-" });
        const checkout = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-checkout-" });
        const databasePath = path.join(stateDir, "state.sqlite");

        // A standalone server's history, written through the standalone layers.
        const standalone = yield* orchestrationScenario("alice", checkout).pipe(
          Effect.provide(
            OrchestrationLayerLive.pipe(
              Layer.provideMerge(makeSqlitePersistenceLive(databasePath)),
              Layer.provideMerge(platform),
            ),
          ),
        );
        yield* fileSystem.writeFileString(
          path.join(stateDir, "settings.json"),
          '{ "enableProviderUpdateChecks": false }\n',
        );
        yield* fileSystem.writeFileString(path.join(stateDir, "keybindings.json"), "[]\n");
        yield* fileSystem.writeFileString(
          path.join(stateDir, "environment-id"),
          "4f2d8c3e-1d0b-4b8e-9b53-2c0c6c0d5e21\n",
        );
        yield* fileSystem.makeDirectory(path.join(stateDir, "secrets"));
        yield* fileSystem.writeFile(
          path.join(stateDir, "secrets", "provider-env-Y29kZXg-T1BFTlJPVVRFUl9BUElfS0VZ.bin"),
          new TextEncoder().encode("sk-or-secret"),
        );
        yield* fileSystem.writeFile(
          path.join(stateDir, "secrets", "session-signing-key.bin"),
          new Uint8Array(32),
        );
        const attachmentsDir = path.join(stateDir, "attachments");
        yield* fileSystem.makeDirectory(attachmentsDir);
        const attachmentFile = `${createAttachmentId(threadId)}.png`;
        const attachmentBytes = new Uint8Array([137, 80, 78, 71, 0, 1, 2]);
        yield* fileSystem.writeFile(path.join(attachmentsDir, attachmentFile), attachmentBytes);
        yield* fileSystem.writeFile(
          path.join(attachmentsDir, "upload.png.abc.part"),
          new Uint8Array(3),
        );

        const source = yield* Layer.build(
          NodeSqliteClient.layer({ filename: databasePath, readonly: true }),
        ).pipe(Effect.map((context) => Context.get(context, SqlClient.SqlClient)));
        const sourceCounts = yield* Effect.forEach(
          ["orchestration_events", "projection_thread_activities", "projection_turns"],
          (table) =>
            source.unsafe<{ readonly count: number }>(`SELECT count(*) AS count FROM ${table}`),
        );

        const runImport = (options: {
          readonly replace: boolean;
          readonly withIdentity: boolean;
        }) =>
          Effect.flatMap(HubDatabase, (database) =>
            importStandaloneState({
              stateDir,
              source,
              hub: database!,
              secretKey: HUB_TEST_SECRET_KEY,
              replace: options.replace,
              ...(options.withIdentity
                ? {
                    resolveRepositoryIdentity: (root: string) =>
                      Effect.succeed(root === checkout ? repositoryIdentity : null),
                  }
                : {}),
            }),
          ).pipe(Effect.provide(hubTestDatabaseLayer(schema, TENANT)));

        const report: HubImportReport = yield* runImport({ replace: false, withIdentity: false });
        assert.strictEqual(report.rows.orchestration_events, sourceCounts[0]?.[0]?.count);
        assert.strictEqual(report.rows.projection_thread_activities, sourceCounts[1]?.[0]?.count);
        assert.strictEqual(report.rows.projection_turns, sourceCounts[2]?.[0]?.count);
        assert.strictEqual(report.lastEventSequence, standalone.events.at(-1)?.sequence);
        assert.deepStrictEqual(
          [report.documents, report.secrets, report.attachments, report.attachmentsSkipped],
          [3, 1, 1, 1],
        );
        assert.isFalse(report.replacedExisting);

        // Everything reads back as it did standalone.
        const imported = yield* readScenario(checkout).pipe(
          Effect.provide(
            OrchestrationLayerLive.pipe(
              Layer.provideMerge(hub(schema)),
              Layer.provideMerge(platform),
            ),
          ),
        );
        assert.deepStrictEqual(withNulReplaced(imported), withNulReplaced(standalone));
        assert.strictEqual(imported.shell.threads.length, 1);
        assert.isTrue(Option.isSome(imported.detailSnapshot));

        // A second import is refused; --replace starts over and records identities.
        const refused = yield* runImport({ replace: false, withIdentity: false }).pipe(Effect.flip);
        assert.strictEqual(refused._tag === "HubImportError" && refused.reason, "tenant-not-empty");
        const replaced = yield* runImport({ replace: true, withIdentity: true });
        assert.isTrue(replaced.replacedExisting);
        assert.strictEqual(replaced.repositoryIdentities, 1);
        assert.deepStrictEqual(replaced.rows, report.rows);

        yield* Effect.gen(function* () {
          const engine = yield* OrchestrationEngineService;
          const secrets = yield* ServerSecretStore.ServerSecretStore;
          const database = (yield* HubDatabase)!;

          // New commands continue the imported sequence.
          const result = yield* engine.dispatch({
            type: "thread.meta.update",
            commandId: CommandId.make("cmd-after-import"),
            threadId,
            title: "After import",
          });
          assert.strictEqual(result.sequence, report.lastEventSequence + 1);

          const secret = yield* secrets.get("provider-env-Y29kZXg-T1BFTlJPVVRFUl9BUElfS0VZ");
          assert.strictEqual(new TextDecoder().decode(Option.getOrThrow(secret)), "sk-or-secret");
          assert.isTrue(Option.isNone(yield* secrets.get("session-signing-key")));

          const [attachment] = yield* database.sql<{ readonly content: Uint8Array }>`
            SELECT content FROM hub_attachments WHERE user_id = ${TENANT}
          `;
          assert.deepStrictEqual(new Uint8Array(attachment!.content), attachmentBytes);
          const [project] = yield* database.sql<{ readonly identity: string }>`
            SELECT repository_identity_json AS identity FROM projection_projects
            WHERE user_id = ${TENANT}
          `;
          assert.include(project!.identity, "github.com/aldo/app");
          const payloads = yield* database.sql<{ readonly payload: string }>`
            SELECT payload_json AS payload FROM projection_thread_activities
            WHERE user_id = ${TENANT}
          `;
          assert.isTrue(payloads.every((row) => !row.payload.includes("\\u0000")));
        }).pipe(
          Effect.provide(
            Layer.mergeAll(OrchestrationLayerLive, ServerSecretStore.layer).pipe(
              Layer.provideMerge(ServerPersistenceLive),
              Layer.provideMerge(hubTestDatabaseLayer(schema, TENANT)),
              Layer.provideMerge(hubTestServerConfigLayer(schema, TENANT)),
              Layer.provideMerge(
                Layer.succeed(RepositoryIdentityResolver, { resolve: () => Effect.succeed(null) }),
              ),
              Layer.provideMerge(NodeServices.layer),
            ),
          ),
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    ),
  );
});
