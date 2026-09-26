// @effect-diagnostics nodeBuiltinImport:off
/**
 * A hub and a runner in one process, talking the real runner protocol over a
 * loopback WebSocket.
 *
 * Runner: the production `RunnerRpcHandlersLive` and event pump, a real
 * SQLite outbox, real git checkpoints and checkout preparation in
 * `<root>/t/<threadId>`, hosting the scripted `TestProviderAdapter`.
 *
 * Hub: the orchestration engine, `ProviderService` and reactors on SQLite, or
 * on Postgres through the production hub database when
 * T3_HUB_TEST_DATABASE_URL is set, with the hub layer set for everything
 * checkout-bound: the remote provider
 * driver, routed checkpoint store with the diff cache, git status cache,
 * workspace routing, reactor hooks, event delivery and its ack loop, and a
 * fake machine directory pointing at the runner.
 *
 * Either side can be restarted: the runner with a new boot (optionally a
 * fresh provider adapter that lost its sessions), and the hub on the same
 * database.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ApprovalRequestId,
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  ThreadId,
  type OrchestrationThread,
  type ProviderApprovalDecision,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  type ClientOrchestrationCommand,
  OrchestrationDispatchCommandError,
} from "@t3tools/contracts";
import { threadCheckoutPath } from "@t3tools/contracts/runner";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as CheckpointStore from "../src/checkpointing/CheckpointStore.ts";
import { ServerConfig } from "../src/config.ts";
import * as GitWorkflowService from "../src/git/GitWorkflowService.ts";
import * as HubLayers from "../src/hub/HubLayers.ts";
import { hubVcsStatusCacheLayer } from "../src/hub/HubVcs.ts";
import { MachineDirectory, makeFakeMachineDirectory } from "../src/hub/MachineDirectory.ts";
import { makeRemoteProviderDriver } from "../src/hub/RemoteProviderDriver.ts";
import * as RemoteSessionRegistry from "../src/hub/RemoteSessionRegistry.ts";
import { make as makePool, RunnerConnectionPool } from "../src/hub/RunnerConnectionPool.ts";
import * as RunnerEventDelivery from "../src/hub/RunnerEventDelivery.ts";
import * as ThreadMachineStates from "../src/hub/ThreadMachineStates.ts";
import * as HubProviderSnapshots from "../src/hub/HubProviderSnapshots.ts";
import { serveRunner } from "../src/hub/testUtils/runnerServer.ts";
import { makeOrchestrationCommandDispatcher } from "../src/orchestration/CommandDispatcher.ts";
import { normalizeDispatchCommand } from "../src/orchestration/Normalizer.ts";
import { CheckpointReactorLive } from "../src/orchestration/Layers/CheckpointReactor.ts";
import { OrchestrationEngineLive } from "../src/orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationReactorLive } from "../src/orchestration/Layers/OrchestrationReactor.ts";
import { OrchestrationProjectionPipelineLive } from "../src/orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../src/orchestration/Layers/ProjectionSnapshotQuery.ts";
import { ProviderCommandReactorLive } from "../src/orchestration/Layers/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionLive } from "../src/orchestration/Layers/ProviderRuntimeIngestion.ts";
import { RuntimeReceiptBusTest } from "../src/orchestration/Layers/RuntimeReceiptBus.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../src/orchestration/Services/OrchestrationEngine.ts";
import { OrchestrationReactor } from "../src/orchestration/Services/OrchestrationReactor.ts";
import { ProjectionSnapshotQuery } from "../src/orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadDeletionReactor } from "../src/orchestration/Services/ThreadDeletionReactor.ts";
import * as ThreadBackgroundLiveness from "../src/orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../src/orchestration/ThreadPlanProgress.ts";
import * as ThreadSettlementReactor from "../src/orchestration/ThreadSettlementReactor.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../src/persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../src/persistence/Layers/OrchestrationEventStore.ts";
import { ProjectionCheckpointRepositoryLive } from "../src/persistence/Layers/ProjectionCheckpoints.ts";
import { ProjectionPendingApprovalRepositoryLive } from "../src/persistence/Layers/ProjectionPendingApprovals.ts";
import { layerConfig as ServerPersistenceLive } from "../src/persistence/Layers/Sqlite.ts";
import * as HubRepositoryIdentityResolver from "../src/persistence/Postgres/HubRepositoryIdentityResolver.ts";
import {
  hubTestDatabaseLayer,
  hubTestDatabaseUrl,
  makeHubTestSchema,
} from "../src/persistence/Postgres/hubTestDatabase.ts";
import * as ProviderSessionRuntime from "../src/persistence/ProviderSessionRuntime.ts";
import { CheckpointTurnDiffStore } from "../src/persistence/Services/HubThreadMachineState.ts";
import { ProjectionPendingApprovalRepository } from "../src/persistence/Services/ProjectionPendingApprovals.ts";
import { CodexDriver } from "../src/provider/Drivers/CodexDriver.ts";
import {
  NoOpProviderEventLoggers,
  ProviderEventLoggers,
} from "../src/provider/Layers/ProviderEventLoggers.ts";
import { makeProviderServiceLive } from "../src/provider/Layers/ProviderService.ts";
import { ProviderSessionDirectoryLive } from "../src/provider/Layers/ProviderSessionDirectory.ts";
import type { ProviderInstance } from "../src/provider/ProviderDriver.ts";
import { ProviderAdapterRegistry } from "../src/provider/Services/ProviderAdapterRegistry.ts";
import { ProviderInstanceRegistry } from "../src/provider/Services/ProviderInstanceRegistry.ts";
import { makeAdapterRegistryMock } from "../src/provider/testUtils/providerAdapterRegistryMock.ts";
import { makeProviderRegistryLayer } from "../src/provider/testUtils/providerRegistryMock.ts";
import * as AgentAwarenessRelay from "../src/relay/AgentAwarenessRelay.ts";
import * as ProjectSetupScriptRunner from "../src/project/ProjectSetupScriptRunner.ts";
import * as ReviewService from "../src/review/ReviewService.ts";
import * as RunnerCheckout from "../src/runner/RunnerCheckout.ts";
import { RunnerRpcHandlersLive } from "../src/runner/RunnerHandlers.ts";
import {
  makeWithOptions as makeOutbox,
  RunnerOutbox,
  type RunnerOutboxShape,
} from "../src/runner/RunnerOutbox.ts";
import { RunnerEventPumpLive } from "../src/runner/RunnerServer.ts";
import { ServerRuntimeStartup } from "../src/serverRuntimeStartup.ts";
import { ServerSettingsService } from "../src/serverSettings.ts";
import { AnalyticsService } from "../src/telemetry/AnalyticsService.ts";
import * as TerminalManager from "../src/terminal/Manager.ts";
import { TextGeneration, type TextGenerationShape } from "../src/textGeneration/TextGeneration.ts";
import * as GitVcsDriver from "../src/vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../src/vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../src/vcs/VcsProcess.ts";
import * as VcsProvisioningService from "../src/vcs/VcsProvisioningService.ts";
import * as VcsStatusBroadcaster from "../src/vcs/VcsStatusBroadcaster.ts";
import * as WorkspaceEntries from "../src/workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../src/workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "../src/workspace/WorkspacePaths.ts";
import {
  makeTestProviderAdapterHarness,
  type TestProviderAdapterHarness,
} from "./TestProviderAdapter.integration.ts";

export const LOOPBACK_PROVIDER = ProviderDriverKind.make("codex");
const isDispatchError = Schema.is(OrchestrationDispatchCommandError);
export const LOOPBACK_INSTANCE_ID = defaultInstanceIdForDriver(LOOPBACK_PROVIDER);
const LOOPBACK_TENANT_ID = "user_loopback";

const git = (cwd: string, args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", ...args],
    { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
  );

const waitFor = <A, E>(
  read: Effect.Effect<A, E>,
  predicate: (value: A) => boolean,
  description: string,
  timeoutMs = 20_000,
): Effect.Effect<A> =>
  read.pipe(
    Effect.filterOrFail(predicate, () => "retry" as const),
    Effect.retry({
      schedule: Schedule.spaced("10 millis"),
      times: Math.floor(timeoutMs / 10),
      while: (error) => error === "retry",
    }),
    Effect.mapError((error) =>
      error === "retry" ? new Error(`timed out waiting for ${description}`) : error,
    ),
    Effect.orDie,
  );

const instanceRegistryLayer = (adapter: TestProviderAdapterHarness["adapter"]) => {
  const instance: ProviderInstance = {
    instanceId: LOOPBACK_INSTANCE_ID,
    driverKind: LOOPBACK_PROVIDER,
    continuationIdentity: {
      driverKind: LOOPBACK_PROVIDER,
      continuationKey: `${LOOPBACK_PROVIDER}:instance:${LOOPBACK_INSTANCE_ID}`,
    },
    displayName: undefined,
    enabled: true,
    snapshot: {
      maintenanceCapabilities: { provider: LOOPBACK_PROVIDER, packageName: null, update: null },
      getSnapshot: Effect.succeed({} as ServerProvider),
      refresh: Effect.succeed({} as ServerProvider),
      streamChanges: Stream.empty,
    },
    adapter,
    textGeneration: {} as TextGenerationShape,
  };
  return Layer.succeed(ProviderInstanceRegistry, {
    getInstance: (instanceId) =>
      Effect.succeed(instanceId === LOOPBACK_INSTANCE_ID ? instance : undefined),
    listInstances: Effect.succeed([instance]),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.empty,
    subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), (pubsub) =>
      PubSub.subscribe(pubsub),
    ),
  });
};

/**
 * A clean status on the branch actually checked out: the checkpoint reactor
 * adopts the reported branch after each turn, so a fixed one would race the
 * branch that bootstrap recorded.
 */
