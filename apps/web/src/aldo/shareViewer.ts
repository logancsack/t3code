// The share open in Aldo's viewer (AldoShareViewer.tsx): one at a time, opened
// from the Library or a turn's results, and the shares the viewer changed
// (pinned or unpinned), so lists that show them follow.

import { useSyncExternalStore } from "react";

import type { AldoShareView } from "./library.logic";

/** What the viewer needs: a share as Aldo lists it, or what a turn's step recorded of one. */
export interface AldoOpenShare {
  /** Aldo's id, when known: pinning needs it. */
  readonly id: string | null;
  readonly url: string;
  readonly title: string;
  readonly contentType: string;
  /** Aldo's listing of it, when there is one. */
  readonly share: AldoShareView | null;
}

let open: AldoOpenShare | null = null;
const listeners = new Set<() => void>();
const changeListeners = new Set<(share: AldoShareView) => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function set(next: AldoOpenShare | null) {
  open = next;
  for (const listener of listeners) listener();
}

export function openAldoShare(share: AldoOpenShare): void {
  set(share);
}

export function closeAldoShare(): void {
  set(null);
}

export function useAldoOpenShare(): AldoOpenShare | null {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => null,
  );
}

/** A share as Aldo now says it stands, after the viewer changed it. */
export function aldoShareChanged(share: AldoShareView): void {
  if (open?.id === share.id) set({ ...open, title: share.title, share });
  for (const listener of changeListeners) listener(share);
}

export function onAldoShareChanged(listener: (share: AldoShareView) => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}
