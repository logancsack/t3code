// Aldo's sidebar order (sidebarOrder.logic.ts) as the sidebar applies it to
// its pinned block and its active list. A thread is at work while Aldo holds
// a message for it (the directory's `starts`: starting, queued or retrying),
// whatever its shell says yet. While the pointer is over the list, or a press
// that began there lasts, rows keep their places, so one doesn't move out
// from under a click or a drag; they move to their new places once it's gone.

import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { getAldoEnvironments, isAldoCloud, subscribeAldoEnvironments } from "./cloud";
import {
  holdAldoSidebarOrder,
  sortAldoSidebarThreads,
  type AldoSidebarOrderInput,
} from "./sidebarOrder.logic";

const keyOf = (thread: Pick<AldoSidebarOrderInput, "environmentId" | "id">) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

/** The threads Aldo holds a message for, as one string, so a directory fetch that changes none re-renders nothing. */
function readHeldKeys(): string {
  const keys: string[] = [];
  for (const environment of getAldoEnvironments() ?? []) {
    for (const [threadId, start] of Object.entries(environment.starts ?? {})) {
      if (start.state === "failed") continue;
      keys.push(
        scopedThreadKey(
          scopeThreadRef(environment.environmentId as EnvironmentId, threadId as ThreadId),
        ),
      );
    }
  }
  return keys.sort().join("\n");
}

const subscribeNever = () => () => undefined;
const readNone = () => "";

export type AldoSidebarSection = "pinned" | "active";

export function useAldoSidebarOrder() {
  const heldKeys = useSyncExternalStore(
    isAldoCloud ? subscribeAldoEnvironments : subscribeNever,
    isAldoCloud ? readHeldKeys : readNone,
    readNone,
  );
  const [hovering, setHovering] = useState(false);
  const [pressed, setPressed] = useState(false);
  const holding = hovering || pressed;
  const shown = useRef(new Map<AldoSidebarSection, readonly string[]>());

  /** The order alone, as a drop will land in it (a drag's preview). */
  const sort = useCallback(
    <T extends AldoSidebarOrderInput>(threads: readonly T[]): T[] => {
      const held = new Set(heldKeys === "" ? [] : heldKeys.split("\n"));
      return sortAldoSidebarThreads(threads, (thread) => held.has(keyOf(thread)));
    },
    [heldKeys],
  );

  /** A section's threads in order, rows on screen kept in place while the list is held. */
  const order = useCallback(
    <T extends AldoSidebarOrderInput>(section: AldoSidebarSection, threads: readonly T[]): T[] => {
      const sorted = sort(threads);
      const previous = shown.current.get(section);
      const result = holding && previous ? holdAldoSidebarOrder(previous, sorted, keyOf) : sorted;
      shown.current.set(section, result.map(keyOf));
      return result;
    },
    [holding, sort],
  );

  const listProps = useMemo(
    () => ({
      onPointerEnter: () => setHovering(true),
      onPointerLeave: () => setHovering(false),
      // Held until the press ends, wherever that is: a drag can leave the list.
      onPointerDown: () => {
        setPressed(true);
        const release = () => {
          setPressed(false);
          window.removeEventListener("pointerup", release, true);
          window.removeEventListener("pointercancel", release, true);
        };
        window.addEventListener("pointerup", release, true);
        window.addEventListener("pointercancel", release, true);
      },
    }),
    [],
  );

  return { order, sort, listProps };
}
