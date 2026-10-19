import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderSendTurnInput,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { HttpServer } from "effect/unstable/http";
import * as NetAddress from "effect/unstable/net/NetAddress";

import * as EnvironmentAuth from "../src/auth/EnvironmentAuth.ts";
import * as ServiceLauncherClient from "../src/cloud/serviceLauncherClient.ts";
import * as ServerConfig from "../src/config.ts";
import * as ServerEnvironment from "../src/environment/ServerEnvironment.ts";
import * as Keybindings from "../src/keybindings.ts";
import { OrchestrationLayerLive } from "../src/orchestration/runtimeLayer.ts";
import * as OrchestrationEngine from "../src/orchestration/Services/OrchestrationEngine.ts";
import * as OrchestrationReactor from "../src/orchestration/Services/OrchestrationReactor.ts";
import * as ProjectionSnapshotQuery from "../src/orchestration/Services/ProjectionSnapshotQuery.ts";
import { makeSqlitePersistenceLive } from "../src/persistence/Layers/Sqlite.ts";
import * as ProviderSessionRuntime from "../src/persistence/ProviderSessionRuntime.ts";
import * as ExternalLauncher from "../src/process/externalLauncher.ts";
import { ProviderSessionDirectoryLive } from "../src/provider/Layers/ProviderSessionDirectory.ts";
import * as ProviderService from "../src/provider/Services/ProviderService.ts";
import * as ProviderSessionDirectory from "../src/provider/Services/ProviderSessionDirectory.ts";
import * as ProviderSessionReaper from "../src/provider/Services/ProviderSessionReaper.ts";
import * as RepositoryIdentityResolver from "../src/project/RepositoryIdentityResolver.ts";
import * as ServerLifecycleEvents from "../src/serverLifecycleEvents.ts";
import * as ServerRuntimeStartup from "../src/serverRuntimeStartup.ts";
import * as ServerSettings from "../src/serverSettings.ts";
import * as AnalyticsService from "../src/telemetry/AnalyticsService.ts";
import * as TurnLivenessWatchdog from "../src/orchestration/Services/TurnLivenessWatchdog.ts";
import * as GitVcsDriver from "../src/vcs/GitVcsDriver.ts";

const providerInstanceId = ProviderInstanceId.make("codex");
const projectId = ProjectId.make("project-startup-orphan");
const threadId = ThreadId.make("thread-startup-orphan");
const stoppedBindingThreadId = ThreadId.make("thread-startup-orphan-stopped-binding");
const resumeCursor = { schemaVersion: 1, sessionId: "provider-session-before-restart" };
const stoppedBindingResumeCursor = {
  schemaVersion: 1,
  sessionId: "provider-session-stopped-before-restart",
};

const makePersistedRuntimeLayer = (dbPath: string) => {
  const persistence = makeSqlitePersistenceLive(dbPath);
  const orchestration = OrchestrationLayerLive.pipe(
    Layer.provideMerge(RepositoryIdentityResolver.layer),
    Layer.provideMerge(persistence),
  );
  const directory = ProviderSessionDirectoryLive.pipe(
    Layer.provide(ProviderSessionRuntime.layer),
    Layer.provide(persistence),
  );
  return Layer.mergeAll(orchestration, directory);
};

