/**
 * Hub replacements for state-directory files: secrets, settings, keybindings,
 * environment and anonymous ids, and attachments. Runs only with
 * T3_HUB_TEST_DATABASE_URL (see `hubTestDatabase.ts`).
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";

import { createPendingAttachmentId } from "../../attachmentStore.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../config.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as Keybindings from "../../keybindings.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { getTelemetryIdentifierForHome } from "../../telemetry/Identify.ts";
import { layerConfig as ServerPersistenceLive } from "../Layers/Sqlite.ts";
import {
  hydrateHubAttachment,
  persistHubAttachment,
  removeHubAttachmentById,
  removeHubThreadAttachments,
  sweepHubPendingAttachments,
} from "./HubAttachments.ts";
import { HubDatabase } from "./HubDatabase.ts";
import {
  HUB_TEST_SECRET_KEY,
  hubTestDatabaseLayer,
  hubTestDatabaseUrl,
  hubTestServerConfigLayer,
  makeHubTestSchema,
  type HubTestSchema,
} from "./hubTestDatabase.ts";

const withSchema = <A, E, R>(use: (schema: HubTestSchema) => Effect.Effect<A, E, R>) =>
  Effect.scoped(Effect.flatMap(makeHubTestSchema(hubTestDatabaseUrl!), use)).pipe(
    Effect.provide(Reactivity.layer),
  );

/** One hub process for `tenantId`: its database and hub-mode config. */
const hubProcess = (
  schema: HubTestSchema,
  tenantId: string,
  options: { readonly secretKey?: string } = {},
) =>
  Layer.mergeAll(
    hubTestDatabaseLayer(schema, tenantId),
    hubTestServerConfigLayer(schema, tenantId, options),
  );

const secretStoreLayer = (schema: HubTestSchema, tenantId: string, secretKey?: string) =>
  ServerSecretStore.layer.pipe(
    Layer.provideMerge(hubProcess(schema, tenantId, secretKey ? { secretKey } : {})),
  );

const stateFileExists = (select: (config: ServerConfig.ServerConfig["Service"]) => string) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.exists(select(config));
  });

