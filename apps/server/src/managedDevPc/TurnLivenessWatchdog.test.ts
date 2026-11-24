import { assert, expect, it } from "@effect/vitest";
import {
  RunId,
  ThreadId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as TurnLivenessWatchdog from "./TurnLivenessWatchdog.ts";
import { stallReasonOf } from "./turnStall.ts";

const threadId = ThreadId.make("thread-1");
const run = RunId.make("run-1");
const options = { silenceMs: 600_000, resumeGraceMs: 90_000, maxAutoRetries: 1 };

const runningShell = (runId: RunId, overrides: Partial<OrchestrationV2ThreadShell> = {}) =>
  ({
    id: threadId,
    status: "running",
    activeRunId: runId,
    latestRunId: runId,
    activityRunStatus: "running",
    pendingRuntimeRequest: null,
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  }) as OrchestrationV2ThreadShell;

const interruptedShell = (runId: RunId) =>
  runningShell(runId, { status: "interrupted", activeRunId: null, activityRunStatus: null });

/** The watchdog over one thread the test moves by hand, with every command it sends. */
const harness = Effect.gen(function* () {
  const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  const state = {
    shell: runningShell(run),
    items: [] as ReadonlyArray<{ readonly type: string; readonly status: string }>,
    commands: [] as OrchestrationV2ServerCommand[],
  };
  const sweep = yield* TurnLivenessWatchdog.make(options).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () => Effect.succeed(state.shell),
          getThreadRecords: () => Effect.succeed({ turnItems: state.items } as never),
          dispatch: (command) => {
            state.commands.push(command);
            return Effect.succeed({ sequence: state.commands.length, storedEvents: [] });
          },
        }),
        Layer.mock(Orchestrator.OrchestratorV2)({ streamDomainEvents: Stream.fromQueue(events) }),
      ),
    ),
  );
  /** Time passing as the scheduler sees it: a look every five seconds. */
  const later = Effect.fn("test.later")(function* (seconds: number) {
    for (let elapsed = 0; elapsed < seconds; elapsed += 5) {
      yield* TestClock.adjust("5 seconds");
      yield* sweep();
    }
  });
  /** A sign of life from the thread, then none for `seconds`. */
  const silentFor = Effect.fn("test.silentFor")(function* (seconds: number) {
    yield* Queue.offer(events, { threadId, type: "turn-item.updated", payload: {} } as never);
    yield* later(seconds);
  });
  return { events, state, sweep, silentFor, later };
});

it.effect("interrupts a turn its model left silent and continues it, within its retries", () =>
  Effect.gen(function* () {
    const { events, state, silentFor, later } = yield* harness;
    yield* silentFor(595);
    assert.deepStrictEqual(state.commands, []);
    yield* later(5);
    assert.strictEqual(state.commands.length, 1);
    const stop = state.commands[0]!;
    assert.strictEqual(stop.type, "run.interrupt");
    if (stop.type !== "run.interrupt") return;
    assert.strictEqual(stop.runId, run);
    assert.strictEqual(stallReasonOf(stop.reason ?? ""), "model-silence");

    // The stop has not landed yet, so nothing is continued.
    yield* later(30);
    assert.strictEqual(state.commands.length, 1);
    state.shell = interruptedShell(run);
    yield* later(5);
    expect(state.commands[1]).toMatchObject({
      type: "message.dispatch",
      manualContinuationOfRunId: run,
      dispatchMode: { type: "start_immediately" },
    });

    // The continuation stalls too: it is stopped, and the thread's one retry is spent.
    const second = RunId.make("run-2");
    state.shell = runningShell(second);
    yield* silentFor(600);
    expect(state.commands[2]).toMatchObject({ type: "run.interrupt", runId: second });
    state.shell = interruptedShell(second);
    yield* later(60);
    assert.strictEqual(state.commands.length, 3);

    // A turn that completes earns the retry back.
    const third = RunId.make("run-3");
    yield* Queue.offer(events, {
      threadId,
      type: "run.updated",
      payload: { status: "completed" },
    } as never);
    state.shell = runningShell(third);
    yield* silentFor(600);
    state.shell = interruptedShell(third);
    yield* later(30);
    expect(state.commands[4]).toMatchObject({
      type: "message.dispatch",
      manualContinuationOfRunId: third,
    });
  }).pipe(Effect.scoped),
);

it.effect("leaves a continuation to whoever moved the thread on first", () =>
  Effect.gen(function* () {
    const { state, silentFor, later } = yield* harness;
    yield* silentFor(600);
    assert.strictEqual(state.commands.length, 1);
    // The user sent a new message while the stop landed.
    state.shell = runningShell(RunId.make("run-user"));
    yield* later(30);
    assert.strictEqual(state.commands.length, 1);
  }).pipe(Effect.scoped),
);

it.effect.each([
  ["a question to the user", { pendingRuntimeRequest: { kind: "user_input" } as never }, []],
  ["a tool call in flight", {}, [{ type: "command_execution", status: "running" }]],
  ["background work", { pendingBackgroundTasks: [{ kind: "subagent" }] as never }, []],
  ["a run waiting on something else", { activityRunStatus: "waiting" as const }, []],
] as const)("never times out %s", ([, shell, items]) =>
  Effect.gen(function* () {
    const { state, silentFor, later } = yield* harness;
    state.shell = runningShell(run, shell);
    state.items = items;
    yield* silentFor(3600);
    yield* later(3600);
    assert.deepStrictEqual(state.commands, []);
    // Once that wait is over and the model says nothing, it is a stall again.
    state.shell = runningShell(run);
    state.items = [];
    yield* silentFor(600);
    assert.strictEqual(state.commands[0]?.type, "run.interrupt");
  }).pipe(Effect.scoped),
);

it.effect("gives a turn a short grace after the machine was paused, then names the pause", () =>
  Effect.gen(function* () {
    const { state, sweep, silentFor, later } = yield* harness;
    yield* silentFor(5);
    // Eight hours pass in one step: the machine slept, the provider did not go quiet.
    yield* TestClock.adjust("8 hours");
    yield* sweep();
    yield* later(85);
    assert.deepStrictEqual(state.commands, []);
    yield* later(5);
    const stop = state.commands[0];
    assert.strictEqual(stop?.type, "run.interrupt");
    if (stop?.type !== "run.interrupt") return;
    assert.strictEqual(stallReasonOf(stop.reason ?? ""), "suspend-silence");
  }).pipe(Effect.scoped),
);
