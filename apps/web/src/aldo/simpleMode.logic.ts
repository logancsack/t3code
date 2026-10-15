// Simple mode's decisions (simpleMode.ts, AldoSimpleRail.tsx), pure so they're
// tested on their own: whether it's on, where its rail shows, which of its
// places the page is on, and what its Needs-you place lists.

import type { AldoHome, AldoHomeConversation } from "./cloud";
import { aldoDecisions, putAway, type AldoDecision } from "./decisions.logic";
import { boardFor } from "./home.logic";

/** The three places on simple mode's rail, each a view of the home screen. */
export type AldoSimplePlace = "aldo" | "needs" | "library";

export const ALDO_SIMPLE_PLACES: ReadonlyArray<{
  readonly place: AldoSimplePlace;
  readonly label: string;
}> = [
  { place: "aldo", label: "Aldo" },
  { place: "needs", label: "Needs you" },
  { place: "library", label: "Library" },
];

/** Kept per device as "on"; anything else (nothing kept, private mode) is off. */
export function simpleModeFrom(stored: string | null | undefined): boolean {
  return stored === "on";
}

/**
 * The rail stands in for the sidebar in Aldo when it's on, except in settings,
 * which lists its own pages there, and on an Aldo without the assistant, where
 * there's no Aldo to talk to (it shows until that's known, so it doesn't flash in).
 */
export function simpleRailShows(input: {
  readonly cloud: boolean;
  readonly on: boolean;
  readonly settings: boolean;
  /** Whether this Aldo has the assistant; null until it's known. */
  readonly assistant: boolean | null;
}): boolean {
  return input.cloud && input.on && !input.settings && input.assistant !== false;
}

/** The place the page shows: one on the home screen, none on a thread or another page. */
export function currentSimplePlace(
  pathname: string,
  place: AldoSimplePlace,
): AldoSimplePlace | null {
  return pathname === "/" ? place : null;
}

/** Whether the home screen shows Aldo's conversation: always, but for simple mode's other places. */
export function homeShowsConversation(input: {
  readonly simple: boolean;
  readonly place: AldoSimplePlace;
}): boolean {
  return !input.simple || input.place === "aldo";
}

export interface AldoSimpleNeedsYou {
  /** Threads waiting on the user, waited longest first, without the ones they put away. */
  readonly conversations: ReadonlyArray<AldoHomeConversation>;
  /** Pull requests ready to merge that no thread above already asks about. */
  readonly merges: ReadonlyArray<Extract<AldoDecision, { kind: "merge" }>>;
}

/**
 * What the Needs-you place lists under Aldo's approvals: what the home
 * screen's board lists as needing the user, less what they put away, and the
 * pull requests ready to merge. Together with the waiting approvals that's
 * what aldoWaitingCount counts, so the rail's number matches the list.
 */
export function simpleNeedsYou(home: AldoHome, now: number): AldoSimpleNeedsYou {
  return {
    conversations: boardFor(home.conversations, now).needsYou.filter((c) => !putAway(c, now)),
    merges: aldoDecisions(home, now).filter(
      (d): d is Extract<AldoDecision, { kind: "merge" }> => d.kind === "merge",
    ),
  };
}
