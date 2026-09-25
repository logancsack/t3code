/**
 * RunnerServer - the runner build (prototype).
 *
 * A runner is the half of the T3 server that must live next to a checkout:
 * real provider drivers, the checkpoint store, and workspace validation. It
 * serves `RunnerRpcGroup` on `RUNNER_WS_PATH` and never runs orchestration,
 * projections, or the client API; the hub does.
 *
 * Provider runtime events from every hosted instance are stamped with their
 * instance id and appended to the durable `RunnerOutbox` before any hub sees
 * them.
 *
 * @module runner/RunnerServer
 */
import * as NodeCrypto from "node:crypto";

import type { ProviderInstanceId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { FetchHttpClient, HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import { ServerConfig } from "../config.ts";
import { isGitRepository } from "../git/Utils.ts";
import { ClaudeDriver, type ClaudeDriverEnv } from "../provider/Drivers/ClaudeDriver.ts";
import { CodexDriver, type CodexDriverEnv } from "../provider/Drivers/CodexDriver.ts";
import { ProviderAdapterValidationError } from "../provider/Errors.ts";
import * as ModelManifest from "../provider/ModelManifest.ts";
import type { AnyProviderDriver } from "../provider/ProviderDriver.ts";
import * as ProviderEventLoggers from "../provider/Layers/ProviderEventLoggers.ts";
import { makeProviderInstanceRegistryHydration } from "../provider/Layers/ProviderInstanceRegistryHydration.ts";
import type { ProviderAdapterShape } from "../provider/Services/ProviderAdapter.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import type { ProviderAdapterError } from "../provider/Errors.ts";
import {
  ApplicationObservabilityLive,
  BackgroundLayerLive,
  HttpServerLive,
  PlatformServicesLive,
  VcsDriverRegistryLayerLive,
} from "../server.ts";
import { TextGenerationError } from "@t3tools/contracts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { RunnerOutbox, layer as RunnerOutboxLayer } from "./RunnerOutbox.ts";
import {
  RUNNER_PROTOCOL_VERSION,
  RUNNER_WS_PATH,
  RunnerRpcGroup,
  RunnerWorkspaceError,
} from "./RunnerProtocol.ts";

type RunnerDriversEnv = ClaudeDriverEnv | CodexDriverEnv;

const RUNNER_DRIVERS: ReadonlyArray<AnyProviderDriver<RunnerDriversEnv>> = [
  ClaudeDriver,
  CodexDriver,
];

/** `T3CODE_RUNNER_DRIVERS=claudeAgent,codex` selects which drivers this runner hosts. */
const selectRunnerDrivers = () => {
  const wanted = new Set(
    (process.env.T3CODE_RUNNER_DRIVERS ?? "claudeAgent,codex")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
  return RUNNER_DRIVERS.filter((driver) => wanted.has(driver.driverKind));
};

const RunnerRegistryLive = Layer.unwrap(
  Effect.sync(() => makeProviderInstanceRegistryHydration(selectRunnerDrivers())),
);

/** Appends every hosted adapter's runtime events to the outbox. */
const RunnerEventPumpLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ProviderInstanceRegistry;
    const outbox = yield* RunnerOutbox;
    const subscribed = new Map<ProviderInstanceId, ProviderAdapterShape<ProviderAdapterError>>();
    const reconcile = Effect.gen(function* () {
      const instances = yield* registry.listInstances;
      for (const instance of instances) {
        if (subscribed.get(instance.instanceId) === instance.adapter) continue;
        subscribed.set(instance.instanceId, instance.adapter);
        yield* Effect.logInfo("runner hosting provider instance", {
          instanceId: instance.instanceId,
          driver: instance.driverKind,
        });
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
    // sessions while the pumps still run outboxes their exit events, and the
    // hub learns the sessions ended instead of waiting on a silent turn.
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const instances = yield* registry.listInstances;
        yield* Effect.forEach(
          instances,
          (instance) => instance.adapter.stopAll().pipe(Effect.ignore),
          { discard: true },
        );
        yield* Effect.sleep("300 millis");
        yield* Effect.logInfo("runner drained provider sessions into the outbox", {
          ...(yield* outbox.stats),
        });
      }),
    );
  }),
);

