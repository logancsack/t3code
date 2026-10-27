// Dismissing from Needs you (AldoPresence.tsx): what the user won't deal with
// leaves the list, the header and the app badge at once, for good and on every
// device. Nothing is answered or archived; the thread keeps waiting. Separate
// from "Not now" (DismissChatDecision.tsx), which only hides a prompt from
// Aldo's conversation. Both reject when Aldo can't be reached, having put the
// list back as Aldo's next read says it stands.

import { clearAldoDecisions } from "./homeApi";
import { refreshAldoHome, setAldoDecisionsCleared } from "./homeFeed";

async function setCleared(ids: ReadonlyArray<string>, cleared: boolean): Promise<void> {
  setAldoDecisionsCleared(ids, cleared);
  try {
    await clearAldoDecisions(ids, cleared);
  } finally {
    void refreshAldoHome().catch(() => undefined);
  }
}

/** Dismisses `ids`: gone from every list and count now. */
export const dismissNeedsYou = (ids: ReadonlyArray<string>) => setCleared(ids, true);

/** Restores what was dismissed (an Undo, or Restore in the Dismissed list). */
export const restoreNeedsYou = (ids: ReadonlyArray<string>) => setCleared(ids, false);
