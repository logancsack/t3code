// Clearing from the Dismissed list (AldoPresence.tsx): the rows go at once, with a
// few seconds to undo. The clear itself archives their threads, which can't be undone
// without waking machines, so it's sent when that time is up, when the drop-down
// closes or when the page is hidden. Rejects as one that couldn't reach Aldo does:
// the rows are back with Aldo's next read, and `onFail` says so.

import { create } from "zustand";

import { removeAldoDecisions } from "./homeApi";
import { refreshAldoHome } from "./homeFeed";

export const CLEAR_UNDO_MS = 8000;
/** Most sent in one request: each thread is archived in turn. */
const CHUNK = 50;

const useClearing = create<{ readonly ids: ReadonlyArray<string> }>(() => ({ ids: [] }));
const sending = new Set<string>();
let timer: number | undefined;
let onFail: (() => void) | undefined;

/** The dismissed items being cleared: not listed any more, though Aldo has yet to be told. */
export const useAldoClearing = () => useClearing((state) => state.ids);

/** Clears `ids` from Dismissed now, undoable until the time is up. */
export function clearDismissed(ids: ReadonlyArray<string>, failed: () => void): void {
  onFail = failed;
  useClearing.setState((state) => ({ ids: [...new Set([...state.ids, ...ids])] }));
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void sendClearedDismissed(), CLEAR_UNDO_MS);
}

/** Puts back everything cleared and not yet sent. */
export function undoClearDismissed(): void {
  window.clearTimeout(timer);
  useClearing.setState((state) => ({ ids: state.ids.filter((id) => sending.has(id)) }));
}

/** Tells Aldo what was cleared, now. */
export async function sendClearedDismissed(): Promise<void> {
  window.clearTimeout(timer);
  const ids = useClearing.getState().ids.filter((id) => !sending.has(id));
  if (ids.length === 0) return;
  for (const id of ids) sending.add(id);
  try {
    for (let at = 0; at < ids.length; at += CHUNK)
      await removeAldoDecisions(ids.slice(at, at + CHUNK));
  } catch {
    onFail?.();
  } finally {
    // The rows stay gone until Aldo's read says they're cleared (or, if it failed, that they're not).
    await refreshAldoHome().catch(() => undefined);
    for (const id of ids) sending.delete(id);
    useClearing.setState((state) => ({ ids: state.ids.filter((id) => !ids.includes(id)) }));
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void sendClearedDismissed();
  });
}
