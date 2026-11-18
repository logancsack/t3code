// What's on the user's screen, for Aldo: the thread open on the page.
// Written turns carry it, so Aldo names that conversation in its
// instructions; a call hears when it changes (assistantSession.ts). Either
// way "this one" means it. The root sets it (AldoSummon.tsx).

import { useSyncExternalStore } from "react";

import type { AldoOnScreen } from "./assistant.logic";

let routeThread: AldoOnScreen | null = null;
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

export function aldoOnScreen(): AldoOnScreen | null {
  return routeThread;
}

export function subscribeAldoOnScreen(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAldoOnScreen(): AldoOnScreen | null {
  return useSyncExternalStore(subscribeAldoOnScreen, aldoOnScreen, () => null);
}
