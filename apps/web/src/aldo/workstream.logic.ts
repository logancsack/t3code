// Where a thread Aldo talks about stands, in the four states its label shows
// over Aldo's words (AldoAssistant.tsx WorkstreamLabel): it needs the user (a
// hand), it's working (a spinner), it's done (a check) or it's put off (a
// clock). The same reading as the board's (home.logic.ts), so a label and the
// Needs you count never disagree.

import type { AldoHomeConversation } from "./homeApi";
import { WORKING_STATES, dueIn, elapsed, isStuck, needsYouKind, relativeTime } from "./home.logic";

export type WorkstreamState = "needs" | "working" | "done" | "later";

/** Its state, or null when it has none worth a glyph (nothing sent yet). */
export function workstreamState(c: AldoHomeConversation, now: number): WorkstreamState | null {
  if (c.settled || (c.snoozedUntil && Date.parse(c.snoozedUntil) > now)) return "later";
  if (needsYouKind(c) || isStuck(c, now)) return "needs";
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

/** A word on where it stands, after its title: "waiting 12 min", "for 4 min", "finished 1 h ago", "back in 2 h". */
export function workstreamMeta(
  c: AldoHomeConversation,
  state: WorkstreamState,
  now: number,
): string {
  if (state === "later")
    return c.snoozedUntil && Date.parse(c.snoozedUntil) > now
      ? `back ${dueIn(c.snoozedUntil, now)}`
      : "put away";
  if (state === "needs") return `waiting ${elapsed(c.at, now)}`;
  if (state === "done") return `finished ${relativeTime(c.at, now)}`;
  return `for ${elapsed(c.at, now)}`;
}