const startupDependenciesWith = (
  drainTurnStarts: Effect.Effect<void>,
  startWatchdog: Effect.Effect<void, never, Scope.Scope> = Effect.void,
) =>
  Layer.mergeAll(
    Layer.mock(Keybindings.Keybindings)({
      start: Effect.void,
    }),
    ServerSettings.layerTest(),
    Layer.succeed(OrchestrationReactor.OrchestrationReactor, {
      start: () => Effect.void,
      drainTurnStarts,
    }),
    Layer.succeed(ProviderSessionReaper.ProviderSessionReaper, {
      start: () => Effect.void,
    }),
    ServerLifecycleEvents.layer,
    Layer.succeed(ServerEnvironment.ServerEnvironment, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("environment-startup-orphan")),
      getDescriptor: Effect.succeed({
        environmentId: EnvironmentId.make("environment-startup-orphan"),
        label: "Startup orphan test",
        version: "test",
        platform: { os: "linux", arch: "x64" },
        capabilities: {},
      } as never),
    }),
    Layer.mock(EnvironmentAuth.EnvironmentAuth)({
      issueStartupPairingUrl: (baseUrl: string) => Effect.succeed(`${baseUrl}/pair`),
    }),
    Layer.mock(ExternalLauncher.ExternalLauncher)({
      launchBrowser: () => Effect.void,
    }),
    Layer.succeed(ServiceLauncherClient.ServiceLauncherClient, {
      managed: false,
      requestUpdate: () => Effect.die("unused"),
      prepareTrial: Effect.undefined,
    }),
    Layer.succeed(
      HttpServer.HttpServer,
      HttpServer.HttpServer.of({
        address: NetAddress.inetAddressFromIpStringUnsafe("127.0.0.1", 3773),
        serve: (() => Effect.void) as HttpServer.HttpServer["Service"]["serve"],
      }),
    ),
    AnalyticsService.layerTest,
    Layer.succeed(TurnLivenessWatchdog.TurnLivenessWatchdog, { start: () => startWatchdog }),
    Layer.mock(GitVcsDriver.GitVcsDriver)({}),
    Layer.succeed(ProviderService.ProviderService, {
      startSession: () => Effect.die("unused"),
      sendTurn: () => Effect.die("unused"),
      compactThread: () => Effect.die("unused"),
      interruptTurn: () => Effect.die("unused"),
      respondToRequest: () => Effect.die("unused"),
      respondToUserInput: () => Effect.die("unused"),
      stopSession: () => Effect.die("unused"),
      listSessions: () => Effect.succeed([]),
      getCapabilities: () => Effect.die("unused"),
      assertConversationRollbackSupported: () => Effect.die("unused"),
      getInstanceInfo: () => Effect.die("unused"),
      rollbackConversation: () => Effect.die("unused"),
      uploadFeedback: () => Effect.die("unused"),
      streamEvents: Stream.empty,
    }),
  );
const startupDependencies = startupDependenciesWith(Effect.void);

