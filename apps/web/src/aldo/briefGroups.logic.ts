// The brief's groups (AldoBrief.tsx BriefCard), read against the home screen
// now: the brief was written once, in the morning, but each item shows where
// its thread stands as the page is looked at. A thing that needed the user
// and has been decided shows as done (or working, once its thread carries
// on), so the brief never asks again for what's settled. Pure, so it's tested
// on its own.

import type { AldoBriefGroupItem, AldoBriefGroups } from "./assistantApi";
import { aldoDecisions } from "./decisions.logic";
import { dueIn, sameTarget } from "./home.logic";
import type { AldoHome } from "./homeApi";
import { workstreamState, type WorkstreamState } from "./workstream.logic";

export type AldoBriefGroupKey = keyof AldoBriefGroups;

/** The groups in the order they show, each with its label and the state its items were in when it was written. */
export const BRIEF_GROUPS: ReadonlyArray<{
  readonly key: AldoBriefGroupKey;
  readonly label: string;
  readonly state: WorkstreamState;
}> = [
  { key: "needs", label: "Needs you today", state: "needs" },
  { key: "watching", label: "I'm watching", state: "working" },
  { key: "later", label: "Can wait", state: "later" },
  { key: "fyi", label: "Good to know", state: "done" },
];

/** The keys of what waits on the user now (null until the home screen's read is in). */
export function liveDecisionKeys(home: AldoHome | null, now: number): ReadonlySet<string> | null {
  return home ? new Set(aldoDecisions(home, now).map((d) => d.key)) : null;
}

/**
 * Where an item stands now. A decision still waiting needs the user; one
 * decided is where its thread is now (working on the answer, say), or done.
 * Anything else is where its thread is now, or as it was written when the
 * page doesn't have its thread.
 */
export function briefItemState(
  item: AldoBriefGroupItem,
  written: WorkstreamState,
  home: AldoHome | null,
  decisions: ReadonlySet<string> | null,
  now: number,
): WorkstreamState {
  if (!home || !decisions) return written;
  if (item.key !== undefined && decisions.has(item.key)) return "needs";
  const thread = item.thread;
  const conversation = thread
    ? home.conversations.find((c) => sameTarget(c.thread, thread))
    : undefined;
  const live = conversation ? workstreamState(conversation, now) : null;
  return live ?? (item.key !== undefined ? "done" : written);
}

/** A word after its line when it's moved on since the brief was written, or when what can wait is back. */
export function briefItemNote(
  item: AldoBriefGroupItem,
  written: WorkstreamState,
  state: WorkstreamState,
  now: number,
): string | null {
  if (state === "later" && item.until && Date.parse(item.until) > now)
    return `back ${dueIn(item.until, now)}`;
  if (state === written) return null;
  if (state === "done") return "done";
  if (state === "working") return "working on it";
  if (state === "needs") return "needs you";
  return "put off";
}