const RunnerRpcHandlersLive = RunnerRpcGroup.toLayer(
  Effect.gen(function* () {
    const registry = yield* ProviderInstanceRegistry;
    const checkpointStore = yield* CheckpointStore.CheckpointStore;
    const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
    const outbox = yield* RunnerOutbox;

    const instanceOf = (instanceId: ProviderInstanceId) =>
      registry.getInstance(instanceId).pipe(
        Effect.flatMap((instance) =>
          instance
            ? Effect.succeed(instance)
            : Effect.fail(
                new ProviderAdapterValidationError({
                  provider: String(instanceId),
                  operation: "runner.resolveInstance",
                  issue: `This runner does not host provider instance '${instanceId}'.`,
                }),
              ),
        ),
      );
    const adapterOf = (instanceId: ProviderInstanceId) =>
      instanceOf(instanceId).pipe(Effect.map((instance) => instance.adapter));
    /** Logs each state-changing call with its duration, for protocol evidence. */
    const logged = <A, E, R>(
      method: string,
      attributes: Record<string, unknown>,
      effect: Effect.Effect<A, E, R>,
    ) =>
      Effect.gen(function* () {
        const startedAt = yield* Clock.currentTimeMillis;
        const exit = yield* Effect.exit(effect);
        yield* Effect.logInfo(`runner rpc ${method}`, {
          ...attributes,
          ok: exit._tag === "Success",
          ms: (yield* Clock.currentTimeMillis) - startedAt,
        });
        return yield* exit;
      });
    const textGenerationOf = (instanceId: ProviderInstanceId, operation: string) =>
      instanceOf(instanceId).pipe(
        Effect.map((instance) => instance.textGeneration),
        Effect.mapError((error) => new TextGenerationError({ operation, detail: error.message })),
      );

    return RunnerRpcGroup.of({
      "runner.hello": () =>
        Effect.gen(function* () {
          const stats = yield* outbox.stats;
          const instances = yield* registry.listInstances;
          return {
            protocolVersion: RUNNER_PROTOCOL_VERSION,
            runnerId: stats.runnerId,
            bootId: stats.bootId,
            headSequence: stats.headSequence,
            ackedSequence: stats.ackedSequence,
            instances: instances.map((instance) => instance.instanceId),
          };
        }),
      "runner.provider.startSession": ({ instanceId, input }) =>
        logged(
          "startSession",
          {
            threadId: input.threadId,
            cwd: input.cwd,
            runtimeMode: input.runtimeMode,
            resumeCursor: input.resumeCursor ?? null,
          },
          adapterOf(instanceId).pipe(Effect.flatMap((adapter) => adapter.startSession(input))),
        ),
      "runner.provider.sendTurn": ({ instanceId, input }) =>
        logged(
          "sendTurn",
          { threadId: input.threadId },
          adapterOf(instanceId).pipe(Effect.flatMap((adapter) => adapter.sendTurn(input))),
        ),
      "runner.provider.interruptTurn": ({ instanceId, threadId, turnId }) =>
        logged(
          "interruptTurn",
          { threadId, turnId },
          adapterOf(instanceId).pipe(
            Effect.flatMap((adapter) => adapter.interruptTurn(threadId, turnId)),
          ),
        ),
      "runner.provider.respondToRequest": ({ instanceId, threadId, requestId, decision }) =>
        logged(
          "respondToRequest",
          { threadId, requestId, decision },
          adapterOf(instanceId).pipe(
            Effect.flatMap((adapter) => adapter.respondToRequest(threadId, requestId, decision)),
          ),
        ),
      "runner.provider.respondToUserInput": ({ instanceId, threadId, requestId, answers }) =>
        adapterOf(instanceId).pipe(
          Effect.flatMap((adapter) => adapter.respondToUserInput(threadId, requestId, answers)),
        ),
      "runner.provider.stopSession": ({ instanceId, threadId }) =>
        logged(
          "stopSession",
          { threadId },
          adapterOf(instanceId).pipe(Effect.flatMap((adapter) => adapter.stopSession(threadId))),
        ),
      "runner.provider.listSessions": ({ instanceId }) =>
        adapterOf(instanceId).pipe(Effect.flatMap((adapter) => adapter.listSessions())),
      "runner.provider.readThread": ({ instanceId, threadId }) =>
        adapterOf(instanceId).pipe(Effect.flatMap((adapter) => adapter.readThread(threadId))),
      "runner.provider.rollbackThread": ({ instanceId, threadId, numTurns }) =>
        adapterOf(instanceId).pipe(
          Effect.flatMap((adapter) => adapter.rollbackThread(threadId, numTurns)),
        ),
      "runner.provider.getCapabilities": ({ instanceId, refresh }) =>
        instanceOf(instanceId).pipe(
          Effect.flatMap((instance) =>
            (refresh ? instance.snapshot.refresh : instance.snapshot.getSnapshot).pipe(
              Effect.map((snapshot) => ({
                snapshot,
                sessionModelSwitch: instance.adapter.capabilities.sessionModelSwitch,
              })),
            ),
          ),
        ),
      "runner.text.generateThreadTitle": ({ instanceId, ...request }) =>
        logged(
          "text.generateThreadTitle",
          { cwd: request.cwd, model: request.modelSelection.model },
          textGenerationOf(instanceId, "generateThreadTitle").pipe(
            Effect.flatMap((textGeneration) => textGeneration.generateThreadTitle(request)),
          ),
        ),
      "runner.text.generateBranchName": ({ instanceId, ...request }) =>
        textGenerationOf(instanceId, "generateBranchName").pipe(
          Effect.flatMap((textGeneration) => textGeneration.generateBranchName(request)),
        ),
      "runner.events.subscribe": ({ afterSequence }) => outbox.subscribe(afterSequence),
      "runner.events.ack": ({ throughSequence }) => outbox.ack(throughSequence),
      // Same `.git` presence check the in-process reactors used, so hub mode
      // keeps the exact checkpoint eligibility rule.
      "runner.checkpoint.isGitRepository": ({ cwd }) => Effect.sync(() => isGitRepository(cwd)),
      "runner.checkpoint.capture": (input) =>
        logged(
          "checkpoint.capture",
          { checkpointRef: input.checkpointRef },
          checkpointStore.captureCheckpoint(input),
        ),
      "runner.checkpoint.hasRef": (input) => checkpointStore.hasCheckpointRef(input),
      "runner.checkpoint.restore": ({ cwd, checkpointRef, fallbackToHead }) =>
        checkpointStore.restoreCheckpoint({
          cwd,
          checkpointRef,
          ...(fallbackToHead !== undefined ? { fallbackToHead } : {}),
        }),
      "runner.checkpoint.diff": ({ fallbackFromToHead, ...input }) =>
        checkpointStore.diffCheckpoints({
          ...input,
          ...(fallbackFromToHead !== undefined ? { fallbackFromToHead } : {}),
        }),
      "runner.checkpoint.deleteRefs": (input) => checkpointStore.deleteCheckpointRefs(input),
      "runner.workspace.normalizeRoot": ({ workspaceRoot, createIfMissing }) =>
        workspacePaths
          .normalizeWorkspaceRoot(
            workspaceRoot,
            createIfMissing !== undefined ? { createIfMissing } : undefined,
          )
          .pipe(
            Effect.mapError(
              (error) =>
                new RunnerWorkspaceError({
                  operation: "normalizeRoot",
                  workspaceRoot,
                  reason:
                    error._tag === "WorkspaceRootNotExistsError"
                      ? "not-exists"
                      : error._tag === "WorkspaceRootNotDirectoryError"
                        ? "not-directory"
                        : error._tag === "WorkspaceRootCreateFailedError"
                          ? "create-failed"
                          : "stat-failed",
                  detail: error.message,
                }),
            ),
          ),
    });
  }),
);

