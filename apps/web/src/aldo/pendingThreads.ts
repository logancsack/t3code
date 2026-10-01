// A thread this tab is creating isn't missing from its machine, just not there
// yet. A new thread shows in the sidebar while its cloud agent is created
// (startingThreads.ts), so T3 may start following it before the machine has
// it: once the machine is up, T3 asks it for the thread, and a thread a
// machine answers "not found" for a few times running is taken for deleted
// and no longer followed (for minutes, even once it exists). For these
// threads that answer means "not yet": T3 asks again until the machine has
// it. Kept apart from startingThreads.ts so the connection runtime can use it.

import {
  ThreadSnapshotLoader,
  threadSnapshotLoaderLayer,
  type ThreadSnapshotLoadResult,
} from "@t3tools/client-runtime/state/threads";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** Threads this tab sent a first message for that their machine may not have yet, and when. */
const pending = new Map<string, number>();
/** Longer than a machine takes to come up and take the message; a thread gone after that is gone. */
const PENDING_MS = 10 * 60_000;

export function markAldoThreadPending(threadId: string): void {
  pending.set(threadId, Date.now());
}

export function settleAldoThreadPending(threadId: string): void {
  pending.delete(threadId);
}

/** What T3 makes of a machine's answer for a thread: "not found" is "not yet" while it's pending. */
export function aldoThreadSnapshotResult(
  threadId: string,
  result: ThreadSnapshotLoadResult,
): ThreadSnapshotLoadResult {
  const since = pending.get(threadId);
  if (since === undefined) return result;
  if (result.kind === "found" || Date.now() - since > PENDING_MS) {
    pending.delete(threadId);
    return result;
  }
  return result.kind === "not-found" ? { kind: "unavailable" } : result;
}

/** T3's thread loader, reading pending threads' answers as above. */
export const aldoThreadSnapshotLoaderLayer = Layer.effect(
  ThreadSnapshotLoader,
  Effect.gen(function* () {
    const loader = yield* ThreadSnapshotLoader;
    return ThreadSnapshotLoader.of({
      load: (prepared, threadId, window) =>
        loader
          .load(prepared, threadId, window)
          .pipe(Effect.map((result) => aldoThreadSnapshotResult(threadId, result))),
    });
  }),
).pipe(Layer.provide(threadSnapshotLoaderLayer));
