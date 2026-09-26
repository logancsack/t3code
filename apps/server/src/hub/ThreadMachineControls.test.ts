import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { type OrchestrationThreadShell, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { describe, expect } from "vite-plus/test";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { HubThreadMachineStateSqliteLive } from "../persistence/Layers/HubThreadMachineState.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ThreadMachineControls } from "../serverModeHooks.ts";
import {
  type FakeMachine,
  MachineDirectory,
  makeFakeMachineDirectory,
} from "./MachineDirectory.ts";
import { make as makePool, RunnerConnectionPool } from "./RunnerConnectionPool.ts";
import * as ThreadMachineControlsLayer from "./ThreadMachineControls.ts";
import * as ThreadMachineStates from "./ThreadMachineStates.ts";
import { fakeRunner, fakeRunnerHello, serveRunner } from "./testUtils/runnerServer.ts";

const threadId = ThreadId.make("thread-controls");

const StoreLayer = HubThreadMachineStateSqliteLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(NodeServices.layer),
);

const projectionsWith = (threads: ReadonlyArray<ThreadId>) =>
  Layer.succeed(
    ProjectionSnapshotQuery,
    ProjectionSnapshotQuery.of({
      getThreadShellById: (id: ThreadId) =>
        Effect.succeed(
          threads.includes(id)
            ? Option.some({ id } as unknown as OrchestrationThreadShell)
            : Option.none(),
        ),
    } as unknown as ProjectionSnapshotQuery["Service"]),
  );

const setup = (onWake: (runnerUrl: string) => FakeMachine) =>
  Effect.gen(function* () {
    const runner = yield* serveRunner(
      fakeRunner({
        "runner.hello": (input) => Effect.succeed(fakeRunnerHello({ threadId: input.threadId })),
      }),
    );
    const fake = yield* makeFakeMachineDirectory({
      initial: [[threadId, { state: "paused", bootId: "boot-1" }]],
      onWake: () => onWake(runner.url),
    });
    const directoryLayer = ThreadMachineStates.observedMachineDirectoryLayer.pipe(
      Layer.provide(Layer.succeed(MachineDirectory, fake.directory)),
      Layer.provideMerge(ThreadMachineStates.layer),
    );
    const context = yield* Layer.build(
      ThreadMachineControlsLayer.layer.pipe(
        Layer.provideMerge(
          Layer.effect(
            RunnerConnectionPool,
            makePool({ wakePollInterval: "5 millis", idleCheckInterval: "1 hour" }),
          ),
        ),
        Layer.provideMerge(directoryLayer),
        Layer.provide(projectionsWith([threadId])),
      ),
    );
    const controls = yield* ThreadMachineControls.pipe(Effect.provide(context));
    const pool = yield* RunnerConnectionPool.pipe(Effect.provide(context));
    const calls = fake.calls.pipe(
      Effect.map((entries) =>
        entries.map((call) => (call.wake ? `${call.method}+wake` : call.method)),
      ),
    );
    return { controls: controls!, pool, calls };
  });

describe("thread machine controls", () => {
  it.live("wakes a sleeping machine and releases it again", () =>
    Effect.gen(function* () {
      const { controls, pool, calls } = yield* setup((url) => ({
        state: "running",
        runnerUrl: url,
        bootId: "boot-1",
      }));
      const woken = yield* controls.wake(threadId);
      expect(woken?.state).toBe("running");
      expect(Option.isSome(yield* pool.current(threadId))).toBe(true);

      const paused = yield* controls.pause(threadId);
      expect(paused?.state).toBe("running");
      expect(Option.isNone(yield* pool.current(threadId))).toBe(true);
      expect(yield* calls).toEqual(["ensure+wake", "idle"]);
    }).pipe(Effect.scoped, Effect.provide(StoreLayer)),
  );

  it.live("refuses to release a machine while a turn runs", () =>
    Effect.gen(function* () {
      const { controls, pool } = yield* setup((url) => ({ state: "running", runnerUrl: url }));
      yield* pool.setBusy(threadId, "turn", true);
      const error = yield* controls.pause(threadId).pipe(Effect.flip);
      expect(error.reason).toBe("busy");
    }).pipe(Effect.scoped, Effect.provide(StoreLayer)),
  );

  it.live("reports failures and unknown threads with typed reasons", () =>
    Effect.gen(function* () {
      const { controls } = yield* setup(() => ({ state: "failed", detail: "No capacity" }));
      const failed = yield* controls.wake(threadId).pipe(Effect.flip);
      expect(failed).toMatchObject({ reason: "unavailable", state: "failed" });
      const missing = yield* controls.wake(ThreadId.make("thread-missing")).pipe(Effect.flip);
      expect(missing.reason).toBe("not-found");
      const signIn = yield* controls
        .pause(ThreadId.make("aldo-provider-sign-in"))
        .pipe(Effect.flip);
      expect(signIn.reason).toBe("not-found");
    }).pipe(Effect.scoped, Effect.provide(StoreLayer)),
  );
});
