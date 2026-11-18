// Where a thread Aldo talks about stands, in the four states its label shows
// over Aldo's words (AldoAssistant.tsx WorkstreamLabel): it needs the user (a
// hand), it's working (a dot in a ring), it's done (a check) or it's put off
// (a clock). The same reading as the board's (home.logic.ts), so a label and
// the Needs you count never disagree: work with no word for an hour is still
// working there, and says so.

import type { AldoHomeConversation } from "./homeApi";
import { WORKING_STATES, dueIn, elapsed, isStuck, needsYouKind, relativeTime } from "./home.logic";

export type WorkstreamState = "needs" | "working" | "done" | "later";

/**
 * Its state, or null when it has none worth a glyph (nothing sent yet). A
 * question, approval or handoff it raises while snoozed needs the user all
 * the same, as the board has it.
 */
export function workstreamState(c: AldoHomeConversation, now: number): WorkstreamState | null {
  if (c.settled || (c.snoozedUntil && Date.parse(c.snoozedUntil) > now && !c.pending))
    return "later";
  if (needsYouKind(c)) return "needs";
  if (WORKING_STATES.has(c.state)) return "working";
  if (c.state === "done") return "done";
  return null;
}

/** The glyph's name for a screen reader, before the thread's title. */
export const WORKSTREAM_WORDS: Record<WorkstreamState, string> = {
  needs: "Needs you",
  working: "Working",
  done: "Done",
  later: "Put off",
};

/**
 * A word on where it stands, after its title: "waiting 12 min", "for 4 min",
 * "no word for 2 h", "finished 1 h ago", "back in 2 h". Since its state was
 * reported (when its turn began), except "no word", which counts from its last
 * activity.
 */
export function workstreamMeta(
  c: AldoHomeConversation,
  state: WorkstreamState,
  now: number,
): string {
  if (state === "later")
    return c.snoozedUntil && Date.parse(c.snoozedUntil) > now
      ? `back ${dueIn(c.snoozedUntil, now)}`
      : "put away";
  const since = c.stateAt ?? c.at;
  if (state === "needs") return `waiting ${elapsed(since, now)}`;
  if (state === "done") return `finished ${relativeTime(since, now)}`;
  return isStuck(c, now) ? `no word for ${elapsed(c.at, now)}` : `for ${elapsed(since, now)}`;
}
