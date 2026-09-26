/**
 * ThreadMachineStates - the latest machine state the hub knows per thread.
 *
 * Every machine directory response (ensure, status, wake polls) passes
 * through `observe`, and a released machine is recorded as `none`. A change of
 * state or boot, or new progress while a machine is coming up or failed, is
 * persisted (`ThreadMachineStatusStore`, so a restarted hub still shows it)
 * and published on `changes`. `HubRunnerLifecycle` turns each change into a
 * `thread-machine.state` activity; that domain event is what makes the shell
 * stream re-read the thread, and thread shells read `machine` from here
 * (`ThreadMachineStatusReader`), so the snapshot and every shell upsert carry
 * the new state.
 *
 * @module hub/ThreadMachineStates
 */
import {
  type ThreadId,
  type ThreadMachineState,
  type ThreadMachineStatus as ThreadShellMachineStatus,
} from "@t3tools/contracts";
import type { ThreadMachineStatus as DirectoryMachineStatus } from "@t3tools/contracts/runner";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import {
  ThreadMachineStatusStore,
  type ThreadMachineStatusRow,
} from "../persistence/Services/HubThreadMachineState.ts";
import { ThreadMachineStatusReader } from "../serverModeHooks.ts";
import { MachineDirectory } from "./MachineDirectory.ts";

export interface ThreadMachineStateEntry {
  readonly state: ThreadMachineState;
  readonly detail: string | null;
  readonly bootId: string | null;
  readonly updatedAt: string;
}

export interface ThreadMachineStateChange {
  readonly threadId: ThreadId;
  readonly previous: ThreadMachineStateEntry | null;
  readonly current: ThreadMachineStateEntry;
}

export interface ThreadMachineStatesShape {
  /** The latest known state; synchronous so shell mapping can read it. */
  readonly get: (threadId: ThreadId) => ThreadMachineStateEntry | null;
  readonly list: Effect.Effect<ReadonlyArray<readonly [ThreadId, ThreadMachineStateEntry]>>;
  /** Records a directory response; publishes a change when it is one. */
  readonly observe: (threadId: ThreadId, status: DirectoryMachineStatus) => Effect.Effect<void>;
  /** Forgets a deleted thread. */
  readonly remove: (threadId: ThreadId) => Effect.Effect<void>;
  readonly changes: Stream.Stream<ThreadMachineStateChange>;
}

export class ThreadMachineStates extends Context.Service<
  ThreadMachineStates,
  ThreadMachineStatesShape
>()("t3/hub/ThreadMachineStates") {}

/** States in which progress detail is worth recording as it changes. */
const PROGRESS_STATES: ReadonlySet<ThreadMachineState> = new Set([
  "preparing",
  "starting",
  "failed",
]);

/** Whether `next` differs from `previous` in a way thread activity should record. */
export const isThreadMachineStateChange = (
  previous: ThreadMachineStateEntry | null,
  next: Omit<ThreadMachineStateEntry, "updatedAt">,
): boolean =>
  previous === null ||
  previous.state !== next.state ||
  (next.bootId !== null && previous.bootId !== next.bootId) ||
  (PROGRESS_STATES.has(next.state) && previous.detail !== next.detail);

export const make = Effect.gen(function* () {
  const store = yield* ThreadMachineStatusStore;
  const entries = new Map<ThreadId, ThreadMachineStateEntry>();
  for (const row of yield* store.list().pipe(
    Effect.catch((error) =>
      Effect.logWarning("thread machine states could not be loaded", {
        detail: error.message,
      }).pipe(Effect.as([] as ReadonlyArray<ThreadMachineStatusRow>)),
    ),
  )) {
    entries.set(row.threadId, {
      state: row.state,
      detail: row.detail,
      bootId: row.bootId,
      updatedAt: row.updatedAt,
    });
  }
  const changes = yield* PubSub.unbounded<ThreadMachineStateChange>();
  const lock = yield* Semaphore.make(1);

  const observe: ThreadMachineStatesShape["observe"] = (threadId, status) =>
    lock.withPermit(
      Effect.gen(function* () {
        const previous = entries.get(threadId) ?? null;
        const next = {
          state: status.state,
          detail: status.detail ?? null,
          // A machine that is not running keeps the boot it last ran.
          bootId: status.bootId ?? (status.state === "running" ? null : (previous?.bootId ?? null)),
        };
        if (!isThreadMachineStateChange(previous, next)) return;
        const current: ThreadMachineStateEntry = {
          ...next,
          updatedAt: DateTime.formatIso(yield* DateTime.now),
        };
        entries.set(threadId, current);
        yield* store.put({ threadId, ...current }).pipe(
          Effect.catch((error) =>
            Effect.logWarning("thread machine state was not persisted", {
              threadId,
              detail: error.message,
            }),
          ),
        );
        yield* PubSub.publish(changes, { threadId, previous, current });
      }),
    );

  return ThreadMachineStates.of({
    get: (threadId) => entries.get(threadId) ?? null,
    list: Effect.sync(() => [...entries]),
    observe,
    remove: (threadId) =>
      lock.withPermit(
        Effect.sync(() => entries.delete(threadId)).pipe(
          Effect.andThen(store.remove(threadId)),
          Effect.catch((error) =>
            Effect.logWarning("thread machine state was not removed", {
              threadId,
              detail: error.message,
            }),
          ),
        ),
      ),
    changes: Stream.fromPubSub(changes),
  });
});

export const layer = Layer.effect(ThreadMachineStates, make);

/** The shell field for a thread: its latest state, or null when no machine is known. */
export const toShellMachineStatus = (
  entry: ThreadMachineStateEntry | null,
): ThreadShellMachineStatus | null =>
  entry === null ? null : { state: entry.state, detail: entry.detail, updatedAt: entry.updatedAt };

/** Thread shells read machine state from this hub service. */
export const readerLayer = Layer.effect(
  ThreadMachineStatusReader,
  Effect.map(ThreadMachineStates, (states) => ({
    get: (threadId: ThreadId) => toShellMachineStatus(states.get(threadId)),
  })),
);

/**
 * The machine directory with every response recorded in `ThreadMachineStates`.
 * Provide the underlying directory to this layer.
 */
export const observedMachineDirectoryLayer = Layer.effect(
  MachineDirectory,
  Effect.gen(function* () {
    const directory = yield* MachineDirectory;
    const states = yield* ThreadMachineStates;
    const record = (threadId: ThreadId) => (status: DirectoryMachineStatus) =>
      states.observe(threadId, status);
    return MachineDirectory.of({
      ...directory,
      ensure: (threadId, request) =>
        directory.ensure(threadId, request).pipe(Effect.tap(record(threadId))),
      status: (threadId) => directory.status(threadId).pipe(Effect.tap(record(threadId))),
      release: (threadId) =>
        directory
          .release(threadId)
          .pipe(
            Effect.tap(() =>
              states.observe(threadId, { state: "none", detail: "The machine was released." }),
            ),
          ),
    });
  }),
);
