/**
 * HubRunnerLifecycle - hub-wide background work for thread machines.
 *
 * - Opens runner event delivery once the server is activated (ingestion
 *   subscribes at the same gate), then resumes delivery from every thread
 *   with a live remote session whose machine is running, so events emitted
 *   while the hub was down are ingested. Resuming never wakes a machine.
 * - Flushes delivery cursors: every `ACK_INTERVAL`, safe points older than
 *   `ACK_SETTLE` are persisted once ingestion and the checkpoint reactor have
 *   drained (so a turn's checkpoint capture is durable before its events are
 *   acknowledged), then acknowledged to their runners. A final flush runs on
 *   shutdown.
 * - Gives the connection pool the project and repository of each thread for
 *   machine directory requests.
 * - Releases a thread's machine when the thread is archived or deleted, and
 *   drops its hub caches when it is deleted.
 * - Records every machine state change as a `thread-machine.state` activity
 *   (which re-publishes the thread shell with its new `machine`), and checks
 *   machines the hub believes are awake but holds no connection to every
 *   `MACHINE_WATCH_INTERVAL`, so a machine the platform paused after an idle
 *   report shows as asleep. Checks never wake a machine.
 *
 * @module hub/HubRunnerLifecycle
 */
import type { OrchestrationEvent, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { isBootstrapCleanupDeletion } from "../orchestration/Layers/ThreadDeletionReactor.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { CheckpointReactor } from "../orchestration/Services/CheckpointReactor.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRuntimeIngestionService } from "../orchestration/Services/ProviderRuntimeIngestion.ts";
import {
  CheckpointTurnDiffStore,
  RunnerCursorStore,
} from "../persistence/Services/HubThreadMachineState.ts";
import { RepositoryIdentityResolver } from "../project/RepositoryIdentityResolver.ts";
import { forkParked } from "../serverActivation.ts";
import { HubVcsStatusCache } from "./HubVcs.ts";
import { RemoteSessionRegistry } from "./RemoteSessionRegistry.ts";
import { RunnerConnectionPool } from "./RunnerConnectionPool.ts";
import { RunnerEventDelivery } from "./RunnerEventDelivery.ts";
import {
  makeThreadMachineActivityRecorder,
  threadMachineStateActivity,
} from "./threadMachineActivity.ts";
import { ThreadMachineStates } from "./ThreadMachineStates.ts";

/** Ingestion's stream consumers start at the same activation gate; let them subscribe first. */
const DELIVERY_START_DELAY = "250 millis";
const ACK_INTERVAL = "250 millis";
/** A safe point is persisted once it is this old, so its events have reached ingestion's queue. */
const ACK_SETTLE_MS = 250;
const SHUTDOWN_FLUSH_TIMEOUT = "5 seconds";
/** How often machines believed awake without a hub connection are re-checked. */
const MACHINE_WATCH_INTERVAL = "60 seconds";
const WATCHED_STATES: ReadonlySet<string> = new Set(["preparing", "starting", "running"]);

type ThreadLifecycleEvent = Extract<
  OrchestrationEvent,
  { type: "thread.deleted" | "thread.archived" }
