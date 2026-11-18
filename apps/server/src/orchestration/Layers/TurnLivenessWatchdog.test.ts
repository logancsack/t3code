import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId, TurnId, type ProviderRuntimeEvent } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ServerActivation } from "../../serverActivation.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { TurnLivenessWatchdog } from "../Services/TurnLivenessWatchdog.ts";
import { makeTurnLivenessWatchdogLive } from "./TurnLivenessWatchdog.ts";

const threadId = ThreadId.make("thread-watchdog");
const turnId = TurnId.make("turn-watchdog");

interface Dispatched {
  readonly type: string;
  readonly admitted: boolean;
}

/** A thread whose turn runs until the watchdog interrupts it. */
const watchdogHarness = (input: { readonly seeded: boolean }) =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const dispatched: Array<Dispatched> = [];
    let admitting = false;
    let turnState: "running" | "interrupted" = "running";
    const thread = () => ({
      id: threadId,
      latestTurn: {
        turnId,
        state: turnState,
        requestedAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: null,
      },
      session: null,
      latestUserMessageAt: null,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
    });
    const layer = makeTurnLivenessWatchdogLive({
      modelSilenceMs: 1_000,
      recoveryGraceMs: 500,
      sweepIntervalMs: 100,
      retryDelayMs: 100,
      maxAutoRetries: 1,
      enabled: true,
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(ProviderService)({ streamEvents: Stream.fromQueue(events) }),
          Layer.mock(OrchestrationEngineService)({
            dispatch: (command) =>
              Effect.sync(() => {
                dispatched.push({ type: command.type, admitted: admitting });
                if (command.type === "thread.turn.interrupt") turnState = "interrupted";
                return { sequence: dispatched.length };
              }),
          }),
          Layer.mock(ProjectionSnapshotQuery)({
            getShellSnapshot: () =>
              Effect.sync(() => ({ threads: input.seeded ? [thread()] : [] }) as never),
            getThreadShellById: () => Effect.sync(() => Option.some(thread() as never)),
          }),
          NodeServices.layer,
        ),
      ),
    );
    const admitRetry = <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.sync(() => {
        admitting = true;
      }).pipe(
        Effect.andThen(effect),
        Effect.ensuring(
          Effect.sync(() => {
            admitting = false;
          }),
        ),
      );
    return { events, dispatched, layer, admitRetry };
  });

const advance = (ms: number) =>
  Effect.forEach(
    Array.from({ length: ms / 100 }),
    () => TestClock.adjust("100 millis").pipe(Effect.andThen(Effect.yieldNow)),
    { discard: true },
  );

it.effect("the watchdog runs its automatic retry through admitRetry", () =>
  Effect.gen(function* () {
    const harness = yield* watchdogHarness({ seeded: false });
    yield* Effect.gen(function* () {
      const watchdog = yield* TurnLivenessWatchdog;
      yield* watchdog.start({ admitRetry: harness.admitRetry });
      yield* Effect.yieldNow;
      yield* Queue.offer(harness.events, {
        type: "turn.started",
        threadId,
        turnId,
        payload: {},
      } as unknown as ProviderRuntimeEvent);
      yield* advance(1_500);

      // The stall's interrupt isn't a turn start; the retry is.
      assert.deepEqual(harness.dispatched, [
        { type: "thread.activity.append", admitted: false },
        { type: "thread.turn.interrupt", admitted: false },
        { type: "thread.activity.append", admitted: true },
        { type: "thread.turn.retry", admitted: true },
      ]);
    }).pipe(Effect.provide(harness.layer), Effect.scoped);
  }),
);

it.effect("the watchdog stays parked until the server's activation", () =>
  Effect.gen(function* () {
    const harness = yield* watchdogHarness({ seeded: true });
    const activation = yield* Deferred.make<void>();
    yield* Effect.gen(function* () {
      const watchdog = yield* TurnLivenessWatchdog;
      yield* watchdog
        .start()
        .pipe(Effect.provideService(ServerActivation, Deferred.await(activation)));
      // The turn it took over from the last server is long past its grace.
      yield* advance(1_000);
      assert.deepEqual(harness.dispatched, []);

      yield* Deferred.succeed(activation, undefined);
      yield* advance(100);
      assert.deepEqual(harness.dispatched, [
        { type: "thread.activity.append", admitted: false },
        { type: "thread.turn.interrupt", admitted: false },
      ]);
    }).pipe(Effect.provide(harness.layer), Effect.scoped);
  }),
);
