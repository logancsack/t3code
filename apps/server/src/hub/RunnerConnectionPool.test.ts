import { it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import { RunnerThreadMismatchError, type ThreadMachineStatus } from "@t3tools/contracts/runner";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import {
  type FakeMachine,
  MachineDirectory,
  makeFakeMachineDirectory,
} from "./MachineDirectory.ts";
import { make as makePool, type RunnerConnectionPoolOptions } from "./RunnerConnectionPool.ts";
import { fakeRunner, fakeRunnerHello, serveRunner } from "./testUtils/runnerServer.ts";

const threadId = ThreadId.make("thread-pool");

/** A fake runner for `threadId` that answers the handshake and counts connections. */
const startRunner = (options?: { readonly bootId?: string; readonly serves?: ThreadId }) =>
  Effect.gen(function* () {
    let hellos = 0;
    const served = yield* serveRunner(
      fakeRunner({
        "runner.hello": (input) =>
          Effect.suspend(() => {
            hellos += 1;
            const serves = options?.serves ?? input.threadId;
            return serves === input.threadId
              ? Effect.succeed(
                  fakeRunnerHello({ threadId: serves, bootId: options?.bootId ?? "boot-1" }),
                )
              : Effect.fail(
                  new RunnerThreadMismatchError({
                    requestedThreadId: input.threadId,
                    runnerThreadId: serves,
                  }),
                );
          }),
      }),
    );
    return { url: served.url, hellos: () => hellos };
  });

const setup = (
  machine: FakeMachine | undefined,
  options: RunnerConnectionPoolOptions & {
    readonly onWake?: (current: FakeMachine | undefined) => FakeMachine;
  } = {},
) =>
  Effect.gen(function* () {
    const fake = yield* makeFakeMachineDirectory({
      ...(machine ? { initial: [[threadId, machine]] } : {}),
      ...(options.onWake ? { onWake: (_threadId, current) => options.onWake!(current) } : {}),
    });
    const pool = yield* makePool({
      wakePollInterval: "5 millis",
      idleCheckInterval: "1 hour",
      ...options,
    }).pipe(Effect.provideService(MachineDirectory, fake.directory));
    return { pool, fake };
  });

const callsOf = (fake: {
  readonly calls: Effect.Effect<
    ReadonlyArray<{ readonly method: string; readonly wake?: boolean }>
  >;
}) =>
  fake.calls.pipe(
    Effect.map((calls) => calls.map((call) => (call.wake ? `${call.method}+wake` : call.method))),
  );

describe("RunnerConnectionPool wake semantics", () => {
  it.live("never wakes a sleeping machine for a read and reports it asleep", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { pool, fake } = yield* setup({ state: "paused", bootId: "boot-1" });
        const error = yield* pool
          .use(threadId, { wake: false, operation: "vcs.status" }, () => Effect.void)
          .pipe(Effect.flip);
        expect(error).toMatchObject({
          _tag: "ThreadMachineUnavailableError",
          reason: "asleep",
          state: "paused",
          operation: "vcs.status",
        });
        expect(yield* callsOf(fake)).toEqual(["status"]);
      }),
    ),
  );

  it.live("wakes a sleeping machine for an action, connects, and reuses the connection", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const runner = yield* startRunner();
        const { pool, fake } = yield* setup(
          { state: "saved" },
          { onWake: () => ({ state: "running", runnerUrl: runner.url, bootId: "boot-1" }) },
        );
        const first = yield* pool.use(
          threadId,
          { wake: true, operation: "provider.sendTurn" },
          (connection) => Effect.succeed(connection.hello.bootId),
        );
        const second = yield* pool.use(
          threadId,
          { wake: false, operation: "vcs.status" },
          (connection) => Effect.succeed(connection.hello.threadId),
        );
        expect(first).toBe("boot-1");
        expect(second).toBe(threadId);
        expect(runner.hellos()).toBe(1);
        expect(yield* callsOf(fake)).toEqual(["ensure+wake"]);
        expect(Option.isSome(yield* pool.current(threadId))).toBe(true);
      }),
    ),
  );

  it.live("waits through starting states, reporting progress, until the runner is up", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const runner = yield* startRunner();
        const { pool, fake } = yield* setup(
          { state: "paused" },
          { onWake: () => ({ state: "starting" }) },
        );
        const progress: Array<ThreadMachineStatus["state"]> = [];
        let polls = 0;
        const fiber = yield* pool
          .use(
            threadId,
            {
              wake: true,
              operation: "terminal.open",
              onWakeProgress: (status) =>
                Effect.suspend(() => {
                  progress.push(status.state);
                  polls += 1;
                  return polls === 3
                    ? fake.set(threadId, { state: "running", runnerUrl: runner.url })
                    : Effect.void;
                }),
            },
            () => Effect.succeed("connected"),
          )
          .pipe(Effect.forkChild);
        expect(yield* Fiber.join(fiber)).toBe("connected");
        expect(progress).toEqual(["starting", "starting", "starting"]);
        expect((yield* callsOf(fake)).filter((call) => call === "status")).toHaveLength(3);
      }),
    ),
  );

  it.live("fails with a wake timeout when the machine never starts", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { pool } = yield* setup(
          { state: "paused" },
          {
            onWake: () => ({ state: "starting", detail: "restoring snapshot" }),
            wakeTimeout: "30 millis",
          },
        );
        const error = yield* pool
          .use(threadId, { wake: true, operation: "provider.sendTurn" }, () => Effect.void)
          .pipe(Effect.flip);
        expect(error).toMatchObject({ reason: "wake-timeout", state: "starting" });
        expect(error.detail).toContain("restoring snapshot");
      }),
    ),
  );

  it.live("reports a failed machine as failed and announces it lost", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { pool } = yield* setup({ state: "failed", detail: "disk full" });
        const lost = yield* Deferred.make<string>();
        yield* pool.lifecycle.pipe(
          Stream.runForEach((event) =>
            event._tag === "lost" ? Deferred.succeed(lost, event.status.state) : Effect.void,
          ),
          Effect.forkScoped,
        );
        yield* Effect.yieldNow;
        const error = yield* pool
          .use(threadId, { wake: false, operation: "vcs.status" }, () => Effect.void)
          .pipe(Effect.flip);
        expect(error).toMatchObject({ reason: "failed", detail: "disk full" });
        expect(yield* Deferred.await(lost)).toBe("failed");
      }),
    ),
  );

  it.live("refuses a runner that serves another thread", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const runner = yield* startRunner({ serves: ThreadId.make("other-thread") });
        const { pool } = yield* setup({ state: "running", runnerUrl: runner.url });
        const error = yield* pool
          .use(threadId, { wake: false, operation: "vcs.status" }, () => Effect.void)
          .pipe(Effect.flip);
        expect(error).toMatchObject({ reason: "incompatible" });
        expect(Option.isNone(yield* pool.current(threadId))).toBe(true);
      }),
    ),
  );

  it.live("shares one connection attempt between concurrent callers", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const runner = yield* startRunner();
        const { pool, fake } = yield* setup(
          { state: "paused" },
          { onWake: () => ({ state: "running", runnerUrl: runner.url }) },
        );
        const results = yield* Effect.all(
          [1, 2, 3].map(() =>
            pool.use(threadId, { wake: true, operation: "provider.sendTurn" }, (connection) =>
              Effect.succeed(connection.hello.runnerId),
            ),
          ),
          { concurrency: "unbounded" },
        );
        expect(results).toEqual(["runner-test", "runner-test", "runner-test"]);
        expect(runner.hellos()).toBe(1);
        expect(yield* callsOf(fake)).toEqual(["ensure+wake"]);
      }),
    ),
  );

  it.live("closes idle connections and tells the directory; busy threads stay connected", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const runner = yield* startRunner();
        const { pool, fake } = yield* setup(
          { state: "running", runnerUrl: runner.url },
          { idleTimeout: "0 millis" },
        );
        yield* pool.use(threadId, { wake: false, operation: "vcs.status" }, () => Effect.void);

        yield* pool.setBusy(threadId, "turn", true);
        yield* pool.sweepIdle;
        expect(Option.isSome(yield* pool.current(threadId))).toBe(true);

        yield* pool.setBusy(threadId, "turn", false);
        yield* pool.sweepIdle;
        expect(Option.isNone(yield* pool.current(threadId))).toBe(true);
        expect(yield* callsOf(fake)).toEqual(["status", "idle"]);
      }),
    ),
  );
});
