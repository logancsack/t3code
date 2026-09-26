import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ThreadId, type VcsStatusStreamEvent } from "@t3tools/contracts";
import { threadCheckoutPath } from "@t3tools/contracts/runner";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import { CheckpointStore } from "../checkpointing/CheckpointStore.ts";
import { checkpointRefForThreadTurn } from "../checkpointing/Utils.ts";
import { HubThreadMachineStateSqliteLive } from "../persistence/Layers/HubThreadMachineState.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import {
  CheckpointTurnDiffStore,
  ThreadVcsStatusStore,
} from "../persistence/Services/HubThreadMachineState.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import { VcsStatusBroadcaster } from "../vcs/VcsStatusBroadcaster.ts";
import { WorkspaceEntries } from "../workspace/WorkspaceEntries.ts";
import { WorkspaceFileSystem } from "../workspace/WorkspaceFileSystem.ts";
import { hubTerminalManagerLayer } from "./HubTerminals.ts";
import { hubVcsStatusBroadcasterLayer, hubVcsStatusCacheLayer } from "./HubVcs.ts";
import {
  hubCheckpointStoreLayer,
  hubWorkspaceEntriesLayer,
  hubWorkspaceFileSystemLayer,
} from "./HubWorkspace.ts";
import {
  type FakeMachine,
  MachineDirectory,
  makeFakeMachineDirectory,
} from "./MachineDirectory.ts";
import { make as makePool, RunnerConnectionPool } from "./RunnerConnectionPool.ts";
import { fakeRunner, fakeRunnerHello, serveRunner } from "./testUtils/runnerServer.ts";

type RunnerOverrides = Parameters<typeof fakeRunner>[0];

const threadId = ThreadId.make("thread-services");
const cwd = threadCheckoutPath(threadId);
const ref = (turn: number) => checkpointRefForThreadTurn(threadId, turn);

const local = {
  isRepo: true,
  hasPrimaryRemote: true,
  isDefaultRef: false,
  refName: "t3/work",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
};

/**
 * Hub checkout services over a fake directory and a fake runner. The machine
 * wakes to the runner; `calls` records every runner RPC by name.
 */
const setup = (machine: Omit<FakeMachine, "runnerUrl">, overrides: RunnerOverrides = {}) =>
  Effect.gen(function* () {
    const calls: Array<string> = [];
    const record =
      <A extends ReadonlyArray<unknown>, R>(name: string, f: (...args: A) => R) =>
      (...args: A) => {
        calls.push(name);
        return f(...args);
      };
    const wrapped = Object.fromEntries(
      Object.entries(overrides).map(([name, handler]) => [
        name,
        record(name, handler as (...args: ReadonlyArray<unknown>) => unknown),
      ]),
    ) as RunnerOverrides;
    const runner = yield* serveRunner(
      fakeRunner({
        "runner.hello": (input) => Effect.succeed(fakeRunnerHello({ threadId: input.threadId })),
        ...wrapped,
      }),
    );
    const fake = yield* makeFakeMachineDirectory({
      initial: [
        [threadId, machine.state === "running" ? { ...machine, runnerUrl: runner.url } : machine],
      ],
      onWake: () => ({ state: "running", runnerUrl: runner.url }),
    });
    const pool = yield* makePool({
      wakePollInterval: "5 millis",
      idleCheckInterval: "1 hour",
    }).pipe(Effect.provideService(MachineDirectory, fake.directory));
    const services = yield* Layer.build(
      Layer.mergeAll(
        hubCheckpointStoreLayer,
        hubWorkspaceEntriesLayer,
        hubWorkspaceFileSystemLayer,
        hubTerminalManagerLayer,
        hubVcsStatusBroadcasterLayer.pipe(Layer.provideMerge(hubVcsStatusCacheLayer)),
      ).pipe(Layer.provide(Layer.succeed(RunnerConnectionPool, pool))),
    );
    const directoryCalls = fake.calls.pipe(
      Effect.map((entries) =>
        entries.map((call) => (call.wake ? `${call.method}+wake` : call.method)),
      ),
    );
    return { services, pool, calls, directoryCalls };
  });

const TestLayer = HubThreadMachineStateSqliteLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(NodeServices.layer),
);

