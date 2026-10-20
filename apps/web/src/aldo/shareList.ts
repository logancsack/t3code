// Aldo's list of shares (GET /api/shares), read once for every results block
// in view (AldoMadeCards), so each can say who can open what it shows. Read
// when a block first needs it, again when a block names a share the list
// doesn't have yet (one just made), and when the window comes back into focus.
// A share still missing after a read that began once it was asked about had
// its sharing stopped. The Library keeps its own read (AldoLibrary.tsx).

import { useCallback, useEffect, useSyncExternalStore } from "react";

import type { AldoListedShare } from "./results.logic";
import type { AldoShareView } from "./library.logic";
import { fetchAldoShares } from "./workspaceApi";

/** Aldo lists this many at most: one missing from a full list may just be older. */
const MOST_LISTED = 200;
/** Focus reads it again at most this often. */
const FOCUS_MS = 30_000;
/** After a read that failed, another waits this long. */
const RETRY_MS = 10_000;

interface State {
  /** Undefined until read; null from an Aldo that doesn't list shares, or while it can't be read. */
  readonly shares: ReadonlyMap<string, AldoShareView> | null | undefined;
  readonly full: boolean;
  /** Ids asked about before the latest read began: missing from it means stopped. */
  readonly settled: ReadonlySet<string>;
  readonly at: number;
}

let state: State = { shares: undefined, full: false, settled: new Set(), at: 0 };
let reading = false;
const asked = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function read() {
  if (reading) return;
  reading = true;
  const settled = new Set(asked);
  let again = false;
  fetchAldoShares()
    .then((shares) => {
      const byId = shares ? new Map(shares.map((share) => [share.id, share])) : null;
      state = { shares: byId, full: (shares?.length ?? 0) >= MOST_LISTED, settled, at: Date.now() };
      // Asked about while this read was on its way, and not in it: look once more.
      again = byId !== null && [...asked].some((id) => !settled.has(id) && !byId.has(id));
    })
    .catch(() => {
      state = { ...state, at: Date.now() };
    })
    .finally(() => {
      reading = false;
      for (const listener of listeners) listener();
      if (again) read();
    });
}

/** Who can open the shares `ids` name, as Aldo lists them (null until known, in an older Aldo too). */
export function useAldoShareList(ids: ReadonlyArray<string>): AldoListedShare {
  const current = useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
  const wanted = ids.join("\n");
  useEffect(() => {
    if (!wanted) return;
    const list = wanted.split("\n");
    const unasked = list.filter((id) => !asked.has(id));
    for (const id of unasked) asked.add(id);
    const shares = state.shares;
    // Read when it never was (a failed read waits a little), or when a share it should have isn't in it yet.
    if (
      shares === undefined
        ? Date.now() - state.at > RETRY_MS
        : shares !== null && unasked.some((id) => !shares.has(id))
    ) {
      read();
    }
  }, [wanted]);
  useEffect(() => {
    if (!wanted) return;
    const focus = () => {
      if (Date.now() - state.at > FOCUS_MS) read();
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [wanted]);
  return useCallback(
    (id: string) => {
      const shares = current.shares;
      if (!shares) return null;
      const share = shares.get(id);
      if (share) return share;
      return current.settled.has(id) && !current.full ? "gone" : null;
    },
    [current],
  );
}
