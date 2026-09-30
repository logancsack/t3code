import { it } from "@effect/vitest";
import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import type { RunnerEventEnvelope } from "@t3tools/contracts/runner";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import { HubThreadMachineStateSqliteLive } from "../persistence/Layers/HubThreadMachineState.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ProviderSessionRuntime from "../persistence/ProviderSessionRuntime.ts";
import { RunnerCursorStore } from "../persistence/Services/HubThreadMachineState.ts";
import {
  type FakeMachine,
  MachineDirectory,
  makeFakeMachineDirectory,
} from "./MachineDirectory.ts";
import * as RemoteSessionRegistry from "./RemoteSessionRegistry.ts";
import { make as makePool, RunnerConnectionPool } from "./RunnerConnectionPool.ts";
import * as RunnerEventDelivery from "./RunnerEventDelivery.ts";
import { fakeRunner, fakeRunnerHello, serveRunner } from "./testUtils/runnerServer.ts";

const threadId = ThreadId.make("thread-delivery");
const provider = ProviderDriverKind.make("claudeAgent");
const instanceId = ProviderInstanceId.make("claudeAgent");

const event = (
  id: string,
  type: "session.started" | "turn.started" | "content.delta" | "turn.completed",
): ProviderRuntimeEvent => {
  const base = {
    eventId: EventId.make(id),
    provider,
    providerInstanceId: instanceId,
    threadId,
    createdAt: "2026-09-25T00:00:00.000Z",
    turnId: TurnId.make("turn-1"),
  };
  switch (type) {
    case "session.started":
      return { ...base, type, payload: {} };
    case "turn.started":
      return { ...base, type, payload: {} };
    case "content.delta":
      return { ...base, type, payload: { streamKind: "assistant_text", delta: "hi" } };
    case "turn.completed":
      return { ...base, type, payload: { state: "completed" } };
  }
};

const envelope = (sequence: number, value: ProviderRuntimeEvent, bootId = "boot-1") =>
  ({ sequence, bootId, event: value }) satisfies RunnerEventEnvelope;

/** A runner that replays `backlog`, then publishes whatever the test pushes. */
const startRunner = (options: {
  readonly bootId: string;
  readonly backlog: ReadonlyArray<RunnerEventEnvelope>;
  readonly sessions?: ReadonlyArray<ProviderSession>;
}) =>
  Effect.gen(function* () {
    const live = yield* PubSub.unbounded<RunnerEventEnvelope>();
    const subscribedFrom: Array<number> = [];
    const acked: Array<number> = [];
    const headSequence = options.backlog.at(-1)?.sequence ?? 0;
    const served = yield* serveRunner(
      fakeRunner({
        "runner.hello": (input) =>
          Effect.succeed(
            fakeRunnerHello({
              threadId: input.threadId,
              bootId: options.bootId,
              headSequence,
              instances: [instanceId],
            }),
          ),
        "runner.events.subscribe": ({ afterSequence }) => {
          subscribedFrom.push(afterSequence);
          return Stream.concat(
            Stream.fromIterable(options.backlog.filter((entry) => entry.sequence > afterSequence)),
            Stream.fromPubSub(live),
          );
        },
        "runner.events.ack": ({ throughSequence }) =>
          Effect.sync(() => {
            acked.push(throughSequence);
            return { ackedSequence: throughSequence, retained: 0 };
          }),
        "runner.provider.listSessions": () => Effect.succeed(options.sessions ?? []),
      }),
    );
    return {
      url: served.url,
      push: (entry: RunnerEventEnvelope) => PubSub.publish(live, entry),
      subscribedFrom,
      acked,
    };
  });

const StoresLive = Layer.mergeAll(
  HubThreadMachineStateSqliteLive,
  ProviderSessionRuntime.layer,
).pipe(Layer.provideMerge(SqlitePersistenceMemory));

/** One hub lifetime: pool, registry and delivery over the shared stores. */
const startHub = (machine: FakeMachine) =>
  Effect.gen(function* () {
    const fake = yield* makeFakeMachineDirectory({ initial: [[threadId, machine]] });
    const pool = yield* makePool({
      wakePollInterval: "5 millis",
      idleCheckInterval: "1 hour",
    }).pipe(Effect.provideService(MachineDirectory, fake.directory));
    const registry = yield* RemoteSessionRegistry.make;
    const delivery = yield* RunnerEventDelivery.make.pipe(
      Effect.provideService(RunnerConnectionPool, pool),
      Effect.provideService(RemoteSessionRegistry.RemoteSessionRegistry, registry),
    );
    return { pool, registry, delivery, fake };
  });

const connect = (pool: RunnerConnectionPool["Service"]) =>
  pool.use(threadId, { wake: false, operation: "test.connect" }, () => Effect.void);

const takeEvents = (delivery: RunnerEventDelivery.RunnerEventDelivery["Service"], count: number) =>
  delivery.events.pipe(
    Stream.take(count),
    Stream.runCollect,
    Effect.map((events) => Array.from(events)),
    Effect.forkScoped,
  );

const session = (overrides: Partial<ProviderSession> = {}): ProviderSession => ({
  provider,
  providerInstanceId: instanceId,
  status: "running",
  runtimeMode: "full-access",
  threadId,
  activeTurnId: TurnId.make("turn-1"),
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
  ...overrides,
});

