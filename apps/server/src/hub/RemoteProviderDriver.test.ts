// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import { afterEach, describe, expect } from "vite-plus/test";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import { ServerConfig } from "../config.ts";
import * as McpProviderSession from "../mcp/McpProviderSession.ts";
import { HubThreadMachineStateSqliteLive } from "../persistence/Layers/HubThreadMachineState.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { persistHubAttachment } from "../persistence/Postgres/HubAttachments.ts";
import {
  hubTestDatabaseLayer,
  hubTestDatabaseUrl,
  makeHubTestSchema,
} from "../persistence/Postgres/hubTestDatabase.ts";
import * as ProviderSessionRuntime from "../persistence/ProviderSessionRuntime.ts";
import { CodexDriver } from "../provider/Drivers/CodexDriver.ts";
import * as HubProviderSnapshots from "./HubProviderSnapshots.ts";
import { MachineDirectory, makeFakeMachineDirectory } from "./MachineDirectory.ts";
import {
  attachmentFilesForRunner,
  makeRemoteProviderDriver,
  mcpSessionForRunner,
} from "./RemoteProviderDriver.ts";
import * as RemoteSessionRegistry from "./RemoteSessionRegistry.ts";
import { make as makePool, RunnerConnectionPool } from "./RunnerConnectionPool.ts";
import * as RunnerEventDelivery from "./RunnerEventDelivery.ts";

const threadId = ThreadId.make("thread-remote-driver");
const provider = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex");

const tempDirs: Array<string> = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

describe("remote provider driver helpers", () => {
  it("points runners at the hub's public MCP endpoint when one is configured", () => {
    McpProviderSession.setMcpProviderSession({
      environmentId: EnvironmentId.make("env-1"),
      threadId,
      providerSessionId: "session-1",
      providerInstanceId: instanceId,
      endpoint: "http://127.0.0.1:4421/mcp",
      authorizationHeader: "Bearer token",
    });
    expect(mcpSessionForRunner(threadId, "https://hub.example/u/1/")?.endpoint).toBe(
      "https://hub.example/u/1/mcp",
    );
    expect(mcpSessionForRunner(threadId, undefined)?.endpoint).toBe("http://127.0.0.1:4421/mcp");
    McpProviderSession.clearMcpProviderSession(threadId);
    expect(mcpSessionForRunner(threadId, "https://hub.example")).toBeNull();
  });

  it.effect("ships the bytes of stored attachments and skips missing ones", () =>
    Effect.gen(function* () {
      const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hub-attachments-test-"));
      tempDirs.push(dir);
      const stored = {
        type: "file" as const,
        id: `${threadId}-2e2e2e2e-0000-4000-8000-000000000000`,
        name: "notes.md",
        mimeType: "text/markdown",
        sizeBytes: 3,
      };
      const missing = { ...stored, id: `${threadId}-3f3f3f3f-0000-4000-8000-000000000000` };
      const storedPath = resolveAttachmentPath({ attachmentsDir: dir, attachment: stored })!;
      NodeFS.mkdirSync(NodePath.dirname(storedPath), { recursive: true });
      NodeFS.writeFileSync(storedPath, "abc");
      const files = yield* attachmentFilesForRunner(dir, [stored, missing]);
      expect(files).toEqual([
        {
          attachment: stored,
          hubPath: storedPath,
          bytesBase64: Buffer.from("abc").toString("base64"),
        },
      ]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect.skipIf(hubTestDatabaseUrl === undefined)(
    "restores an attachment the hub's local cache lost before shipping it",
    () =>
      Effect.gen(function* () {
        const schema = yield* makeHubTestSchema(hubTestDatabaseUrl!);
        const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hub-attachments-test-"));
        tempDirs.push(dir);
        const attachment = {
          type: "file" as const,
          id: `${threadId}-4a4a4a4a-0000-4000-8000-000000000000`,
          name: "notes.md",
          mimeType: "text/markdown",
          sizeBytes: 3,
        };
        const hubPath = resolveAttachmentPath({ attachmentsDir: dir, attachment })!;
        NodeFS.mkdirSync(NodePath.dirname(hubPath), { recursive: true });
        NodeFS.writeFileSync(hubPath, "abc");
        const files = yield* Effect.gen(function* () {
          yield* persistHubAttachment({
            attachmentsDir: dir,
            relativePath: NodePath.relative(dir, hubPath),
          });
          // A new hub process on a fresh base directory.
          NodeFS.rmSync(hubPath);
          return yield* attachmentFilesForRunner(dir, [attachment]);
        }).pipe(Effect.provide(hubTestDatabaseLayer(schema, "user-attachments")));
        expect(files).toEqual([
          { attachment, hubPath, bytesBase64: Buffer.from("abc").toString("base64") },
        ]);
      }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, Reactivity.layer))),
  );
});

const StoresLive = HubProviderSnapshots.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(HubThreadMachineStateSqliteLive, ProviderSessionRuntime.layer)),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(NodeServices.layer),
);

describe("remote provider adapter session answers", () => {
  it.live("answers hasSession and listSessions from the hub and never wakes a machine", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* makeFakeMachineDirectory({
          initial: [[threadId, { state: "paused" }]],
        });
        const pool = yield* makePool({ idleCheckInterval: "1 hour" }).pipe(
          Effect.provideService(MachineDirectory, fake.directory),
        );
        const registry = yield* RemoteSessionRegistry.make;
        const delivery = yield* RunnerEventDelivery.make.pipe(
          Effect.provideService(RunnerConnectionPool, pool),
          Effect.provideService(RemoteSessionRegistry.RemoteSessionRegistry, registry),
        );
        const instance = yield* makeRemoteProviderDriver(CodexDriver)
          .create({
            instanceId,
            displayName: undefined,
            environment: [],
            enabled: true,
            config: CodexDriver.defaultConfig(),
          })
          .pipe(
            Effect.provideService(RunnerConnectionPool, pool),
            Effect.provideService(RunnerEventDelivery.RunnerEventDelivery, delivery),
            Effect.provideService(RemoteSessionRegistry.RemoteSessionRegistry, registry),
            Effect.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-remote-driver-" })),
          );
        const adapter = instance.adapter;
        expect(adapter.capabilities.sessionsOutliveServer).toBe(true);
        expect(yield* adapter.hasSession(threadId)).toBe(false);

        yield* registry.upsert({
          threadId,
          instanceId,
          provider,
          bootId: "boot-1",
          session: {
            provider,
            providerInstanceId: instanceId,
            status: "ready",
            runtimeMode: "full-access",
            threadId,
            createdAt: "t",
            updatedAt: "t",
          },
        });
        // The machine is asleep, yet the session is resumable, so it exists.
        expect(yield* adapter.hasSession(threadId)).toBe(true);
        expect((yield* adapter.listSessions()).map((session) => session.threadId)).toEqual([
          threadId,
        ]);

        // No active turn: interrupting does not wake the machine; stopping forgets the session.
        yield* adapter.interruptTurn(threadId, TurnId.make("turn-1"));
        yield* adapter.stopSession(threadId);
        expect(yield* adapter.hasSession(threadId)).toBe(false);
        yield* adapter.stopAll();
        expect(yield* fake.calls).toEqual([]);
      }),
    ).pipe(Effect.provide(StoresLive)),
  );
});
