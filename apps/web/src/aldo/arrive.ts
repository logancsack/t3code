// What arrives in Aldo's conversation once the page has opened settles in
// (presence.css's data-aldo-arrive); what was there when it opened is just
// there, rather than every line playing in at once.

import { useState } from "react";

let settledAt = Number.POSITIVE_INFINITY;

/** The conversation has opened: from now on, what appears arrives. */
export function settleAldoConversation(): void {
  if (settledAt === Number.POSITIVE_INFINITY) settledAt = Date.now();
}

/** The conversation closed: the next time it opens, it opens still. */
export function unsettleAldoConversation(): void {
  settledAt = Number.POSITIVE_INFINITY;
}

/** Whether what mounts now arrived after the page opened. */
export function useAldoArrived(): boolean {
  const [arrived] = useState(() => Date.now() > settledAt);
  return arrived;
}

/** The attribute that plays an arrival in, for what arrived. */
export function useAldoArrive(): { readonly "data-aldo-arrive"?: "" } {
  return useAldoArrived() ? { "data-aldo-arrive": "" } : {};
}