const localStatusOf = (checkout: string) => {
  const refName = git(checkout, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  return {
    isRepo: true,
    hasPrimaryRemote: false,
    isDefaultRef: refName === "main",
    refName,
    hasWorkingTreeChanges: false,
    workingTree: { files: [], insertions: 0, deletions: 0 },
  };
};

export interface LoopbackRunner {
  readonly url: string;
  readonly adapterHarness: TestProviderAdapterHarness;
  readonly outbox: RunnerOutboxShape;
}

export interface HubRunnerLoopbackHarness {
  readonly rootDir: string;
  readonly checkoutRoot: string;
  readonly checkout: string;
  readonly threadId: ThreadId;
  readonly runner: () => LoopbackRunner;
  /** Stops the runner process; with `freshAdapter` the next boot has lost every session. */
  readonly restartRunner: (options?: { readonly freshAdapter?: boolean }) => Effect.Effect<void>;
  readonly engine: () => OrchestrationEngineShape;
  readonly snapshotQuery: () => ProjectionSnapshotQuery["Service"];
  readonly checkpointStore: () => CheckpointStore.CheckpointStore["Service"];
  readonly diffStore: () => CheckpointTurnDiffStore["Service"];
  readonly delivery: () => RunnerEventDelivery.RunnerEventDelivery["Service"];
  /** Disposes the hub runtime and starts a new one on the same database. */
  readonly restartHub: Effect.Effect<void>;
  /** A client command through normalization and the command dispatcher (bootstrap included). */
  readonly dispatchClientCommand: (
    command: ClientOrchestrationCommand,
  ) => Effect.Effect<void, OrchestrationDispatchCommandError>;
  readonly waitForThread: (
    predicate: (thread: OrchestrationThread) => boolean,
    description: string,
  ) => Effect.Effect<OrchestrationThread>;
  readonly waitForPendingApproval: (
    requestId: string,
    predicate: (row: {
      readonly status: string;
      readonly decision: ProviderApprovalDecision | null;
    }) => boolean,
  ) => Effect.Effect<unknown>;
  readonly dispose: Effect.Effect<void>;
}

export const makeHubRunnerLoopbackHarness = (threadIdValue = "thread-loopback") =>
  Effect.gen(function* () {
    const threadId = ThreadId.make(threadIdValue);
    const rootDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-hub-runner-loopback-"));
    const checkoutRoot = NodePath.join(rootDir, "t");
    const checkout = threadCheckoutPath(threadId, checkoutRoot);
    NodeFS.mkdirSync(checkout, { recursive: true });
    git(checkout, ["init", "--initial-branch=main"]);
    NodeFS.writeFileSync(NodePath.join(checkout, "README.md"), "v1\n");
    git(checkout, ["add", "."]);
    git(checkout, ["commit", "-m", "Initial"]);

    // ── Runner ───────────────────────────────────────────────────────────
    const runnerStateDir = NodePath.join(rootDir, "runner");
    const runnerConfigLayer = Layer.effect(
      ServerConfig,
      Effect.gen(function* () {
        const base = yield* ServerConfig;
        return {
          ...base,
          cwd: checkout,
          serverMode: "runner" as const,
          runnerThreadId: threadId,
          runnerCheckout: checkout,
        };
      }),
    ).pipe(Layer.provide(ServerConfig.layerTest(checkout, runnerStateDir)));

    let runnerScope: Scope.Closeable | null = null;
    let runner: LoopbackRunner | null = null;

    const startRunner = (adapterHarness: TestProviderAdapterHarness) =>
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const outbox = yield* makeOutbox({
          databasePath: NodePath.join(runnerStateDir, "runner", "outbox.sqlite"),
        }).pipe(Scope.provide(scope));
        const runnerLayer = Layer.mergeAll(RunnerEventPumpLive, RunnerRpcHandlersLive).pipe(
          Layer.provideMerge(Layer.succeed(RunnerOutbox, outbox)),
          Layer.provideMerge(instanceRegistryLayer(adapterHarness.adapter)),
          Layer.provideMerge(
            Layer.mergeAll(
              RunnerCheckout.layer.pipe(Layer.provide(GitVcsDriver.layer)),
              CheckpointStore.layer.pipe(Layer.provide(VcsDriverRegistry.layer)),
              WorkspaceFileSystem.layer.pipe(
                Layer.provide(WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer))),
                Layer.provide(WorkspacePaths.layer),
              ),
              WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer)),
              Layer.mock(GitWorkflowService.GitWorkflowService)({}),
              Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({
                streamStatus: () => Stream.never,
                refreshLocalStatus: () => Effect.sync(() => localStatusOf(checkout)),
                refreshStatus: () =>
                  Effect.sync(() => ({
                    ...localStatusOf(checkout),
                    hasUpstream: false,
                    aheadCount: 0,
                    behindCount: 0,
                    pr: null,
                  })),
              }),
              Layer.mock(VcsProvisioningService.VcsProvisioningService)({}),
              Layer.mock(ReviewService.ReviewService)({}),
              Layer.mock(TerminalManager.TerminalManager)({
                subscribe: () => Effect.succeed(() => undefined),
                subscribeMetadata: (listener) =>
                  listener({ type: "snapshot", terminals: [] }).pipe(Effect.as(() => undefined)),
              }),
              ServerSettingsService.layerTest(),
            ),
          ),
          Layer.provideMerge(VcsDriverRegistry.layer),
          Layer.provideMerge(runnerConfigLayer),
          Layer.provideMerge(VcsProcess.layer),
          Layer.provideMerge(NodeServices.layer),
        );
        const served = yield* serveRunner(runnerLayer).pipe(Scope.provide(scope));
        runnerScope = scope;
        runner = { url: served.url, adapterHarness, outbox };
        return runner;
      });

    const firstRunner = yield* startRunner(
      yield* makeTestProviderAdapterHarness({ provider: LOOPBACK_PROVIDER }),
    );
    const directory = yield* makeFakeMachineDirectory({
      initial: [[threadId, { state: "running", runnerUrl: firstRunner.url, bootId: "boot" }]],
    });

    const restartRunner: HubRunnerLoopbackHarness["restartRunner"] = (options) =>
      Effect.gen(function* () {
        const previous = runner!;
        if (runnerScope) yield* Scope.close(runnerScope, Exit.void);
        const next = yield* startRunner(
          options?.freshAdapter
            ? yield* makeTestProviderAdapterHarness({ provider: LOOPBACK_PROVIDER })
            : previous.adapterHarness,
        );
        yield* directory.set(threadId, { state: "running", runnerUrl: next.url });
      }).pipe(Effect.orDie);

    // ── Hub ──────────────────────────────────────────────────────────────
    const hubBaseDir = NodePath.join(rootDir, "hub");
    // With T3_HUB_TEST_DATABASE_URL the hub persists to a disposable Postgres
    // schema through the production hub database (tenant client, migrations,
    // row-level security); otherwise to SQLite in its base directory. Either
    // way the database outlives hub restarts.
    const harnessScope = yield* Scope.make();
    const hubSchema =
      hubTestDatabaseUrl === undefined
        ? undefined
        : yield* makeHubTestSchema(hubTestDatabaseUrl).pipe(
            Scope.provide(harnessScope),
            Effect.orDie,
          );
    const hubDatabaseLayer =
      hubSchema === undefined ? Layer.empty : hubTestDatabaseLayer(hubSchema, LOOPBACK_TENANT_ID);
    const hubConfigLayer = Layer.effect(
      ServerConfig,
      Effect.gen(function* () {
        const base = yield* ServerConfig;
        return { ...base, serverMode: "hub" as const, hub: { checkoutRoot } };
      }),
    ).pipe(Layer.provide(ServerConfig.layerTest(rootDir, hubBaseDir)));

    const makeHubLayer = () => {
      const persistence = ServerPersistenceLive;
      const infrastructure = Layer.mergeAll(RunnerEventDelivery.layer, hubVcsStatusCacheLayer).pipe(
        Layer.provideMerge(
          RemoteSessionRegistry.layer.pipe(Layer.provide(ProviderSessionRuntime.layer)),
        ),
        Layer.provideMerge(
          Layer.effect(
            RunnerConnectionPool,
            makePool({ checkoutRoot, wakePollInterval: "5 millis", idleCheckInterval: "1 hour" }),
          ),
        ),
        Layer.provideMerge(
          ThreadMachineStates.observedMachineDirectoryLayer.pipe(
            Layer.provide(Layer.succeed(MachineDirectory, directory.directory)),
          ),
        ),
        Layer.provideMerge(ThreadMachineStates.readerLayer),
        Layer.provideMerge(Layer.mergeAll(ThreadMachineStates.layer, HubProviderSnapshots.layer)),
        Layer.provideMerge(HubLayers.makeHubStateStoresLayer(persistence)),
      );
      const remoteAdapterRegistry = Layer.effect(
        ProviderAdapterRegistry,
        Effect.gen(function* () {
          const instance = yield* makeRemoteProviderDriver(CodexDriver).create({
            instanceId: LOOPBACK_INSTANCE_ID,
            displayName: undefined,
            environment: [],
            enabled: true,
            config: CodexDriver.defaultConfig(),
          });
          return makeAdapterRegistryMock({ [LOOPBACK_PROVIDER]: instance.adapter });
        }),
      );
      const providerLayer = makeProviderServiceLive().pipe(
        Layer.provide(
          ProviderSessionDirectoryLive.pipe(Layer.provide(ProviderSessionRuntime.layer)),
        ),
        Layer.provide(remoteAdapterRegistry),
        Layer.provide(AnalyticsService.layerTest),
        Layer.provide(Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers)),
      );
      const projectionSnapshotQueryLayer = OrchestrationProjectionSnapshotQueryLive;
      const runtimeServices = Layer.mergeAll(
        projectionSnapshotQueryLayer,
        OrchestrationEngineLive.pipe(
          Layer.provide(OrchestrationProjectionPipelineLive),
          Layer.provide(OrchestrationEventStoreLive),
          Layer.provide(OrchestrationCommandReceiptRepositoryLive),
          Layer.provide(projectionSnapshotQueryLayer),
        ),
        ProjectionCheckpointRepositoryLive,
        ProjectionPendingApprovalRepositoryLive,
        OrchestrationCommandReceiptRepositoryLive,
        HubLayers.hubCheckpointStoreLayer,
        providerLayer,
        RuntimeReceiptBusTest,
      ).pipe(
        Layer.provideMerge(ThreadBackgroundLiveness.layer),
        Layer.provideMerge(ThreadPlanProgress.layer),
      );
      const checkoutServices = Layer.mergeAll(
        HubLayers.hubWorkspacePathsLayer,
        HubLayers.hubVcsStatusBroadcasterLayer,
        HubLayers.hubWorkspaceEntriesLayer,
        HubLayers.hubGitWorkflowServiceLayer,
        Layer.succeed(TextGeneration, {
          generateBranchName: () => Effect.succeed({ branch: "update" }),
          generateThreadTitle: () => Effect.succeed({ title: "New thread" }),
        } as unknown as TextGenerationShape),
        HubLayers.hubReactorHooksLayer,
      );
      const reactors = OrchestrationReactorLive.pipe(
        Layer.provideMerge(ProviderRuntimeIngestionLive),
        Layer.provideMerge(ProviderCommandReactorLive),
        Layer.provideMerge(CheckpointReactorLive),
        Layer.provideMerge(
          Layer.succeed(ThreadDeletionReactor, {
            start: () => Effect.void,
            drainThrough: () => Effect.void,
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(ThreadSettlementReactor.ThreadSettlementReactor, {
            start: () => Effect.void,
            drain: Effect.void,
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(AgentAwarenessRelay.AgentAwarenessRelay, {
            publishThread: () => Effect.void,
            start: () => Effect.void,
          }),
        ),
      );
      return HubLayers.hubRuntimeBackgroundLayer.pipe(
        Layer.provideMerge(reactors),
        Layer.provideMerge(checkoutServices),
        Layer.provideMerge(runtimeServices),
        Layer.provideMerge(makeProviderRegistryLayer()),
        Layer.provideMerge(HubRepositoryIdentityResolver.layer),
        Layer.provideMerge(infrastructure),
        Layer.provideMerge(persistence),
        Layer.provideMerge(ServerSettingsService.layerTest()),
        Layer.provideMerge(hubConfigLayer),
        Layer.provideMerge(hubDatabaseLayer),
        Layer.provideMerge(NodeServices.layer),
      );
    };

    interface HubInstance {
      readonly runtime: ManagedRuntime.ManagedRuntime<any, any>;
      readonly scope: Scope.Closeable;
      readonly engine: OrchestrationEngineShape;
      readonly snapshotQuery: ProjectionSnapshotQuery["Service"];
      readonly checkpointStore: CheckpointStore.CheckpointStore["Service"];
      readonly diffStore: CheckpointTurnDiffStore["Service"];
      readonly delivery: RunnerEventDelivery.RunnerEventDelivery["Service"];
      readonly approvals: ProjectionPendingApprovalRepository["Service"];
      readonly dispatchClientCommand: HubRunnerLoopbackHarness["dispatchClientCommand"];
    }

    const startHub = Effect.gen(function* () {
      const runtime = ManagedRuntime.make(makeHubLayer());
      const services = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.all({
            engine: Effect.service(OrchestrationEngineService),
            snapshotQuery: Effect.service(ProjectionSnapshotQuery),
            checkpointStore: Effect.service(CheckpointStore.CheckpointStore),
            diffStore: Effect.service(CheckpointTurnDiffStore),
            delivery: Effect.service(RunnerEventDelivery.RunnerEventDelivery),
            approvals: Effect.service(ProjectionPendingApprovalRepository),
            reactor: Effect.service(OrchestrationReactor),
          }),
        ),
      );
      const { reactor, ...rest } = services;
      // The transport's dispatch path: startup is already ready, setup scripts
      // are covered elsewhere, and thread deletion needs no fence here.
      const dispatchStubs = Layer.mergeAll(
        Layer.succeed(ServerRuntimeStartup, {
          awaitCommandReady: Effect.void,
          markHttpListening: Effect.void,
          enqueueCommand: (effect) => effect,
        }),
        Layer.succeed(ProjectSetupScriptRunner.ProjectSetupScriptRunner, {
          runForThread: () => Effect.succeed({ status: "no-script" as const }),
        }),
        Layer.succeed(ThreadDeletionReactor, {
          start: () => Effect.void,
          drainThrough: () => Effect.void,
        }),
      );
      const dispatchClientCommand: HubRunnerLoopbackHarness["dispatchClientCommand"] = (command) =>
        Effect.tryPromise({
          try: () =>
            runtime.runPromise(
              Effect.gen(function* () {
                const dispatch = yield* makeOrchestrationCommandDispatcher;
                const normalized = yield* normalizeDispatchCommand(command);
                yield* dispatch(normalized);
              }).pipe(Effect.provide(dispatchStubs)),
            ),
          catch: (cause) =>
            isDispatchError(cause)
              ? cause
              : new OrchestrationDispatchCommandError({ message: String(cause), cause }),
        });
      const instance = {
        runtime,
        scope: yield* Scope.make("sequential"),
        ...rest,
        dispatchClientCommand,
      } satisfies HubInstance;
      yield* Effect.promise(() =>
        runtime.runPromise(reactor.start().pipe(Scope.provide(instance.scope))),
      );
      return instance;
    });

    const stopHub = (instance: HubInstance) =>
      Effect.gen(function* () {
        yield* Scope.close(instance.scope, Exit.void);
        yield* Effect.promise(() => instance.runtime.dispose());
      });

    let hub = yield* startHub;

    const waitForThread: HubRunnerLoopbackHarness["waitForThread"] = (predicate, description) =>
      waitFor(
        Effect.suspend(() => hub.snapshotQuery.getThreadDetailById(threadId)).pipe(
          Effect.map(Option.getOrNull),
        ),
        (thread) => thread !== null && predicate(thread),
        description,
      ) as Effect.Effect<OrchestrationThread>;

    return {
      rootDir,
      checkoutRoot,
      checkout,
      threadId,
      runner: () => runner!,
      restartRunner,
      engine: () => hub.engine,
      snapshotQuery: () => hub.snapshotQuery,
      checkpointStore: () => hub.checkpointStore,
      diffStore: () => hub.diffStore,
      delivery: () => hub.delivery,
      dispatchClientCommand: (command) => Effect.suspend(() => hub.dispatchClientCommand(command)),
      restartHub: Effect.gen(function* () {
        yield* stopHub(hub);
        hub = yield* startHub;
      }),
      waitForThread,
      waitForPendingApproval: (requestId, predicate) =>
        waitFor(
          Effect.suspend(() =>
            hub.approvals.getByRequestId({ requestId: ApprovalRequestId.make(requestId) }),
          ).pipe(Effect.map(Option.getOrNull)),
          (row) => row !== null && predicate(row),
          `pending approval ${requestId}`,
        ),
      dispose: Effect.gen(function* () {
        yield* stopHub(hub);
        if (runnerScope) yield* Scope.close(runnerScope, Exit.void);
        yield* Scope.close(harnessScope, Exit.void);
        NodeFS.rmSync(rootDir, { recursive: true, force: true });
      }),
    } satisfies HubRunnerLoopbackHarness;
  });