>;

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const pool = yield* RunnerConnectionPool;
    const delivery = yield* RunnerEventDelivery;
    const registry = yield* RemoteSessionRegistry;
    const ingestion = yield* ProviderRuntimeIngestionService;
    const checkpointReactor = yield* CheckpointReactor;
    const engine = yield* OrchestrationEngineService;
    const projections = yield* ProjectionSnapshotQuery;
    const repositoryIdentity = yield* RepositoryIdentityResolver;
    const cursors = yield* RunnerCursorStore;
    const diffs = yield* CheckpointTurnDiffStore;
    const vcsCache = yield* HubVcsStatusCache;
    const machineStates = yield* ThreadMachineStates;
    const recordActivity = yield* makeThreadMachineActivityRecorder;

    yield* pool.setContextResolver((threadId) =>
      Effect.gen(function* () {
        const thread = Option.getOrUndefined(
          yield* projections
            .getThreadShellById(threadId)
            .pipe(Effect.orElseSucceed(() => Option.none())),
        );
        if (!thread) {
          return { projectId: null, repository: null, branch: null, providerInstanceId: null };
        }
        const project = Option.getOrUndefined(
          yield* projections
            .getProjectShellById(thread.projectId)
            .pipe(Effect.orElseSucceed(() => Option.none())),
        );
        const identity = project ? yield* repositoryIdentity.resolve(project.workspaceRoot) : null;
        return {
          projectId: thread.projectId,
          repository: identity ? { url: identity.locator.remoteUrl, ref: null } : null,
          branch: thread.branch,
          providerInstanceId: thread.modelSelection.instanceId,
        };
      }),
    );

    const flush = (minAgeMs: number) =>
      delivery.flush({
        minAgeMs,
        drain: ingestion.drain.pipe(Effect.andThen(checkpointReactor.drain)),
      });

    yield* forkParked(
      Effect.gen(function* () {
        yield* Effect.sleep(DELIVERY_START_DELAY);
        yield* delivery.start;
        for (const record of yield* registry.list) {
          yield* pool
            .use(record.threadId, { wake: false, operation: "resume-delivery" }, () => Effect.void)
            .pipe(
              Effect.catch((error) =>
                Effect.logInfo("thread machine not resumed for delivery", {
                  threadId: record.threadId,
                  reason: error.reason,
                }),
              ),
              Effect.forkScoped,
            );
        }
        return yield* flush(ACK_SETTLE_MS).pipe(Effect.delay(ACK_INTERVAL), Effect.forever);
      }),
    );
    yield* Effect.addFinalizer(() =>
      flush(0).pipe(Effect.timeout(SHUTDOWN_FLUSH_TIMEOUT), Effect.ignore),
    );

    const releaseThread = (event: ThreadLifecycleEvent) =>
      Effect.gen(function* () {
        const threadId: ThreadId = event.payload.threadId;
        // A failed bootstrap may retry with the same thread id; its machine stays.
        if (event.type === "thread.deleted" && isBootstrapCleanupDeletion(event)) return;
        yield* pool.release(threadId);
        if (event.type === "thread.deleted") {
          yield* registry.remove(threadId);
          yield* vcsCache.remove(threadId);
          yield* cursors.remove(threadId).pipe(Effect.ignore);
          yield* diffs.removeThread(threadId).pipe(Effect.ignore);
          yield* machineStates.remove(threadId);
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning("thread machine release failed", {
                threadId: event.payload.threadId,
                cause: Cause.pretty(cause),
              }),
        ),
      );

    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) =>
        event.type === "thread.deleted" || event.type === "thread.archived"
          ? releaseThread(event)
          : Effect.void,
      ),
    );

    // Machine state transitions become thread activities; the activity's
    // domain event re-publishes the shell with the new `machine`.
    yield* forkParked(
      Stream.runForEach(machineStates.changes, (change) =>
        Effect.gen(function* () {
          const thread = yield* projections
            .getThreadShellById(change.threadId)
            .pipe(Effect.orElseSucceed(() => Option.none()));
          // The provider sign-in machine and deleted threads have no thread.
          if (Option.isNone(thread)) return;
          yield* recordActivity(change.threadId, threadMachineStateActivity(change.current));
        }),
      ),
    );

    // Machines the hub believes awake but holds no connection to may have been
    // paused by the platform; a status read (which never wakes) records that.
    const watchMachines = Effect.gen(function* () {
      for (const [threadId, entry] of yield* machineStates.list) {
        if (!WATCHED_STATES.has(entry.state)) continue;
        if (Option.isSome(yield* pool.current(threadId))) continue;
        yield* pool.machineStatus(threadId).pipe(Effect.ignore);
      }
    });
    yield* forkParked(watchMachines.pipe(Effect.delay(MACHINE_WATCH_INTERVAL), Effect.forever));
  }),
);