it.effect(
  "recovers a persisted starting session before opening the command gate after restart",
  () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const firstRuntime = makePersistedRuntimeLayer(config.dbPath);
      const now = yield* DateTime.now;
      const createdAt = DateTime.formatIso(now);

      yield* Effect.gen(function* () {
        const engine = yield* OrchestrationEngine.OrchestrationEngineService;
        const directory = yield* ProviderSessionDirectory.ProviderSessionDirectory;

        yield* engine.dispatch({
          type: "project.create",
          commandId: CommandId.make("command-create-project"),
          projectId,
          title: "Startup orphan project",
          workspaceRoot: "/tmp/startup-orphan-project",
          defaultModelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
          createdAt,
        });
        yield* engine.dispatch({
          type: "thread.create",
          commandId: CommandId.make("command-create-thread"),
          threadId,
          projectId,
          title: "Startup orphan thread",
          modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
        });
        yield* engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make("command-start-pending-turn"),
          threadId,
          message: {
            messageId: MessageId.make("message-pending-before-restart"),
            role: "user",
            text: "Persist this queued turn before restart",
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          createdAt,
        });
        yield* engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("command-mark-session-starting"),
          threadId,
          session: {
            threadId,
            status: "starting",
            providerName: "codex",
            providerInstanceId,
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: createdAt,
          },
          createdAt,
        });
        yield* directory.upsert({
          threadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId,
          status: "running",
          resumeCursor,
          runtimePayload: { activeTurnId: null, unrelated: "preserve-me" },
          runtimeMode: "full-access",
        });
        yield* engine.dispatch({
          type: "thread.create",
          commandId: CommandId.make("command-create-stopped-binding-thread"),
          threadId: stoppedBindingThreadId,
          projectId,
          title: "Startup orphan with stopped binding",
          modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
        });
        yield* engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make("command-start-stopped-binding-pending-turn"),
          threadId: stoppedBindingThreadId,
          message: {
            messageId: MessageId.make("message-stopped-binding-pending-before-restart"),
            role: "user",
            text: "Persist another queued turn before restart",
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          createdAt,
        });
        yield* engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("command-mark-stopped-binding-session-starting"),
          threadId: stoppedBindingThreadId,
          session: {
            threadId: stoppedBindingThreadId,
            status: "starting",
            providerName: "codex",
            providerInstanceId,
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: createdAt,
          },
          createdAt,
        });
        yield* directory.upsert({
          threadId: stoppedBindingThreadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId,
          status: "stopped",
          resumeCursor: stoppedBindingResumeCursor,
          runtimePayload: { activeTurnId: "stale", unrelated: "also-preserve-me" },
          runtimeMode: "full-access",
        });
      }).pipe(Effect.provide(firstRuntime));

      const secondRuntime = makePersistedRuntimeLayer(config.dbPath);
      const startupLayer = ServerRuntimeStartup.layer.pipe(
        Layer.provideMerge(secondRuntime),
        Layer.provideMerge(startupDependencies),
      );

      const result = yield* Effect.gen(function* () {
        const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
        const engine = yield* OrchestrationEngine.OrchestrationEngineService;
        const query = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
        const directory = yield* ProviderSessionDirectory.ProviderSessionDirectory;
        const sql = yield* SqlClient.SqlClient;

        yield* startup.markHttpListening;
        yield* startup.awaitCommandReady;

        const restartedThread = Option.getOrThrow(yield* query.getThreadDetailById(threadId));
        const restartedStoppedBindingThread = Option.getOrThrow(
          yield* query.getThreadDetailById(stoppedBindingThreadId),
        );
        const pendingRows = yield* sql<{ readonly threadId: string }>`
          SELECT thread_id AS "threadId"
          FROM projection_turns
          WHERE thread_id IN (${threadId}, ${stoppedBindingThreadId})
            AND turn_id IS NULL
            AND state = 'pending'
        `;
        const settleExit = yield* Effect.exit(
          engine.dispatch({
            type: "thread.settle",
            commandId: CommandId.make("command-settle-after-restart"),
            threadId,
          }),
        );
        const snoozeExit = yield* Effect.exit(
          engine.dispatch({
            type: "thread.snooze",
            commandId: CommandId.make("command-snooze-after-restart"),
            threadId,
            snoozedUntil: DateTime.formatIso(DateTime.add(now, { hours: 1 })),
          }),
        );
        const newTurnExit = yield* Effect.exit(
          engine.dispatch({
            type: "thread.turn.start",
            commandId: CommandId.make("command-new-turn-after-restart"),
            threadId,
            message: {
              messageId: MessageId.make("message-new-turn-after-restart"),
              role: "user",
              text: "Continue immediately after restart",
              attachments: [],
            },
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            runtimeMode: "full-access",
            createdAt,
          }),
        );
        const binding = Option.getOrThrow(yield* directory.getBinding(threadId));
        const stoppedBinding = Option.getOrThrow(
          yield* directory.getBinding(stoppedBindingThreadId),
        );

        return {
          sessionStatus: restartedThread.session?.status,
          activeTurnId: restartedThread.session?.activeTurnId,
          latestTurn: restartedThread.latestTurn,
          pendingTurnCount: pendingRows.length,
          settleSucceeded: Exit.isSuccess(settleExit),
          snoozeSucceeded: Exit.isSuccess(snoozeExit),
          newTurnSucceeded: Exit.isSuccess(newTurnExit),
          bindingStatus: binding.status,
          resumeCursor: binding.resumeCursor,
          runtimePayload: binding.runtimePayload,
          stoppedBindingSessionStatus: restartedStoppedBindingThread.session?.status,
          stoppedBindingStatus: stoppedBinding.status,
          stoppedBindingResumeCursor: stoppedBinding.resumeCursor,
          stoppedBindingRuntimePayload: stoppedBinding.runtimePayload,
        };
      }).pipe(Effect.provide(startupLayer));

      assert.deepStrictEqual(result, {
        sessionStatus: "error",
        activeTurnId: null,
        latestTurn: null,
        pendingTurnCount: 0,
        settleSucceeded: true,
        snoozeSucceeded: true,
        newTurnSucceeded: true,
        bindingStatus: "stopped",
        resumeCursor,
        runtimePayload: { activeTurnId: null, unrelated: "preserve-me" },
        stoppedBindingSessionStatus: "error",
        stoppedBindingStatus: "stopped",
        stoppedBindingResumeCursor,
        stoppedBindingRuntimePayload: {
          activeTurnId: null,
          unrelated: "also-preserve-me",
        },
      });
    }).pipe(
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3-orphaned-provider-session-startup-",
        }).pipe(Layer.provideMerge(NodeServices.layer)),
      ),
    ),
);

