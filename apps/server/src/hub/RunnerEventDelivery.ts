/**
 * RunnerEventDelivery - provider runtime events from thread runners into the
 * hub, exactly once in effect.
 *
 * For every runner connection the hub subscribes to the runner outbox from
 * its cursor, drops any `(thread, sequence)` it already delivered, and
 * publishes the events to the remote provider adapters, which feed
 * `ProviderService` and ingestion unchanged.
 *
 * Durability contract:
 * - The persisted cursor (`RunnerCursorStore`) only advances to a *safe
 *   point*: a sequence at which the thread had no open turn. Ingestion
 *   buffers assistant text and plans in memory while a turn runs, so a cursor
 *   inside a turn could lose buffered text on a hub crash. After a crash the
 *   runner replays the open turn from its start.
 * - Replays are idempotent: in hub mode ingestion derives its command ids
 *   from the runner event id, so commands that already committed are
 *   answered from their receipts instead of being applied twice.
 * - A cursor is written only after ingestion has drained and the safe point
 *   has aged `flush`'s `minAge`, then acknowledged to the runner so it can
 *   compact its outbox. Acknowledgement is a notification, not a correctness
 *   step.
 *
 * Boot reconciliation: when a runner's `bootId` differs from the boot the hub
 * last saw, sessions from the previous boot are gone. Once the replayed
 * backlog is delivered, the hub asks the runner which sessions it still
 * hosts and settles the rest with an interrupted `turn.completed` and a
 * `session.exited`, with deterministic event ids. The same happens when the
 * directory reports a thread's machine failed or no longer exists.
 *
 * @module hub/RunnerEventDelivery
 */
import { EventId, type ProviderRuntimeEvent, type ThreadId } from "@t3tools/contracts";
import type { ThreadMachineStatus } from "@t3tools/contracts/runner";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import { RunnerCursorStore } from "../persistence/Services/HubThreadMachineState.ts";
import { RemoteSessionRegistry, type RemoteSessionRecord } from "./RemoteSessionRegistry.ts";
import { RunnerConnectionPool, type RunnerConnection } from "./RunnerConnectionPool.ts";

export interface ThreadDeliveryState {
  readonly outboxId: string | null;
  readonly bootId: string | null;
  /** Highest runner sequence published to the hub. */
  readonly delivered: number;
  /** Highest sequence at which the thread had no open turn. */
  readonly safe: number;
  /** Highest sequence persisted in the cursor store. */
  readonly durable: number;
  readonly duplicates: number;
  readonly openTurnSince: number | null;
}

export interface RunnerEventDeliveryShape {
  /** Delivered and reconciliation events, in runner order per thread. */
  readonly events: Stream.Stream<ProviderRuntimeEvent>;
  /** Opens delivery. Subscriptions wait for it so ingestion listens first. */
  readonly start: Effect.Effect<void>;
  /**
   * Persists safe points older than `minAgeMs` once `drain` has returned,
   * then acknowledges them to connected runners.
   */
  readonly flush: (input: {
    readonly minAgeMs: number;
    readonly drain: Effect.Effect<void>;
  }) => Effect.Effect<void>;
  readonly state: Effect.Effect<ReadonlyMap<ThreadId, ThreadDeliveryState>>;
  /**
   * Waits until boot reconciliation for `connection` has run, so callers see
   * whether sessions survived a runner restart. Bounded; delivery that never
   * starts does not block calls forever.
   */
  readonly awaitReconciled: (connection: RunnerConnection) => Effect.Effect<void>;
}

export class RunnerEventDelivery extends Context.Service<
  RunnerEventDelivery,
  RunnerEventDeliveryShape
>()("t3/hub/RunnerEventDelivery") {}

interface MutableThreadState {
  outboxId: string | null;
  bootId: string | null;
  persistedBootId: string | null;
  delivered: number;
  safe: number;
  safeReachedAt: number;
  durable: number;
  duplicates: number;
  openTurnSince: number | null;
}

const closesTurn = (event: ProviderRuntimeEvent) =>
  event.type === "turn.completed" ||
  event.type === "turn.aborted" ||
  event.type === "session.exited";

const MACHINE_RESTARTED = "The thread machine restarted; the turn was interrupted.";
const RECONCILE_WAIT = "30 seconds";
const SUBSCRIPTION_RETRY = Schedule.exponential("250 millis").pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, Duration.seconds(5))),
  ),
);

