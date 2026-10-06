// What's on the user's screen, for Aldo: the thread open on the page, or the
// one they're peeking at from the home screen (which wins while it's open).
// Written turns carry it, so Aldo names that conversation in its
// instructions; a call hears when it changes (assistantSession.ts). Either
// way "this one" means it. The root sets the page's thread (AldoSummon.tsx),
// the home screen the peeked one.

import { useSyncExternalStore } from "react";

import type { AldoOnScreen } from "./assistant.logic";

let routeThread: AldoOnScreen | null = null;
let peekedThread: AldoOnScreen | null = null;
const listeners = new Set<() => void>();

const same = (a: AldoOnScreen | null, b: AldoOnScreen | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.environmentId === b.environmentId &&
    a.threadId === b.threadId &&
    a.title === b.title);

function changed(): void {
  for (const listener of listeners) listener();
}

/** The thread the page shows (its route), or null off a thread. */
export function setAldoRouteThread(thread: AldoOnScreen | null): void {
  if (same(routeThread, thread)) return;
  routeThread = thread;
  changed();
}

/** The thread the home screen's peek shows, or null when it's closed. */
export function setAldoPeekedThread(thread: AldoOnScreen | null): void {
  if (same(peekedThread, thread)) return;
  peekedThread = thread;
  changed();
}

export function aldoOnScreen(): AldoOnScreen | null {
  return peekedThread ?? routeThread;
}

export function subscribeAldoOnScreen(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAldoOnScreen(): AldoOnScreen | null {
  return useSyncExternalStore(subscribeAldoOnScreen, aldoOnScreen, () => null);
}