it.effect.each(["opt-in desktop restart", "marked remote update"] as const)(
  "continues a newer persisted turn after %s",
  (restart) =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      const activeTurnId = TurnId.make("turn-started-after-original-send");
      const originalTurnId = TurnId.make("turn-from-original-send");
      const sent = yield* Deferred.make<ProviderSendTurnInput>();

      yield* Effect.gen(function* () {
        const engine = yield* OrchestrationEngine.OrchestrationEngineService;
        const directory = yield* ProviderSessionDirectory.ProviderSessionDirectory;
        yield* engine.dispatch({
          type: "project.create",
          commandId: CommandId.make("create-restart-project"),
          projectId,
          title: "Restart continuation",
          workspaceRoot: "/tmp/startup-orphan-project",
          defaultModelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
          createdAt,
        });
        yield* engine.dispatch({
          type: "thread.create",
          commandId: CommandId.make("create-restart-thread"),
          threadId,
          projectId,
          title: "Newer running turn",
          modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
        });
        yield* engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("persist-newer-running-turn"),
          threadId,
          session: {
            threadId,
            status: "running",
            providerName: "codex",
            providerInstanceId,
            runtimeMode: "full-access",
            activeTurnId,
            lastError: null,
            updatedAt: createdAt,
          },
          createdAt,
        });
        yield* directory.upsert({
          threadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId,
          status: "running",
          resumeCursor,
          runtimePayload: { activeTurnId: originalTurnId },
        });
        if (restart === "marked remote update") {
          assert.deepStrictEqual(
            yield* ServerRuntimeStartup.markRunningProviderSessionsForContinuation,
            [threadId],
          );
        }
      }).pipe(Effect.provide(makePersistedRuntimeLayer(config.dbPath)));

      yield* Effect.gen(function* () {
        const query = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
        const directory = yield* ProviderSessionDirectory.ProviderSessionDirectory;
        const provider = yield* ProviderService.ProviderService;
        const before = Option.getOrThrow(yield* query.getThreadDetailById(threadId));
        assert.equal(before.session?.activeTurnId, activeTurnId);
        assert.propertyVal(
          Option.getOrThrow(yield* directory.getBinding(threadId)).runtimePayload,
          "activeTurnId",
          originalTurnId,
        );
        yield* ServerRuntimeStartup.reconcileProviderSessions.pipe(
          Effect.provideService(ProviderService.ProviderService, {
            ...provider,
            getCapabilities: () =>
              Effect.succeed({
                sessionModelSwitch: "in-session",
                promptlessTurnContinuation: true,
              }),
            sendTurn: (input) =>
              Deferred.succeed(sent, input).pipe(
                Effect.as({ threadId, turnId: TurnId.make("continued-turn") }),
              ),
          }),
          Effect.provide(
            ServerSettings.layerTest({
              continueThreadsAfterServerUpdate: restart === "opt-in desktop restart",
            }),
          ),
        );
        const after = Option.getOrThrow(yield* query.getThreadDetailById(threadId));
        assert.equal(after.session?.status, "starting");
        assert.equal(after.session?.activeTurnId, null);
        assert.equal(after.session?.lastError, null);
        assert.deepStrictEqual(yield* Deferred.await(sent), {
          threadId,
          continuation: true,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        });
      }).pipe(
        Effect.provide(
          Layer.mergeAll(makePersistedRuntimeLayer(config.dbPath), startupDependencies),
        ),
      );
    }).pipe(
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), { prefix: "t3-restart-newer-turn-" }).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
);

const drainingConfig = (shutdownDrainMs: number | undefined) =>
  Layer.effect(
    ServerConfig.ServerConfig,
    Effect.map(ServerConfig.ServerConfig, (config) => ({ ...config, shutdownDrainMs })),
  ).pipe(
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-shutdown-drain-" })),
    Layer.provideMerge(NodeServices.layer),
  );

const startedRuntime = (
  dbPath: string,
  drainTurnStarts: Effect.Effect<void>,
  startWatchdog?: Effect.Effect<void, never, Scope.Scope>,
) =>
  ServerRuntimeStartup.layer.pipe(
    Layer.provideMerge(makePersistedRuntimeLayer(dbPath)),
    Layer.provideMerge(startupDependenciesWith(drainTurnStarts, startWatchdog)),
  );