describe.skipIf(hubTestDatabaseUrl === undefined)("hub stores", () => {
  it.effect("encrypts secrets per tenant and name", () =>
    withSchema((schema) =>
      Effect.gen(function* () {
        const plaintext = new TextEncoder().encode("session-signing-key-material");

        const stored = yield* Effect.gen(function* () {
          const secrets = yield* ServerSecretStore.ServerSecretStore;
          yield* secrets.set("session-signing-key", plaintext);
          assert.deepStrictEqual(
            Option.getOrThrow(yield* secrets.get("session-signing-key")),
            plaintext,
          );
          const duplicate = yield* secrets
            .create("session-signing-key", plaintext)
            .pipe(Effect.exit);
          assert.isTrue(
            Exit.isFailure(duplicate) &&
              duplicate.cause.reasons.some(
                (reason) =>
                  reason._tag === "Fail" &&
                  ServerSecretStore.isSecretAlreadyExistsError(reason.error),
              ),
          );
          const racers = yield* Effect.all(
            Array.from({ length: 5 }, () => secrets.getOrCreateRandom("asset-signing-key", 32)),
            { concurrency: "unbounded" },
          );
          assert.strictEqual(
            new Set(racers.map((value) => Buffer.from(value).toString("hex"))).size,
            1,
          );
          assert.strictEqual(racers[0]?.byteLength, 32);

          const sql = (yield* HubDatabase)!.sql;
          const rows = yield* sql<{
            readonly format: number;
            readonly nonce: Uint8Array;
            readonly ciphertext: Uint8Array;
          }>`SELECT format, nonce, ciphertext FROM hub_secrets WHERE user_id = 'tenant-a' AND name = 'session-signing-key'`;
          const row = rows[0]!;
          assert.strictEqual(row.format, 1);
          assert.strictEqual(row.nonce.byteLength, 12);
          assert.isFalse(Buffer.from(row.ciphertext).includes(Buffer.from(plaintext)));

          yield* secrets.remove("asset-signing-key");
          assert.isTrue(Option.isNone(yield* secrets.get("asset-signing-key")));
          return row;
        }).pipe(Effect.provide(secretStoreLayer(schema, "tenant-a")));

        // A row moved to another tenant does not authenticate there.
        yield* Effect.gen(function* () {
          const sql = (yield* HubDatabase)!.sql;
          yield* sql`
            INSERT INTO hub_secrets (user_id, name, format, nonce, ciphertext)
            VALUES ('tenant-b', 'session-signing-key', ${stored.format}, ${stored.nonce}, ${stored.ciphertext})
          `;
          const secrets = yield* ServerSecretStore.ServerSecretStore;
          const read = yield* secrets.get("session-signing-key").pipe(Effect.exit);
          assert.isTrue(Exit.isFailure(read));
        }).pipe(Effect.provide(secretStoreLayer(schema, "tenant-b")));

        // Nor does it decrypt with another key.
        const otherKey = Buffer.alloc(32, 9).toString("base64");
        yield* Effect.gen(function* () {
          const secrets = yield* ServerSecretStore.ServerSecretStore;
          const read = yield* secrets.get("session-signing-key").pipe(Effect.exit);
          assert.isTrue(Exit.isFailure(read));
        }).pipe(Effect.provide(secretStoreLayer(schema, "tenant-a", otherKey)));
        assert.notStrictEqual(otherKey, HUB_TEST_SECRET_KEY);
      }).pipe(Effect.provide(NodeServices.layer)),
    ),
  );

  it.effect("keeps settings, keybindings, and ids in Postgres across restarts", () =>
    withSchema((schema) =>
      Effect.gen(function* () {
        const instanceId = ProviderInstanceId.make("codex_personal");
        const stores = Layer.mergeAll(
          ServerSettings.layer,
          Keybindings.layer,
          ServerEnvironment.identityLayer,
        ).pipe(
          Layer.provideMerge(ServerSecretStore.layer),
          Layer.provideMerge(ServerPersistenceLive),
          Layer.provideMerge(hubProcess(schema, "tenant-a")),
        );

        const first = yield* Effect.gen(function* () {
          const settings = yield* ServerSettings.ServerSettingsService;
          const keybindings = yield* Keybindings.Keybindings;
          const identity = yield* ServerEnvironment.ServerEnvironmentIdentity;
          yield* settings.start;
          yield* keybindings.start;

          const changes = yield* settings.subscribeChanges;
          yield* settings.updateSettings({
            enableLegacyTokenStreaming: true,
            providerInstances: {
              [instanceId]: {
                driver: ProviderDriverKind.make("codex"),
                environment: [
                  { name: "OPENROUTER_API_KEY", value: "sk-or-secret", sensitive: true },
                ],
                config: {},
              },
            },
          });
          // One process owns the tenant, so in-process notification is the watcher.
          const changed = yield* Stream.runHead(changes);
          assert.isTrue(Option.isSome(changed) && changed.value.enableLegacyTokenStreaming);
          yield* keybindings.upsertKeybindingRule({
            key: "mod+shift+r",
            command: "script.run-tests.run",
          });

          assert.isFalse(yield* stateFileExists((config) => config.settingsPath));
          assert.isFalse(yield* stateFileExists((config) => config.keybindingsConfigPath));
          assert.isFalse(yield* stateFileExists((config) => config.environmentIdPath));
          assert.isFalse(yield* stateFileExists((config) => config.secretsDir));
          assert.isFalse(yield* stateFileExists((config) => config.dbPath));

          const sql = (yield* HubDatabase)!.sql;
          const documents = yield* sql<{ readonly name: string; readonly contents: string }>`
            SELECT name, contents FROM hub_documents WHERE user_id = 'tenant-a' ORDER BY name
          `;
          assert.deepStrictEqual(
            documents.map((document) => document.name),
            ["environment-id", "keybindings.json", "settings.json"],
          );
          assert.notInclude(
            documents.map((document) => document.contents).join("\n"),
            "sk-or-secret",
          );
          return { environmentId: yield* identity.getEnvironmentId };
        }).pipe(Effect.provide(Layer.fresh(stores)));

        // A new process on a new, empty base directory sees the same state.
        yield* Effect.gen(function* () {
          const settings = yield* ServerSettings.ServerSettingsService;
          const keybindings = yield* Keybindings.Keybindings;
          const identity = yield* ServerEnvironment.ServerEnvironmentIdentity;
          yield* settings.start;
          yield* keybindings.start;

          const current = yield* settings.getSettings;
          assert.isTrue(current.enableLegacyTokenStreaming);
          assert.strictEqual(
            current.providerInstances[instanceId]?.environment?.[0]?.value,
            "sk-or-secret",
          );
          const snapshot = yield* keybindings.getSnapshot;
          assert.isTrue(
            snapshot.keybindings.some((binding) => binding.command === "script.run-tests.run"),
          );
          assert.strictEqual(yield* identity.getEnvironmentId, first.environmentId);
        }).pipe(Effect.provide(Layer.fresh(stores)));

        // The anonymous telemetry id is a hub document too.
        const home = yield* Effect.flatMap(FileSystem.FileSystem, (fileSystem) =>
          fileSystem.makeTempDirectoryScoped({ prefix: "t3-hub-home-" }),
        );
        const identify = getTelemetryIdentifierForHome(home).pipe(
          Effect.provide(hubProcess(schema, "tenant-a")),
        );
        const firstId = yield* identify;
        assert.isString(firstId);
        assert.strictEqual(yield* identify, firstId);
      }).pipe(Effect.provide(NodeServices.layer)),
    ),
  );

  it.effect("stores attachment bytes durably behind the local cache", () =>
    withSchema((schema) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const config = yield* ServerConfig.ServerConfig;
        const sql = (yield* HubDatabase)!.sql;
        const bytes = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253]);

        const pendingId = createPendingAttachmentId("pdf");
        const pendingPath = `${pendingId}.pdf`;
        yield* fileSystem.writeFile(path.join(config.attachmentsDir, pendingPath), bytes);
        yield* persistHubAttachment({
          attachmentsDir: config.attachmentsDir,
          relativePath: pendingPath,
        });

        // The cache is disposable: a lookup after losing it restores the bytes.
        yield* fileSystem.remove(path.join(config.attachmentsDir, pendingPath));
        yield* hydrateHubAttachment({
          attachmentsDir: config.attachmentsDir,
          attachmentId: pendingId,
        });
        assert.deepStrictEqual(
          new Uint8Array(yield* fileSystem.readFile(path.join(config.attachmentsDir, pendingPath))),
          bytes,
        );

        const threadFile = (name: string) => `thread-1-${name}.png`;
        for (const name of [
          "00000000-0000-4000-8000-000000000001",
          "00000000-0000-4000-8000-000000000002",
        ]) {
          yield* fileSystem.writeFile(path.join(config.attachmentsDir, threadFile(name)), bytes);
          yield* persistHubAttachment({
            attachmentsDir: config.attachmentsDir,
            relativePath: threadFile(name),
          });
        }
        const listThread = sql<{ readonly relativePath: string }>`
          SELECT relative_path AS "relativePath" FROM hub_attachments
          WHERE user_id = 'tenant-a' AND thread_segment = 'thread-1' ORDER BY relative_path
        `.pipe(Effect.map((rows) => rows.map((row) => row.relativePath)));
        assert.strictEqual((yield* listThread).length, 2);
        yield* removeHubThreadAttachments(
          "thread-1",
          new Set([threadFile("00000000-0000-4000-8000-000000000002")]),
        );
        assert.deepStrictEqual(yield* listThread, [
          threadFile("00000000-0000-4000-8000-000000000002"),
        ]);
        yield* removeHubThreadAttachments("thread-1");
        assert.deepStrictEqual(yield* listThread, []);

        // Unclaimed pending uploads expire.
        yield* sweepHubPendingAttachments(60_000);
        const countPending = sql<{ readonly count: number }>`
          SELECT count(*) AS count FROM hub_attachments WHERE thread_segment = 'pending'
        `.pipe(Effect.map((rows) => rows[0]?.count));
        assert.strictEqual(yield* countPending, 1);
        yield* sql`UPDATE hub_attachments SET created_at = now() - interval '2 days'`;
        yield* sweepHubPendingAttachments(24 * 60 * 60 * 1000);
        assert.strictEqual(yield* countPending, 0);

        yield* removeHubAttachmentById(pendingId);
      }).pipe(
        Effect.provide(hubProcess(schema, "tenant-a").pipe(Layer.provideMerge(NodeServices.layer))),
      ),
    ),
  );
});
