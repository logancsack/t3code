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
  type ProviderSendTurnInput,
  type ServerProvider,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect } from "vite-plus/test";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import { ServerConfig } from "../config.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import { MachineDirectory, makeFakeMachineDirectory } from "../hub/MachineDirectory.ts";
import { make as makePool } from "../hub/RunnerConnectionPool.ts";
import { serveRunner } from "../hub/testUtils/runnerServer.ts";
import * as McpProviderSession from "../mcp/McpProviderSession.ts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import type { ProviderAdapterShape } from "../provider/Services/ProviderAdapter.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import * as ReviewService from "../review/ReviewService.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import type { TextGenerationShape } from "../textGeneration/TextGeneration.ts";
import * as VcsProvisioningService from "../vcs/VcsProvisioningService.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import * as RunnerCheckout from "./RunnerCheckout.ts";
import { RunnerRpcHandlersLive } from "./RunnerHandlers.ts";
import { makeWithOptions as makeOutbox, RunnerOutbox } from "./RunnerOutbox.ts";

const threadId = ThreadId.make("thread-handlers");
const provider = ProviderDriverKind.make("claudeAgent");
const instanceId = ProviderInstanceId.make("claudeAgent");

const tempDirs: Array<string> = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

/** A runner with a recording provider adapter, served on loopback, and a client pool. */
const setup = Effect.gen(function* () {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "runner-handlers-test-"));
  tempDirs.push(root);
  const checkout = NodePath.join(root, "t", threadId);
  NodeFS.mkdirSync(checkout, { recursive: true });
  const turns: Array<ProviderSendTurnInput> = [];
  const mcpAtStart: Array<McpProviderSession.McpProviderSessionConfig | undefined> = [];
  const events = yield* PubSub.unbounded<never>();
  const adapter = {
    provider,
    capabilities: { sessionModelSwitch: "in-session" },
    startSession: (input) =>
      Effect.sync(() => {
        mcpAtStart.push(McpProviderSession.readMcpProviderSession(input.threadId));
        return {
          provider,
          status: "ready",
          runtimeMode: input.runtimeMode,
          threadId: input.threadId,
          createdAt: "t",
          updatedAt: "t",
        } as const;
      }),
    sendTurn: (input) =>
      Effect.sync(() => {
        turns.push(input);
        return { threadId: input.threadId, turnId: TurnId.make("turn-1") };
      }),
    interruptTurn: () => Effect.void,
    respondToRequest: () => Effect.void,
    respondToUserInput: () => Effect.void,
    stopSession: () => Effect.void,
    listSessions: () => Effect.succeed([]),
    hasSession: () => Effect.succeed(false),
    readThread: () => Effect.succeed({ threadId, turns: [] }),
    rollbackThread: () => Effect.succeed({ threadId, turns: [] }),
    stopAll: () => Effect.void,
    streamEvents: Stream.fromPubSub(events),
  } satisfies ProviderAdapterShape<never>;
  const instance: ProviderInstance = {
    instanceId,
    driverKind: provider,
    continuationIdentity: { driverKind: provider, continuationKey: "claudeAgent" },
    displayName: undefined,
    enabled: true,
    snapshot: {
      maintenanceCapabilities: { provider, packageName: null, update: null },
      getSnapshot: Effect.succeed({} as ServerProvider),
      refresh: Effect.succeed({} as ServerProvider),
      streamChanges: Stream.empty,
    },
    adapter,
    textGeneration: {} as TextGenerationShape,
  };
  const config = Layer.effect(
    ServerConfig,
    Effect.gen(function* () {
      const base = yield* ServerConfig;
      return { ...base, runnerThreadId: threadId, runnerCheckout: checkout };
    }),
  ).pipe(Layer.provide(ServerConfig.layerTest(checkout, NodePath.join(root, "runner"))));
  const runnerLayer = RunnerRpcHandlersLive.pipe(
    Layer.provideMerge(
      Layer.effect(
        RunnerOutbox,
        makeOutbox({ databasePath: NodePath.join(root, "runner", "outbox.sqlite") }),
      ),
    ),
    Layer.provideMerge(
      Layer.succeed(ProviderInstanceRegistry, {
        getInstance: (id) => Effect.succeed(id === instanceId ? instance : undefined),
        listInstances: Effect.succeed([instance]),
        listUnavailable: Effect.succeed([]),
        streamChanges: Stream.empty,
        subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), (pubsub) =>
          PubSub.subscribe(pubsub),
        ),
      }),
    ),
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.mock(RunnerCheckout.RunnerCheckout)({}),
        Layer.mock(CheckpointStore.CheckpointStore)({}),
        Layer.mock(WorkspaceEntries.WorkspaceEntries)({}),
        Layer.mock(WorkspaceFileSystem.WorkspaceFileSystem)({}),
        Layer.mock(GitWorkflowService.GitWorkflowService)({}),
        Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({}),
        Layer.mock(VcsProvisioningService.VcsProvisioningService)({}),
        Layer.mock(ReviewService.ReviewService)({}),
        Layer.mock(TerminalManager.TerminalManager)({}),
        ServerSettingsService.layerTest(),
      ),
    ),
    Layer.provideMerge(config),
    Layer.provideMerge(NodeServices.layer),
  );
  const runner = yield* serveRunner(runnerLayer);
  const fake = yield* makeFakeMachineDirectory({
    initial: [[threadId, { state: "running", runnerUrl: runner.url }]],
  });
  const pool = yield* makePool({ checkoutRoot: NodePath.join(root, "t") }).pipe(
    Effect.provideService(MachineDirectory, fake.directory),
  );
  const runnerConfig = yield* ServerConfig.pipe(
    Effect.provide(config.pipe(Layer.provide(NodeServices.layer))),
  );
  return { root, checkout, turns, mcpAtStart, pool, attachmentsDir: runnerConfig.attachmentsDir };
});