describe("RunnerEventDelivery", () => {
  it.live("delivers each event once and persists cursors only at turn boundaries", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const runner = yield* startRunner({
          bootId: "boot-1",
          backlog: [
            envelope(1, event("e1", "session.started")),
            envelope(2, event("e2", "turn.started")),
            envelope(3, event("e3", "content.delta")),
          ],
        });
        const hub = yield* startHub({ state: "running", runnerUrl: runner.url });
        const received = yield* takeEvents(hub.delivery, 4);
        yield* Effect.yieldNow;
        yield* hub.delivery.start;
        yield* connect(hub.pool);

        const cursors = yield* RunnerCursorStore;
        yield* Effect.repeat(hub.delivery.state, {
          until: (state) => state.get(threadId)?.delivered === 3,
        });
        yield* hub.delivery.flush({ minAgeMs: 0, drain: Effect.void });
        // The turn is open: only the event before it is durable.
        expect(Option.getOrThrow(yield* cursors.get(threadId))).toMatchObject({
          outboxId: "runner-test",
          bootId: "boot-1",
          ackedSequence: 1,
        });

        yield* runner.push(envelope(4, event("e4", "turn.completed")));
        const events = yield* Fiber.join(received);
        expect(events.map((value) => value.eventId)).toEqual(["e1", "e2", "e3", "e4"]);
        yield* hub.delivery.flush({ minAgeMs: 0, drain: Effect.void });
        expect(Option.getOrThrow(yield* cursors.get(threadId)).ackedSequence).toBe(4);
        yield* Effect.repeat(
          Effect.sync(() => runner.acked),
          {
            until: (acked) => acked.includes(4),
          },
        );
        expect(runner.acked).toEqual([1, 4]);
      }),
    ).pipe(Effect.provide(StoresLive)),
  );

  it.live("replays an open turn after a hub restart without re-delivering earlier events", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const backlog = [
          envelope(1, event("e1", "session.started")),
          envelope(2, event("e2", "turn.started")),
          envelope(3, event("e3", "content.delta")),
        ];
        const runner = yield* startRunner({ bootId: "boot-1", backlog });

        yield* Effect.scoped(
          Effect.gen(function* () {
            const first = yield* startHub({ state: "running", runnerUrl: runner.url });
            yield* first.delivery.start;
            yield* connect(first.pool);
            yield* Effect.repeat(first.delivery.state, {
              until: (state) => state.get(threadId)?.delivered === 3,
            });
            yield* first.delivery.flush({ minAgeMs: 0, drain: Effect.void });
          }),
        );

        const second = yield* startHub({ state: "running", runnerUrl: runner.url });
        const received = yield* takeEvents(second.delivery, 2);
        yield* Effect.yieldNow;
        yield* second.delivery.start;
        yield* connect(second.pool);
        const replayed = yield* Fiber.join(received);
        expect(runner.subscribedFrom).toEqual([0, 1]);
        expect(replayed.map((value) => value.eventId)).toEqual(["e2", "e3"]);
      }),
    ).pipe(Effect.provide(StoresLive)),
  );

  it.live("settles a turn whose session a restarted runner no longer hosts", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const runner = yield* startRunner({ bootId: "boot-2", backlog: [] });
        const hub = yield* startHub({ state: "running", runnerUrl: runner.url });
        yield* hub.registry.upsert({
          threadId,
          instanceId,
          provider,
          session: session(),
          bootId: "boot-1",
        });
        const received = yield* takeEvents(hub.delivery, 2);
        yield* Effect.yieldNow;
        yield* hub.delivery.start;
        yield* connect(hub.pool);
        const settled = yield* Fiber.join(received);
        expect(settled.map((value) => [value.type, value.eventId])).toEqual([
          ["turn.completed", `hub-reconcile:${threadId}:boot-2:turn-completed`],
          ["session.exited", `hub-reconcile:${threadId}:boot-2:session-exited`],
        ]);
        expect(settled[0]).toMatchObject({
          turnId: "turn-1",
          payload: { state: "interrupted" },
        });
        expect(Option.isNone(yield* hub.registry.get(threadId))).toBe(true);
      }),
    ).pipe(Effect.provide(StoresLive)),
  );

  it.live("adopts sessions a restarted runner still hosts", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const runner = yield* startRunner({
          bootId: "boot-2",
          backlog: [],
          sessions: [session()],
        });
        const hub = yield* startHub({ state: "running", runnerUrl: runner.url });
        yield* hub.registry.upsert({
          threadId,
          instanceId,
          provider,
          session: session(),
          bootId: "boot-1",
        });
        yield* hub.delivery.start;
        const connection = yield* hub.pool.use(
          threadId,
          { wake: false, operation: "test.connect" },
          (value) => Effect.succeed(value),
        );
        yield* hub.delivery.awaitReconciled(connection);
        expect(Option.getOrThrow(yield* hub.registry.get(threadId)).bootId).toBe("boot-2");
      }),
    ).pipe(Effect.provide(StoresLive)),
  );

  it.live("settles sessions when the directory reports their machine failed", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hub = yield* startHub({ state: "failed", detail: "host lost" });
        yield* hub.registry.upsert({
          threadId,
          instanceId,
          provider,
          session: session(),
          bootId: "boot-1",
        });
        const received = yield* takeEvents(hub.delivery, 2);
        yield* Effect.yieldNow;
        yield* hub.delivery.start;
        yield* connect(hub.pool).pipe(Effect.ignore);
        const settled = yield* Fiber.join(received);
        expect(settled.map((value) => value.type)).toEqual(["turn.completed", "session.exited"]);
        expect(settled[1]).toMatchObject({
          eventId: `hub-reconcile:${threadId}:lost:boot-1:session-exited`,
          payload: { recoverable: true },
        });
      }),
    ).pipe(Effect.provide(StoresLive)),
  );
});