export const make = Effect.gen(function* () {
  const pool = yield* RunnerConnectionPool;
  const cursors = yield* RunnerCursorStore;
  const registry = yield* RemoteSessionRegistry;
  const bus = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const enabled = yield* Deferred.make<void>();
  const states = new Map<ThreadId, MutableThreadState>();
  const reconciledByConnection = new WeakMap<RunnerConnection, Deferred.Deferred<void>>();
  const reconciledSignal = (connection: RunnerConnection) =>
    Effect.gen(function* () {
      const existing = reconciledByConnection.get(connection);
      if (existing) return existing;
      const created = yield* Deferred.make<void>();
      reconciledByConnection.set(connection, created);
      return created;
    });

  const stateOf = (threadId: ThreadId) => {
    let state = states.get(threadId);
    if (!state) {
      state = {
        outboxId: null,
        bootId: null,
        persistedBootId: null,
        delivered: 0,
        safe: 0,
        safeReachedAt: 0,
        durable: 0,
        duplicates: 0,
        openTurnSince: null,
      };
      states.set(threadId, state);
    }
    return state;
  };

  /** Publishes one event and advances turn tracking; `sequence` is null for synthesized events. */
  const publish = (threadId: ThreadId, sequence: number | null, event: ProviderRuntimeEvent) =>
    Effect.gen(function* () {
      const state = stateOf(threadId);
      const now = yield* Clock.currentTimeMillis;
      if (sequence !== null) {
        state.delivered = sequence;
        if (event.type === "turn.started" && state.openTurnSince === null) {
          state.openTurnSince = sequence;
        }
      }
      if (closesTurn(event)) state.openTurnSince = null;
      if (state.openTurnSince === null && state.safe !== state.delivered) {
        state.safe = state.delivered;
        state.safeReachedAt = now;
      }
      yield* registry.applyEvent(event);
      yield* PubSub.publish(bus, event);
      yield* pool.setBusy(threadId, "turn", state.openTurnSince !== null);
    });

  /** Settles a session its runner no longer hosts. */
  const settle = (record: RemoteSessionRecord, reason: string, key: string) =>
    Effect.gen(function* () {
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      const base = {
        provider: record.provider,
        providerInstanceId: record.instanceId,
        threadId: record.threadId,
        createdAt,
      } as const;
      yield* Effect.logWarning("settling a thread session its runner no longer hosts", {
        threadId: record.threadId,
        instanceId: record.instanceId,
        activeTurnId: record.session.activeTurnId,
        reason,
      });
      if (record.session.activeTurnId !== undefined) {
        yield* publish(record.threadId, null, {
          ...base,
          type: "turn.completed",
          eventId: EventId.make(`hub-reconcile:${record.threadId}:${key}:turn-completed`),
          turnId: record.session.activeTurnId,
          payload: { state: "interrupted", errorMessage: reason },
        });
      }
      yield* publish(record.threadId, null, {
        ...base,
        type: "session.exited",
        eventId: EventId.make(`hub-reconcile:${record.threadId}:${key}:session-exited`),
        payload: { reason, recoverable: true, exitKind: "error" },
      });
      yield* registry.remove(record.threadId);
    });

  /** After a boot change: keep sessions the runner still hosts, settle the rest. */
  const reconcileBoot = (connection: RunnerConnection) =>
    Effect.gen(function* () {
      const { threadId, hello, client } = connection;
      const record = Option.getOrUndefined(yield* registry.get(threadId));
      if (!record || record.bootId === hello.bootId) return;
      const live = hello.instances.includes(record.instanceId)
        ? yield* client["runner.provider.listSessions"]({ instanceId: record.instanceId }).pipe(
            Effect.map((sessions) => sessions.some((session) => session.threadId === threadId)),
            Effect.orElseSucceed(() => false),
          )
        : false;
      if (live) {
        yield* registry.adoptBoot(threadId, hello.bootId);
        return;
      }
      yield* settle(record, MACHINE_RESTARTED, hello.bootId);
    });

  const deliverFrom = (connection: RunnerConnection) =>
    Effect.gen(function* () {
      const { threadId, hello, client } = connection;
      const cursor = Option.getOrUndefined(
        yield* cursors.get(threadId).pipe(
          Effect.catch((error) =>
            Effect.logWarning("runner cursor read failed; resuming from memory", {
              threadId,
              detail: error.message,
            }).pipe(Effect.as(Option.none())),
          ),
        ),
      );
      const state = stateOf(threadId);
      if (state.outboxId !== hello.runnerId) {
        // First connection this hub lifetime, or a new outbox (recreated machine).
        const persisted = cursor?.outboxId === hello.runnerId ? cursor.ackedSequence : 0;
        state.outboxId = hello.runnerId;
        state.delivered = persisted;
        state.safe = persisted;
        state.durable = persisted;
        state.openTurnSince = null;
        state.persistedBootId = cursor?.outboxId === hello.runnerId ? cursor.bootId : null;
      }
      const previousBoot = state.bootId ?? cursor?.bootId ?? null;
      state.bootId = hello.bootId;
      if (hello.firstRetainedSequence > state.delivered + 1) {
        yield* Effect.logError("runner outbox dropped undelivered events past retention", {
          threadId,
          delivered: state.delivered,
          firstRetainedSequence: hello.firstRetainedSequence,
        });
      }

      yield* Deferred.await(enabled);

      const done = yield* reconciledSignal(connection);
      const record = Option.getOrUndefined(yield* registry.get(threadId));
      let reconciled = record === undefined || record.bootId === hello.bootId;
      if (!reconciled) {
        yield* Effect.logInfo("runner boot changed; reconciling sessions after replay", {
          threadId,
          previousBootId: previousBoot,
          bootId: hello.bootId,
        });
      } else {
        yield* Deferred.succeed(done, undefined);
      }
      const reconcileWhenCaughtUp = (sequence: number) =>
        reconciled || sequence < hello.headSequence
          ? Effect.void
          : Effect.suspend(() => {
              reconciled = true;
              return reconcileBoot(connection).pipe(
                Effect.ensuring(Deferred.succeed(done, undefined)),
              );
            });

      yield* reconcileWhenCaughtUp(state.delivered);
      // Resubscribes from the last delivered sequence if the stream fails while
      // the connection stays open; the connection's scope ends the loop.
      yield* Stream.suspend(() =>
        client["runner.events.subscribe"]({ afterSequence: state.delivered }),
      ).pipe(
        Stream.runForEach((envelope) =>
          Effect.gen(function* () {
            if (envelope.sequence <= state.delivered) {
              state.duplicates += 1;
              return;
            }
            yield* publish(threadId, envelope.sequence, envelope.event);
            yield* pool.touch(threadId);
            yield* reconcileWhenCaughtUp(envelope.sequence);
          }),
        ),
        Effect.tapCause((cause) =>
          Effect.logWarning("runner event subscription failed; resubscribing", {
            threadId,
            delivered: state.delivered,
            cause: Cause.pretty(cause).slice(0, 400),
          }),
        ),
        Effect.retry(SUBSCRIPTION_RETRY),
      );
    });

  yield* pool.onConnection((connection) =>
    deliverFrom(connection).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.logWarning("runner event subscription ended", {
              threadId: connection.threadId,
              cause: Cause.pretty(cause).slice(0, 400),
            }),
      ),
    ),
  );

  // The directory reports the machine failed or gone: nothing will replay.
  yield* pool.lifecycle.pipe(
    Stream.runForEach((event) =>
      event._tag !== "lost"
        ? Effect.void
        : Effect.gen(function* () {
            yield* Deferred.await(enabled);
            const record = Option.getOrUndefined(yield* registry.get(event.threadId));
            if (!record) return;
            yield* settle(record, lostReason(event.status), `lost:${record.bootId ?? "unknown"}`);
          }),
    ),
    Effect.forkScoped,
  );

  const flush: RunnerEventDeliveryShape["flush"] = ({ minAgeMs, drain }) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const candidates = [...states].filter(
        ([, state]) =>
          state.outboxId !== null &&
          state.bootId !== null &&
          (state.safe > state.durable || state.bootId !== state.persistedBootId) &&
          now - state.safeReachedAt >= minAgeMs,
      );
      if (candidates.length === 0) return;
      // Everything published up to each safe point has reached ingestion's
      // queue by now; drain so its effects are committed before the cursor.
      yield* drain;
      const updatedAt = DateTime.formatIso(yield* DateTime.now);
      const rows = candidates.map(([threadId, state]) => ({
        threadId,
        outboxId: state.outboxId!,
        bootId: state.bootId!,
        ackedSequence: state.safe,
        updatedAt,
      }));
      yield* cursors.saveAll(rows);
      for (const row of rows) {
        const state = stateOf(row.threadId);
        state.durable = Math.max(state.durable, row.ackedSequence);
        state.persistedBootId = row.bootId;
        const connection = yield* pool.current(row.threadId);
        if (Option.isSome(connection) && connection.value.hello.runnerId === row.outboxId) {
          yield* connection.value.client["runner.events.ack"]({
            throughSequence: row.ackedSequence,
          }).pipe(Effect.ignore);
        }
      }
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("runner cursor flush failed; retried on the next flush", {
          detail: error.message,
        }),
      ),
    );

  return RunnerEventDelivery.of({
    awaitReconciled: (connection) =>
      reconciledSignal(connection).pipe(
        Effect.flatMap(Deferred.await),
        Effect.timeoutOrElse({
          duration: RECONCILE_WAIT,
          orElse: () =>
            Effect.logWarning("runner boot reconciliation is taking long; proceeding", {
              threadId: connection.threadId,
            }),
        }),
      ),
    events: Stream.fromPubSub(bus),
    start: Deferred.succeed(enabled, undefined).pipe(Effect.asVoid),
    flush,
    state: Effect.sync(
      () =>
        new Map(
          [...states].map(([threadId, state]) => [
            threadId,
            {
              outboxId: state.outboxId,
              bootId: state.bootId,
              delivered: state.delivered,
              safe: state.safe,
              durable: state.durable,
              duplicates: state.duplicates,
              openTurnSince: state.openTurnSince,
            } satisfies ThreadDeliveryState,
          ]),
        ),
    ),
  });
});

const lostReason = (status: ThreadMachineStatus) =>
  status.state === "failed"
    ? `The thread machine failed${status.detail ? `: ${status.detail}` : ""}; the turn was interrupted.`
    : "The thread machine no longer exists; the turn was interrupted.";

export const layer = Layer.effect(RunnerEventDelivery, make);
