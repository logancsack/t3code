/**
 * RunnerServer - the `t3 runner` composition.
 *
 * A runner is the half of the T3 server that must live next to a checkout:
 * the real provider drivers, git and checkpoints, terminals, workspace files,
 * review and git actions for exactly one thread. It serves `RunnerRpcGroup`
 * on `RUNNER_WS_PATH` and never runs orchestration, projections, auth, or the
 * client API; the hub does.
 *
 * Every provider runtime event from every hosted instance is stamped with its
 * instance id and committed to the durable `RunnerOutbox` before any hub sees
 * it. On graceful shutdown the runner stops its sessions while the event pumps
 * still run, so the exit events reach the outbox and the hub settles the turn.
 *
 * @module runner/RunnerServer
 */
import * as NodeCrypto from "node:crypto";

import type { ProviderInstanceId } from "@t3tools/contracts";
import { RUNNER_WS_PATH, RunnerRpcGroup } from "@t3tools/contracts/runner";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { FetchHttpClient, HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import { ServerConfig } from "../config.ts";
import * as GitManager from "../git/GitManager.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as PortScanner from "../preview/PortScanner.ts";
import * as ProcessRunner from "../processRunner.ts";
import { resolveBuiltInDrivers } from "../provider/builtInDrivers.ts";
import type { ProviderAdapterError } from "../provider/Errors.ts";
import * as ModelManifest from "../provider/ModelManifest.ts";
import * as OpenCodeRuntime from "../provider/opencodeRuntime.ts";
import * as ProviderEventLoggers from "../provider/Layers/ProviderEventLoggers.ts";
import { makeProviderInstanceRegistryHydration } from "../provider/Layers/ProviderInstanceRegistryHydration.ts";
import { ProviderRegistryLive } from "../provider/Layers/ProviderRegistry.ts";
import type { ProviderAdapterShape } from "../provider/Services/ProviderAdapter.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import * as ReviewService from "../review/ReviewService.ts";
import {
  ApplicationObservabilityLive,
  BackgroundLayerLive,
  HttpServerLive,
  PlatformServicesLive,
  PtyAdapterLive,
  SourceControlProviderRegistryLayerLive,
  VcsDriverRegistryLayerLive,
} from "../server.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as VcsProvisioningService from "../vcs/VcsProvisioningService.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as RunnerCheckout from "./RunnerCheckout.ts";
import { RunnerRpcHandlersLive, resolveRunnerBinding } from "./RunnerHandlers.ts";
import { RunnerOutbox, layer as RunnerOutboxLayer } from "./RunnerOutbox.ts";
import * as RunnerProjectionSnapshotQuery from "./RunnerProjectionSnapshotQuery.ts";

/** Time given to session-exit events to reach the outbox on graceful shutdown. */
const SHUTDOWN_DRAIN = "300 millis";

/**
 * `T3CODE_RUNNER_DRIVERS=claudeAgent,codex` limits the hosted drivers (for
 * development and tests); by default a runner hosts every built-in driver.
 */
const RunnerProviderInstanceRegistryLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const drivers = resolveBuiltInDrivers({ museCodeEnabled: config.museCodeEnabled });
    const wanted = new Set(
      (process.env.T3CODE_RUNNER_DRIVERS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    );
    return makeProviderInstanceRegistryHydration(
      wanted.size === 0 ? drivers : drivers.filter((driver) => wanted.has(driver.driverKind)),
    );
  }),
);

/** Appends every hosted adapter's runtime events to the outbox. */
export const RunnerEventPumpLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ProviderInstanceRegistry;
    const outbox = yield* RunnerOutbox;
    const subscribed = new Map<ProviderInstanceId, ProviderAdapterShape<ProviderAdapterError>>();
    const reconcile = Effect.gen(function* () {
      for (const instance of yield* registry.listInstances) {
        if (subscribed.get(instance.instanceId) === instance.adapter) continue;
        subscribed.set(instance.instanceId, instance.adapter);
        yield* Stream.runForEach(instance.adapter.streamEvents, (event) =>
          outbox.append({ ...event, providerInstanceId: instance.instanceId }),
        ).pipe(Effect.forkScoped);
      }
    });
    const changes = yield* registry.subscribeChanges;
    yield* reconcile;
    yield* Stream.runForEach(Stream.fromSubscription(changes), () => reconcile).pipe(
      Effect.forkScoped,
    );
    // Registered after the pumps, so it runs first on shutdown: stopping the
    // sessions while the pumps still run commits their exit events, and the
    // hub learns the turns ended instead of waiting on silent sessions.
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        for (const instance of yield* registry.listInstances) {
          yield* instance.adapter.stopAll().pipe(Effect.ignore);
        }
        yield* Effect.sleep(SHUTDOWN_DRAIN);
        yield* Effect.logInfo("runner drained provider sessions into the outbox", {
          ...(yield* outbox.stats),
        });
      }),
    );
  }),
);