const notDoneWithin = <A>(fiber: Fiber.Fiber<A>, ms: number) =>
  Fiber.join(fiber).pipe(Effect.timeoutOption(ms), Effect.map(Option.isNone));

it.live("a stop refuses commands, then waits for the ones admitted and their turn starts", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const reactorDrains = yield* Ref.make(0);
    const turnStartsSent = yield* Deferred.make<void>();
    const watchdogRunning = yield* Ref.make(false);
    // The watchdog's automatic retries start turns too, so it has ended by then.
    const drainTurnStarts = Effect.gen(function* () {
      assert.isFalse(yield* Ref.get(watchdogRunning));
      yield* Ref.update(reactorDrains, (count) => count + 1);
      yield* Deferred.await(turnStartsSent);
    });
    const startWatchdog = Ref.set(watchdogRunning, true).pipe(
      Effect.andThen(Effect.never),
      Effect.onInterrupt(() => Ref.set(watchdogRunning, false)),
      Effect.forkScoped,
      Effect.asVoid,
    );
    yield* Effect.gen(function* () {
      const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
      yield* startup.markHttpListening;
      yield* startup.awaitCommandReady;
      const finishCommand = yield* Deferred.make<void>();
      const admitted = yield* startup
        .enqueueCommand(Deferred.await(finishCommand))
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      assert.isTrue(yield* Ref.get(watchdogRunning));

      const drain = yield* Effect.forkChild(startup.drainForShutdown);
      assert.isTrue(yield* notDoneWithin(drain, 300));
      assert.isFalse(yield* Ref.get(watchdogRunning));
      const refused = yield* Effect.flip(startup.enqueueCommand(Effect.succeed("late")));
      assert.instanceOf(refused, ServerRuntimeStartup.ServerStoppingError);
      // The reactor's drain runs through the events the admitted commands
      // commit, so it starts once they are done.
      assert.strictEqual(yield* Ref.get(reactorDrains), 0);

      yield* Deferred.succeed(finishCommand, undefined);
      yield* Fiber.join(admitted);
      assert.isTrue(yield* notDoneWithin(drain, 300));
      assert.strictEqual(yield* Ref.get(reactorDrains), 1);

      // Their turn starts reached their providers.
      yield* Deferred.succeed(turnStartsSent, undefined);
      assert.isFalse(yield* notDoneWithin(drain, 1_000));
    }).pipe(Effect.provide(startedRuntime(config.dbPath, drainTurnStarts, startWatchdog)));
  }).pipe(Effect.provide(drainingConfig(10_000))),
);

it.live.each([
  { shutdownDrainMs: 300, waits: true },
  { shutdownDrainMs: undefined, waits: false },
])(
  "a stop gives up on a turn start after shutdownDrainMs ($shutdownDrainMs)",
  ({ shutdownDrainMs, waits }) =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      yield* Effect.gen(function* () {
        const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
        yield* startup.markHttpListening;
        yield* startup.awaitCommandReady;

        const startedAt = yield* Clock.currentTimeMillis;
        yield* startup.drainForShutdown;
        const waitedMs = (yield* Clock.currentTimeMillis) - startedAt;
        assert.isTrue(waits ? waitedMs >= 250 && waitedMs < 2_000 : waitedMs < 250, `${waitedMs}`);
        const refused = yield* Effect.flip(startup.enqueueCommand(Effect.succeed("late")));
        assert.instanceOf(refused, ServerRuntimeStartup.ServerStoppingError);
      }).pipe(Effect.provide(startedRuntime(config.dbPath, Effect.never)));
    }).pipe(Effect.provide(drainingConfig(shutdownDrainMs))),
);

it.live("a stop before startup finished waits for nothing", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    yield* Effect.gen(function* () {
      const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
      // The server never listens, so it never takes commands.
      const startedAt = yield* Clock.currentTimeMillis;
      yield* startup.drainForShutdown;
      const waitedMs = (yield* Clock.currentTimeMillis) - startedAt;
      assert.isTrue(waitedMs < 250, `${waitedMs}`);
    }).pipe(Effect.provide(startedRuntime(config.dbPath, Effect.never)));
  }).pipe(Effect.provide(drainingConfig(10_000))),
);
