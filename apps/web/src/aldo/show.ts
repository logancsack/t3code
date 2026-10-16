// Taking the user to what a thread asks, at the end of Aldo's conversation
// (AldoUpNext.tsx), from wherever it's mentioned: a live card's "Needs you".
// The cards unfold and open it if it was folded away, then bring it into view.

import { type AldoHomeTarget } from "./homeApi";

export const SHOW_ALDO_DECISION = "aldo:show-decision";

/** Asks the cards to show what `target` asks; false when none could (none here, or it asks nothing a card answers). */
export function showAldoDecisionOf(target: AldoHomeTarget): boolean {
  return !window.dispatchEvent(
    new CustomEvent(SHOW_ALDO_DECISION, {
      detail: `${target.environmentId}:${target.threadId}`,
      cancelable: true,
    }),
  );
}

/** How a scroll the user asked for moves: at once for reduced motion. */
export function scrollMotion(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}