describe("hub checkout services", () => {
  it.live("serves captured diffs without waking and fetches a missing diff once", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { services, calls, directoryCalls } = yield* setup(
          { state: "paused" },
          { "runner.checkpoint.diff": () => Effect.succeed("diff --git a/x b/x\n") },
        );
        const store = yield* CheckpointTurnDiffStore;
        yield* store.put({
          threadId,
          fromTurnCount: 0,
          toTurnCount: 1,
          ignoreWhitespace: true,
          diff: "cached patch",
          createdAt: "t",
        });
        const checkpointStore = Context.get(services, CheckpointStore);
        const diff = (from: number, to: number) =>
          checkpointStore.diffCheckpoints({
            cwd,
            fromCheckpointRef: ref(from),
            toCheckpointRef: ref(to),
            ignoreWhitespace: true,
          });

        expect(yield* diff(0, 1)).toBe("cached patch");
        expect(yield* directoryCalls).toEqual([]);

        expect(yield* diff(1, 2)).toBe("diff --git a/x b/x\n");
        expect(yield* diff(1, 2)).toBe("diff --git a/x b/x\n");
        expect(calls).toEqual(["runner.checkpoint.diff"]);
        expect(yield* directoryCalls).toEqual(["ensure+wake"]);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.live("recapturing a checkpoint invalidates its diffs and precomputes new ones", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { services, calls } = yield* setup(
          { state: "running" },
          {
            "runner.checkpoint.capture": () => Effect.void,
            "runner.checkpoint.diff": (input) =>
              Effect.succeed(
                `new ${input.fromCheckpointRef.slice(-1)}-${input.toCheckpointRef.slice(-1)}`,
              ),
          },
        );
        const store = yield* CheckpointTurnDiffStore;
        yield* store.put({
          threadId,
          fromTurnCount: 1,
          toTurnCount: 2,
          ignoreWhitespace: true,
          diff: "stale",
          createdAt: "t",
        });
        const checkpointStore = Context.get(services, CheckpointStore);
        yield* checkpointStore.captureCheckpoint({ cwd, checkpointRef: ref(2) });
        const key = { threadId, fromTurnCount: 1, toTurnCount: 2, ignoreWhitespace: true };
        const refreshed = yield* Effect.repeat(store.get(key), {
          until: (value) => Option.isSome(value) && value.value !== "stale",
        });
        expect(Option.getOrThrow(refreshed)).toBe("new 1-2");
        yield* Effect.repeat(
          Effect.sync(() => calls.length),
          { until: (count) => count >= 5 },
        );
        expect(calls.filter((name) => name === "runner.checkpoint.diff")).toHaveLength(4);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.live("streams cached git status for a sleeping machine without waking it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { services, directoryCalls } = yield* setup({ state: "paused" });
        yield* (yield* ThreadVcsStatusStore).put({ threadId, local, remote: null, updatedAt: "t" });
        const broadcaster = Context.get(services, VcsStatusBroadcaster);
        const [first] = yield* broadcaster
          .streamStatus({ cwd })
          .pipe(Stream.take(1), Stream.runCollect);
        expect(first).toEqual({ _tag: "snapshot", local, remote: null });
        expect((yield* broadcaster.refreshStatus(cwd)).refName).toBe("t3/work");
        expect(yield* directoryCalls).toEqual(["status"]);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.live("forwards status a connected runner pushes and persists it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const pushed = yield* PubSub.unbounded<VcsStatusStreamEvent>();
        const { services, pool } = yield* setup(
          { state: "running" },
          { "runner.vcs.streamStatus": () => Stream.fromPubSub(pushed) },
        );
        const broadcaster = Context.get(services, VcsStatusBroadcaster);
        const received = yield* broadcaster
          .streamStatus({ cwd })
          .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped);
        yield* Effect.yieldNow;
        yield* pool.use(threadId, { wake: false, operation: "test.connect" }, () => Effect.void);
        yield* Effect.repeat(PubSub.publish(pushed, { _tag: "snapshot", local, remote: null }), {
          until: () => received.pollUnsafe() !== undefined,
        });
        expect(Array.from(yield* Fiber.join(received))).toEqual([
          { _tag: "snapshot", local, remote: null },
        ]);
        const persisted = yield* (yield* ThreadVcsStatusStore).list();
        expect(persisted.map((row) => row.local.refName)).toEqual(["t3/work"]);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.live("reads never wake a machine; writes do", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { services, calls, directoryCalls } = yield* setup(
          { state: "paused" },
          {
            "runner.workspace.writeFile": (input) =>
              Effect.succeed({ relativePath: input.relativePath }),
          },
        );
        const files = Context.get(services, WorkspaceFileSystem);
        const readError = yield* files
          .readFile({ cwd, relativePath: "README.md" })
          .pipe(Effect.flip);
        expect(readError).toMatchObject({
          _tag: "WorkspaceFileSystemOperationError",
          cause: { _tag: "ThreadMachineUnavailableError", reason: "asleep" },
        });
        expect(yield* directoryCalls).toEqual(["status"]);

        yield* files.writeFile({ cwd, relativePath: "notes.txt", contents: "hi" });
        expect(calls).toEqual(["runner.workspace.writeFile"]);
        expect(yield* directoryCalls).toEqual(["status", "ensure+wake"]);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.live("never routes a path that is not a thread checkout", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { services, directoryCalls } = yield* setup({ state: "running" });
        const entries = Context.get(services, WorkspaceEntries);
        const error = yield* entries
          .search({ cwd: "/home/user/project", query: "readme", limit: 10 })
          .pipe(Effect.flip);
        expect(error).toMatchObject({
          cause: { _tag: "ThreadMachineUnavailableError", reason: "not-a-thread-checkout" },
        });
        expect(yield* directoryCalls).toEqual([]);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.live("terminal input needs a running machine; opening a terminal wakes it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { services, calls, directoryCalls } = yield* setup(
          { state: "paused" },
          {
            "runner.terminal.open": (input) =>
              Effect.succeed({
                threadId: input.threadId,
                terminalId: input.terminalId,
                cwd: input.cwd,
                worktreePath: null,
                status: "running",
                pid: 42,
                history: "",
                exitCode: null,
                exitSignal: null,
                label: "bash",
                updatedAt: "t",
              }),
          },
        );
        const terminals = Context.get(services, TerminalManager.TerminalManager);
        const writeError = yield* terminals
          .write({ threadId, terminalId: "t1", data: "ls\r" })
          .pipe(Effect.flip);
        expect(writeError._tag).toBe("TerminalNotRunningError");
        yield* terminals.close({ threadId, terminalId: "t1" });
        expect(yield* directoryCalls).toEqual(["status"]);

        const opened = yield* terminals.open({ threadId, terminalId: "t1", cwd });
        expect(opened.pid).toBe(42);
        expect(calls).toEqual(["runner.terminal.open"]);
        expect(yield* directoryCalls).toEqual(["status", "ensure+wake"]);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );
});