const bearerMatches = (header: string | undefined, expected: string): boolean => {
  if (header === undefined || !header.startsWith("Bearer ")) return false;
  const presented = Buffer.from(header.slice("Bearer ".length));
  const wanted = Buffer.from(expected);
  return presented.length === wanted.length && NodeCrypto.timingSafeEqual(presented, wanted);
};

/**
 * The runner protocol endpoint. The hub authenticates with
 * `Authorization: Bearer T3CODE_RUNNER_TOKEN`; without a configured token the
 * endpoint is open, which is only acceptable on loopback in development.
 */
const RunnerRouteLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const expectedToken = config.runnerToken;
    if (!expectedToken) {
      yield* Effect.logWarning("runner has no T3CODE_RUNNER_TOKEN; the protocol endpoint is open");
    }
    const handlers = yield* Layer.build(
      RunnerRpcHandlersLive.pipe(Layer.provideMerge(RpcSerialization.layerJson)),
    );
    const rpcHttpEffect = yield* RpcServer.toHttpEffectWebsocket(RunnerRpcGroup, {
      disableTracing: true,
    }).pipe(Effect.provide(handlers));
    return HttpRouter.add("GET", RUNNER_WS_PATH, (request) =>
      expectedToken && !bearerMatches(request.headers.authorization, expectedToken)
        ? Effect.succeed(HttpServerResponse.text("unauthorized", { status: 401 }))
        : rpcHttpEffect,
    );
  }),
);

const RunnerTerminalLive = TerminalManager.layer.pipe(
  Layer.provide(PtyAdapterLive),
  Layer.provide(PortScanner.layer.pipe(Layer.provide(ProcessRunner.layer))),
);

const RunnerWorkspaceLive = Layer.mergeAll(
  WorkspaceFileSystem.layer.pipe(
    Layer.provide(WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer))),
  ),
  WorkspaceEntries.layer,
).pipe(Layer.provideMerge(WorkspacePaths.layer));

const RunnerGitLive = Layer.mergeAll(
  GitWorkflowService.layer,
  ReviewService.layer,
  VcsProvisioningService.layer,
  CheckpointStore.layer,
  RunnerCheckout.layer,
).pipe(
  Layer.provideMerge(
    GitManager.layer.pipe(
      Layer.provideMerge(ProjectSetupScriptRunner.layer),
      Layer.provideMerge(TextGeneration.layer),
      Layer.provideMerge(SourceControlProviderRegistryLayerLive),
    ),
  ),
  Layer.provideMerge(GitVcsDriver.layer),
  Layer.provideMerge(VcsDriverRegistryLayerLive),
);

const RunnerCheckoutServicesLive = Layer.mergeAll(
  VcsStatusBroadcaster.layer.pipe(Layer.provideMerge(RunnerGitLive)),
  RunnerWorkspaceLive,
).pipe(
  Layer.provideMerge(RunnerTerminalLive),
  Layer.provideMerge(RunnerProjectionSnapshotQuery.layer),
);

const RunnerServicesLive = Layer.mergeAll(RunnerEventPumpLive, RunnerRouteLive).pipe(
  Layer.provideMerge(RunnerOutboxLayer),
  Layer.provideMerge(RunnerCheckoutServicesLive),
  Layer.provideMerge(ProviderRegistryLive),
  Layer.provideMerge(RunnerProviderInstanceRegistryLive),
  Layer.provideMerge(
    Layer.mergeAll(
      ProviderEventLoggers.layer,
      ModelManifest.layer,
      OpenCodeRuntime.OpenCodeRuntimeLive,
    ),
  ),
  Layer.provideMerge(BackgroundLayerLive),
);

/** Fails fast with a clear message when the runner is not bound to a thread. */
const RunnerBindingCheckLive = Layer.effectDiscard(
  resolveRunnerBinding.pipe(
    Effect.tap((binding) =>
      Effect.logInfo("runner serving thread", {
        threadId: binding.threadId,
        checkout: binding.checkout,
      }),
    ),
  ),
);

export const makeRunnerLayer = HttpRouter.serve(RunnerServicesLive, {
  disableLogger: true,
}).pipe(
  Layer.provideMerge(RunnerBindingCheckLive),
  Layer.provideMerge(HttpServerLive),
  Layer.provide(ApplicationObservabilityLive),
  Layer.provideMerge(FetchHttpClient.layer),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(PlatformServicesLive),
);

export const runRunner = Layer.launch(makeRunnerLayer);
