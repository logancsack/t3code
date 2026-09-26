import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import { HubThreadMachineStateSqliteLive } from "../persistence/Layers/HubThreadMachineState.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ThreadMachineStatusReader } from "../serverModeHooks.ts";
import { MachineDirectory, makeFakeMachineDirectory } from "./MachineDirectory.ts";
import * as ThreadMachineStates from "./ThreadMachineStates.ts";
import { threadMachineStateActivity } from "./threadMachineActivity.ts";

const threadId = ThreadId.make("thread-states");

const StoreLayer = HubThreadMachineStateSqliteLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(NodeServices.layer),
);

describe("thread machine states", () => {
  it.effect("records transitions once, keeps progress, and survives a restart", () =>
    Effect.gen(function* () {
      const states = yield* ThreadMachineStates.make;
      const changes = yield* states.changes.pipe(
        Stream.take(5),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;

      yield* states.observe(threadId, { state: "preparing", detail: "Building…" });
      yield* states.observe(threadId, { state: "preparing", detail: "Building…" });
      yield* states.observe(threadId, { state: "preparing", detail: "Waiting for a machine…" });
      yield* states.observe(threadId, { state: "running", bootId: "boot-1", detail: "up" });
      yield* states.observe(threadId, { state: "running", bootId: "boot-1", detail: "still up" });
      yield* states.observe(threadId, { state: "paused", detail: null });
      yield* states.observe(threadId, { state: "running", bootId: "boot-2" });

      const recorded = [...(yield* Fiber.join(changes))].map((change) => [
        change.current.state,
        change.current.detail,
        change.current.bootId,
      ]);
      expect(recorded).toEqual([
        ["preparing", "Building…", null],
        ["preparing", "Waiting for a machine…", null],
        ["running", "up", "boot-1"],
        ["paused", null, "boot-1"],
        ["running", null, "boot-2"],
      ]);
      expect(states.get(threadId)?.state).toBe("running");

      // A new instance on the same store starts from the persisted state.
      const reloaded = yield* ThreadMachineStates.make;
      expect(reloaded.get(threadId)).toMatchObject({ state: "running", bootId: "boot-2" });
      yield* reloaded.remove(threadId);
      expect((yield* ThreadMachineStates.make).get(threadId)).toBeNull();
    }).pipe(Effect.scoped, Effect.provide(StoreLayer)),
  );

  it.effect("observes directory responses and exposes them to thread shells", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeMachineDirectory({
        initial: [[threadId, { state: "paused", bootId: "boot-a" }]],
        onWake: () => ({ state: "running", runnerUrl: "ws://127.0.0.1:1", bootId: "boot-a" }),
      });
      const layer = Layer.mergeAll(
        ThreadMachineStates.observedMachineDirectoryLayer,
        ThreadMachineStates.readerLayer,
      ).pipe(
        Layer.provideMerge(ThreadMachineStates.layer),
        Layer.provide(Layer.succeed(MachineDirectory, fake.directory)),
      );
      yield* Effect.gen(function* () {
        const directory = yield* MachineDirectory;
        const reader = yield* ThreadMachineStatusReader;
        expect(reader.get(threadId)).toBeNull();

        yield* directory.status(threadId);
        expect(reader.get(threadId)).toMatchObject({ state: "paused", detail: null });

        yield* directory.ensure(threadId, {
          projectId: null,
          repository: null,
          branch: null,
          checkout: "/workspace/t/thread-states",
          wake: true,
        });
        expect(reader.get(threadId)?.state).toBe("running");

        yield* directory.release(threadId);
        expect(reader.get(threadId)?.state).toBe("none");
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.scoped, Effect.provide(StoreLayer)),
  );

  it("describes each state as an activity with an error tone only for failures", () => {
    expect(threadMachineStateActivity({ state: "running", detail: null, bootId: "b" })).toEqual({
      kind: "thread-machine.state",
      summary: "Machine running",
      tone: "info",
      payload: { state: "running", detail: null, bootId: "b" },
    });
    expect(
      threadMachineStateActivity({ state: "failed", detail: "No capacity", bootId: null }).tone,
    ).toBe("error");
  });
});
