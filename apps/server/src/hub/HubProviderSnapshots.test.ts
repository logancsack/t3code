import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { describe, expect } from "vite-plus/test";

import { ServerConfig } from "../config.ts";
import { HubThreadMachineStateSqliteLive } from "../persistence/Layers/HubThreadMachineState.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ProviderSessionRuntime from "../persistence/ProviderSessionRuntime.ts";
import { ClaudeDriver } from "../provider/Drivers/ClaudeDriver.ts";
import { CodexDriver } from "../provider/Drivers/CodexDriver.ts";
import * as HubProviderSnapshots from "./HubProviderSnapshots.ts";
import { MachineDirectory, makeFakeMachineDirectory } from "./MachineDirectory.ts";
import { makeRemoteProviderDriver } from "./RemoteProviderDriver.ts";
import * as RemoteSessionRegistry from "./RemoteSessionRegistry.ts";
import { make as makePool, RunnerConnectionPool } from "./RunnerConnectionPool.ts";
import * as RunnerEventDelivery from "./RunnerEventDelivery.ts";
import { fakeRunner, fakeRunnerHello, serveRunner } from "./testUtils/runnerServer.ts";

const claude = ProviderDriverKind.make("claudeAgent");
const codex = ProviderDriverKind.make("codex");
const claudeInstance = ProviderInstanceId.make("claudeAgent");
const threadId = ThreadId.make("thread-provider-snapshots");

const identity = (driverKind: ProviderDriverKind, enabled = true) => ({
  driverKind,
  instanceId: ProviderInstanceId.make(driverKind),
  displayName: undefined,
  accentColor: undefined,
  enabled,
  continuationGroupKey: `${driverKind}:group`,
});

const StoresLive = Layer.mergeAll(
  HubThreadMachineStateSqliteLive,
  ProviderSessionRuntime.layer,
).pipe(Layer.provideMerge(SqlitePersistenceMemory), Layer.provideMerge(NodeServices.layer));

const reported = (auth: ServerProvider["auth"]["status"]): ServerProvider => ({
  instanceId: claudeInstance,
  driver: claude,
  displayName: "Claude",
  enabled: true,
  installed: true,
  version: "2.1.220",
  status: "ready",
  auth: { status: auth },
  checkedAt: "2026-09-26T00:00:00.000Z",
  models: [{ slug: "claude-sonnet-5", name: "Sonnet 5", isCustom: false, capabilities: null }],
  slashCommands: [],
  skills: [],
  versionAdvisory: {
    status: "behind_latest",
    currentVersion: "2.1.220",
    latestVersion: "2.2.0",
    updateCommand: null,
    canUpdate: true,
    checkedAt: "2026-09-26T00:00:00.000Z",
    message: null,
  },
});

describe("hub provider snapshots", () => {
  it.effect("stands in with selectable pending snapshots before any runner reports", () =>
    Effect.gen(function* () {
      const pendingClaude = yield* HubProviderSnapshots.pendingRemoteSnapshot(
        identity(claude),
        ClaudeDriver.defaultConfig(),
      );
      expect(pendingClaude).toMatchObject({
        instanceId: "claudeAgent",
        driver: "claudeAgent",
        enabled: true,
        installed: true,
        status: "ready",
        auth: { status: "unknown" },
        availability: "available",
      });
      expect(pendingClaude.models.length).toBeGreaterThan(0);

      const pendingCodex = yield* HubProviderSnapshots.pendingRemoteSnapshot(
        identity(codex),
        CodexDriver.defaultConfig(),
      );
      expect(pendingCodex.status).toBe("ready");
      expect(pendingCodex.models.some((model) => !model.isCustom && model.isDefault)).toBe(true);

      const disabled = yield* HubProviderSnapshots.pendingRemoteSnapshot(
        identity(codex, false),
        CodexDriver.defaultConfig(),
      );
      expect(disabled).toMatchObject({ enabled: false, status: "disabled" });
    }),
  );

  it.live("persists what a runner reports and serves it after a restart", () =>
    Effect.gen(function* () {
      const runner = yield* serveRunner(
        fakeRunner({
          "runner.hello": (input) =>
            Effect.succeed(
              fakeRunnerHello({ threadId: input.threadId, instances: [claudeInstance] }),
            ),
          "runner.provider.getCapabilities": () =>
            Effect.succeed({
              snapshot: reported("authenticated"),
              sessionModelSwitch: "in-session",
            }),
        }),
      );
      const fake = yield* makeFakeMachineDirectory({
        onWake: () => ({ state: "running", runnerUrl: runner.url }),
      });
      const snapshots = yield* HubProviderSnapshots.make;
      const pool = yield* makePool({
        wakePollInterval: "5 millis",
        idleCheckInterval: "1 hour",
      }).pipe(Effect.provideService(MachineDirectory, fake.directory));
      const registry = yield* RemoteSessionRegistry.make;
      const delivery = yield* RunnerEventDelivery.make.pipe(
        Effect.provideService(RunnerConnectionPool, pool),
        Effect.provideService(RemoteSessionRegistry.RemoteSessionRegistry, registry),
      );
      const instance = yield* makeRemoteProviderDriver(ClaudeDriver)
        .create({
          instanceId: claudeInstance,
          displayName: "Claude (work)",
          environment: [],
          enabled: true,
          config: ClaudeDriver.defaultConfig(),
        })
        .pipe(
          Effect.provideService(RunnerConnectionPool, pool),
          Effect.provideService(RunnerEventDelivery.RunnerEventDelivery, delivery),
          Effect.provideService(RemoteSessionRegistry.RemoteSessionRegistry, registry),
          Effect.provideService(HubProviderSnapshots.HubProviderSnapshots, snapshots),
          Effect.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-hub-snapshots-" })),
        );
      expect((yield* instance.snapshot.getSnapshot).auth.status).toBe("unknown");

      // Connecting to a runner reports the instance.
      yield* pool.use(threadId, { wake: true, operation: "test" }, () => Effect.void);
      yield* Effect.repeat(instance.snapshot.getSnapshot, {
        until: (snapshot) => snapshot.auth.status === "authenticated",
      }).pipe(Effect.timeout("5 seconds"));
      const live = yield* instance.snapshot.getSnapshot;
      expect(live).toMatchObject({ displayName: "Claude (work)", version: "2.1.220" });
      expect(live.versionAdvisory).toBeUndefined();

      // A restarted hub starts from the persisted report.
      const restarted = yield* HubProviderSnapshots.make;
      const persisted = yield* restarted.get(claudeInstance);
      expect(Option.getOrThrow(persisted).auth.status).toBe("authenticated");
    }).pipe(Effect.scoped, Effect.provide(StoresLive)),
  );
});