function tokenMatches(presented: string | null, expected: string): boolean {
  if (presented === null) return false;
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  return left.length === right.length && NodeCrypto.timingSafeEqual(left, right);
}

const RunnerRouteLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const expectedToken = config.runnerToken;
    const handlers = yield* Layer.build(
      RunnerRpcHandlersLive.pipe(Layer.provideMerge(RpcSerialization.layerJson)),
    );
    const rpcHttpEffect = yield* RpcServer.toHttpEffectWebsocket(RunnerRpcGroup, {
      disableTracing: true,
    }).pipe(Effect.provide(handlers));
    return HttpRouter.add("GET", RUNNER_WS_PATH, (request) =>
      Effect.gen(function* () {
        const token = new URL(request.url, "http://runner.local").searchParams.get("token");
        if (expectedToken && !tokenMatches(token, expectedToken)) {
          return HttpServerResponse.text("unauthorized", { status: 401 });
        }
        return yield* rpcHttpEffect;
      }),
    );
  }),
);

const RunnerServicesLive = Layer.mergeAll(RunnerEventPumpLive, RunnerRouteLive).pipe(
  Layer.provideMerge(RunnerOutboxLayer),
  Layer.provideMerge(RunnerRegistryLive),
  Layer.provideMerge(
    Layer.mergeAll(
      CheckpointStore.layer.pipe(Layer.provide(VcsDriverRegistryLayerLive)),
      WorkspacePaths.layer,
    ),
  ),
  Layer.provideMerge(Layer.mergeAll(ProviderEventLoggers.layer, ModelManifest.layer)),
  Layer.provideMerge(BackgroundLayerLive),
);

export const makeRunnerLayer = HttpRouter.serve(RunnerServicesLive, {
  disableLogger: true,
}).pipe(
  Layer.provideMerge(HttpServerLive),
  Layer.provide(ApplicationObservabilityLive),
  Layer.provideMerge(FetchHttpClient.layer),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(PlatformServicesLive),
);

export const runRunner = Layer.launch(makeRunnerLayer);
