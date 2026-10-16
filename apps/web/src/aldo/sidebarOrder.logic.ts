// The order of Aldo's sidebar: threads at work first (an agent working, its
// computer starting, or a message Aldo holds for it, queued or retrying),
// then the ones waiting on the user (a question, an approval, a plan to
// accept), then the rest by when their work last ended, newest first. The
// pinned block above orders the same way; snoozed and settled threads keep
// their shelves and theirs. Every device reads the same thread shells, so
// they agree. Pure, so it's tested on its own (sidebarOrder.ts applies it).

import { firstValidTimestampMs, resolveSidebarThreadStatus } from "../components/Sidebar.logic";
import { isLatestTurnSettled } from "../session-logic";
import type { SidebarThreadSummary } from "../types";

export type AldoSidebarTier = "working" | "waiting" | "done";

const TIER_RANK: Record<AldoSidebarTier, number> = { working: 0, waiting: 1, done: 2 };

export type AldoSidebarOrderInput = Pick<
  SidebarThreadSummary,
  | "id"
  | "environmentId"
  | "createdAt"
  | "updatedAt"
  | "latestTurn"
  | "session"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "hasActionableProposedPlan"
  | "backgroundLiveness"
>;

/** A plan from its latest turn, still to accept, once that turn is over. */
function planWaits(thread: AldoSidebarOrderInput): boolean {
  const status = thread.session?.status;
  return (
    thread.hasActionableProposedPlan &&
    status !== "starting" &&
    status !== "running" &&
    isLatestTurnSettled(thread.latestTurn, thread.session)
  );
}

/**
 * Where a thread goes: "working" as its row says Working (or Monitoring), or
 * while Aldo holds a message for it (`held`: starting, queued or retrying);
 * "waiting" while it asks the user something (an approval or a question
 * outranks the turn it pauses; a plan prompt outranks background work, as
 * its status pill does); "done" otherwise, a failure included.
 */
export function aldoSidebarTier(thread: AldoSidebarOrderInput, held = false): AldoSidebarTier {
  if (held) return "working";
  const status = resolveSidebarThreadStatus(thread);
  if (status === "approval" || status === "input" || planWaits(thread)) return "waiting";
  return status === "working" || status === "monitoring" ? "working" : "done";
}

/**
 * When its work last ended: its latest turn's end, or that turn's start for
 * one T3 never saw end. A thread that never ran (a start that failed) goes by
 * its last change, then when it was made.
 */
export function aldoThreadFinishedAtMs(thread: AldoSidebarOrderInput): number {
  const turn = thread.latestTurn;
  return turn
    ? firstValidTimestampMs(
        turn.completedAt,
        turn.startedAt,
        turn.requestedAt,
        thread.updatedAt,
        thread.createdAt,
      )
    : firstValidTimestampMs(thread.updatedAt, thread.createdAt);
}

/**
 * When its current work began: the running turn's start, else the session's
 * last change (a start Aldo makes, background work outliving its turn).
 */
function workStartedAtMs(thread: AldoSidebarOrderInput): number {
  const turn = thread.latestTurn;
  return turn && turn.completedAt === null
    ? firstValidTimestampMs(
        turn.startedAt,
        turn.requestedAt,
        thread.session?.updatedAt,
        thread.updatedAt,
      )
    : firstValidTimestampMs(thread.session?.updatedAt, thread.updatedAt, thread.createdAt);
}

/**
 * The threads in sidebar order: by tier, then newest first (working by when
 * its work began, the rest by when it last ended), then by id, so every
 * device breaks ties alike.
 */
export function sortAldoSidebarThreads<T extends AldoSidebarOrderInput>(
  threads: readonly T[],
  isHeld: (thread: T) => boolean = () => false,
): T[] {
  if (threads.length < 2) return [...threads];
  const keys = new Map(
    threads.map((thread) => {
      const tier = aldoSidebarTier(thread, isHeld(thread));
      const at = tier === "working" ? workStartedAtMs(thread) : aldoThreadFinishedAtMs(thread);
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
