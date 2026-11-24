// The order of Aldo's sidebar: threads at work first (an agent working, its
// computer starting, or a message Aldo holds for it, queued or retrying),
// then the ones waiting on the user (a question, an approval, a plan to
// accept), then the rest by when their work last ended, newest first. The
// pinned block above orders the same way; snoozed and settled threads keep
// their shelves and theirs. Every device reads the same thread shells, so
// they agree. Pure, so it's tested on its own (sidebarOrder.ts applies it).

import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";

import { firstValidTimestampMs, resolveSidebarThreadStatus } from "../components/Sidebar.logic";
import type { SidebarThreadSummary } from "../types";

export type AldoSidebarTier = "working" | "waiting" | "done";

const TIER_RANK: Record<AldoSidebarTier, number> = { working: 0, waiting: 1, done: 2 };

export type AldoSidebarOrderInput = Pick<
  SidebarThreadSummary,
  | "id"
  | "environmentId"
  | "createdAt"
  | "updatedAt"
  | "latestRun"
  | "runtime"
  | "blockedOnThreadWait"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
  | "pendingGuestMessageCount"
  | "hasActionableProposedPlan"
  | "interactionMode"
  | "pendingBackgroundTasks"
>;

/**
 * A message Aldo holds for a thread (the directory's `starts`), which its
 * machine hasn't seen yet: still on its way (starting, queued, retrying), or
 * `failed`. `atMs` is when it was sent, or when it failed; 0 from an older
 * Aldo, which doesn't say.
 */
export interface AldoHeldMessage {
  readonly failed: boolean;
  readonly atMs: number;
}

/**
 * Where a thread goes: "working" while a run or background work is under way,
 * or while Aldo holds a message for it (`held`: starting, queued or retrying);
 * "waiting" while it asks the user something (an approval or a question
 * outranks the turn it pauses; a plan to accept outranks background work);
 * "done" otherwise, a failure included.
 */
export function aldoSidebarTier(thread: AldoSidebarOrderInput, held = false): AldoSidebarTier {
  if (held) return "working";
  const status = resolveSidebarThreadStatus(thread);
  const working = status === "working" || status === "preparing";
  const planWaits =
    !working && thread.interactionMode === "plan" && thread.hasActionableProposedPlan;
  if (status === "approval" || status === "input" || status === "request" || planWaits)
    return "waiting";
  return working || backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks)
    ? "working"
    : "done";
}

/**
 * When its work last ended: its latest run's end, or that run's start for
 * one T3 never saw end. A thread that never ran (a start that failed) goes by
 * its last change, then when it was made.
 */
export function aldoThreadFinishedAtMs(thread: AldoSidebarOrderInput): number {
  const run = thread.latestRun;
  return run
    ? firstValidTimestampMs(
        run.completedAt,
        run.startedAt,
        run.requestedAt,
        thread.updatedAt,
        thread.createdAt,
      )
    : firstValidTimestampMs(thread.updatedAt, thread.createdAt);
}

/**
 * When its current work began: the running run's start, else the runtime's
 * last change (a start Aldo makes, background work outliving its run).
 */
function workStartedAtMs(thread: AldoSidebarOrderInput): number {
  const run = thread.latestRun;
  return run && run.completedAt === null
    ? firstValidTimestampMs(
        run.startedAt,
        run.requestedAt,
        thread.runtime?.updatedAt,
        thread.updatedAt,
      )
    : firstValidTimestampMs(thread.runtime?.updatedAt, thread.updatedAt, thread.createdAt);
}

/**
 * The threads in sidebar order: by tier, then newest first (working by when
 * its work began, the rest by when it last ended), then by id, so every
 * device breaks ties alike. A message Aldo holds is newer than its thread's
 * shell: when it was sent (or failed) counts, if that's later.
 */
export function sortAldoSidebarThreads<T extends AldoSidebarOrderInput>(
  threads: readonly T[],
  heldFor: (thread: T) => AldoHeldMessage | undefined = () => undefined,
): T[] {
  if (threads.length < 2) return [...threads];
  const keys = new Map(
    threads.map((thread) => {
      const held = heldFor(thread);
      const tier = aldoSidebarTier(thread, held !== undefined && !held.failed);
      const at = Math.max(
        tier === "working" ? workStartedAtMs(thread) : aldoThreadFinishedAtMs(thread),
        held?.atMs ?? 0,
      );
      return [thread, { rank: TIER_RANK[tier], at }] as const;
    }),
  );
  return [...threads].sort((left, right) => {
    const a = keys.get(left)!;
    const b = keys.get(right)!;
    return (
      a.rank - b.rank ||
      b.at - a.at ||
      left.id.localeCompare(right.id) ||
      left.environmentId.localeCompare(right.environmentId)
    );
  });
}

/**
 * `next` with the rows already on screen (`shown`, their keys in order) kept
 * in that order, in the places `next` gives them together; a row new to the
 * list takes its own place in `next`, and one that left is gone. While the
 * pointer is over the list, so that a row doesn't move out from under a click.
 */
export function holdAldoSidebarOrder<T>(
  shown: readonly string[],
  next: readonly T[],
  keyOf: (item: T) => string,
): T[] {
  const rank = new Map(shown.map((key, index) => [key, index]));
  const kept = next
    .filter((item) => rank.has(keyOf(item)))
    .sort((left, right) => rank.get(keyOf(left))! - rank.get(keyOf(right))!);
  let index = 0;
  return next.map((item) => (rank.has(keyOf(item)) ? kept[index++]! : item));
}