describe("runner handlers", () => {
  it.live("materializes shipped attachments and rewrites the prompt to the runner's paths", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { pool, turns, attachmentsDir } = yield* setup;
        const attachment = {
          type: "image" as const,
          id: `${threadId}-1f1f1f1f-0000-4000-8000-000000000000`,
          name: "screen.png",
          mimeType: "image/png",
          sizeBytes: 4,
        };
        const hubPath = `/hub/state/attachments/${attachment.id}.png`;
        yield* pool.use(threadId, { wake: false, operation: "test" }, (connection) =>
          connection.client["runner.provider.sendTurn"]({
            instanceId,
            input: {
              threadId,
              input: `Look at this\n\n[Attached image "screen.png" is saved at: ${hubPath}]`,
              attachments: [attachment],
            },
            attachments: [
              { attachment, hubPath, bytesBase64: Buffer.from([1, 2, 3, 4]).toString("base64") },
            ],
          }),
        );
        const runnerPath = resolveAttachmentPath({ attachmentsDir, attachment })!;
        expect(Array.from(NodeFS.readFileSync(runnerPath))).toEqual([1, 2, 3, 4]);
        expect(turns[0]?.input).toBe(
          `Look at this\n\n[Attached image "screen.png" is saved at: ${runnerPath}]`,
        );
        expect(turns[0]?.attachments).toEqual([attachment]);
      }),
    ),
  );

  it.live("installs the hub's MCP session before starting the provider session", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { pool, mcpAtStart } = yield* setup;
        const mcp = {
          environmentId: EnvironmentId.make("env-1"),
          threadId,
          providerSessionId: "provider-session-1",
          providerInstanceId: instanceId,
          endpoint: "https://hub.example/mcp",
          authorizationHeader: "Bearer mcp-token",
        };
        yield* pool.use(threadId, { wake: false, operation: "test" }, (connection) =>
          connection.client["runner.provider.startSession"]({
            instanceId,
            input: { threadId, provider, runtimeMode: "full-access" },
            mcp,
          }),
        );
        expect(mcpAtStart).toEqual([mcp]);
        McpProviderSession.clearMcpProviderSession(threadId);
      }),
    ),
  );

  it.live("refuses calls for another thread or outside the checkout with typed errors", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { pool, turns } = yield* setup;
        const otherThread = yield* pool
          .use(threadId, { wake: false, operation: "test" }, (connection) =>
            connection.client["runner.provider.sendTurn"]({
              instanceId,
              input: { threadId: ThreadId.make("someone-else"), input: "hi" },
              attachments: [],
            }),
          )
          .pipe(Effect.flip);
        expect(otherThread).toMatchObject({
          _tag: "RunnerRemoteError",
          errorTag: "ProviderAdapterValidationError",
        });
        const outside = yield* pool
          .use(threadId, { wake: false, operation: "test" }, (connection) =>
            connection.client["runner.checkpoint.hasRef"]({
              cwd: "/etc",
              checkpointRef: "refs/t3/checkpoints/x/turn/1" as never,
            }),
          )
          .pipe(Effect.flip);
        expect(outside).toMatchObject({ _tag: "VcsRepositoryDetectionError", cwd: "/etc" });
        expect(turns).toEqual([]);
      }),
    ),
  );
});
