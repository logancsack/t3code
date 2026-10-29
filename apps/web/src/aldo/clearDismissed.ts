// Clearing from the Dismissed list (AldoPresence.tsx): the rows go at once, with a
// few seconds to undo. The clear itself archives their threads, which can't be undone
// without waking machines, so it's sent when that time is up, when the drop-down
// closes or when the page is hidden. Rejects as one that couldn't reach Aldo does:
// the rows are back with Aldo's next read, and `onFail` says so.

import { create } from "zustand";

import { removeAldoDecisions } from "./homeApi";
import { refreshAldoHome } from "./homeFeed";

export const CLEAR_UNDO_MS = 8000;
/** Most sent in one request: Aldo archives each thread in turn. */
const CHUNK = 50;

const useClearing = create<{
  /** Cleared and not listed. */
  readonly ids: ReadonlyArray<string>;
  /** Of those, the ones sent: too late to undo. */
  readonly sent: ReadonlyArray<string>;
}>(() => ({ ids: [], sent: [] }));
let timer: number | undefined;
let onFail: (() => void) | undefined;

/** The dismissed items being cleared (not listed any more, though Aldo may have yet to be told), and whether any can still be undone. */
export function useAldoClearing(): {
  readonly ids: ReadonlyArray<string>;
  readonly undoable: boolean;
} {
  const { ids, sent } = useClearing();
  return { ids, undoable: ids.some((id) => !sent.includes(id)) };
}

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
  useClearing.setState((state) => ({ ids: state.ids.filter((id) => state.sent.includes(id)) }));
}

/** Tells Aldo what was cleared, now. */
export async function sendClearedDismissed(): Promise<void> {
  window.clearTimeout(timer);
  const { ids: all, sent } = useClearing.getState();
  const ids = all.filter((id) => !sent.includes(id));
  if (ids.length === 0) return;
  useClearing.setState({ sent: [...sent, ...ids] });
  try {
    // Every request goes out before this returns: the page may be gone before a later one could.
    const requests: Promise<void>[] = [];
    for (let at = 0; at < ids.length; at += CHUNK)
      requests.push(removeAldoDecisions(ids.slice(at, at + CHUNK)));
    await Promise.all(requests);
  } catch {
    onFail?.();
  } finally {
    // The rows stay gone until Aldo's read says they're cleared (or, if it failed, that they're not).
    await refreshAldoHome().catch(() => undefined);
    useClearing.setState((state) => ({
      ids: state.ids.filter((id) => !ids.includes(id)),
      sent: state.sent.filter((id) => !ids.includes(id)),
    }));
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void sendClearedDismissed();
  });
}
