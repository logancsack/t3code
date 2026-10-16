// Aldo's sidebar order (sidebarOrder.logic.ts) as the sidebar applies it to
// its pinned block and its active list. A thread is at work while Aldo holds
// a message for it (the directory's `starts`: starting, queued or retrying),
// whatever its shell says yet. While the pointer is over the list, a press
// that began there lasts, or a search is open, rows keep their places, so one
// doesn't move out from under a click, a drag or the highlighted result; they
// move to their new places once it's over.

import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { getAldoEnvironments, isAldoCloud, subscribeAldoEnvironments } from "./cloud";
import {
  holdAldoSidebarOrder,
  sortAldoSidebarThreads,
  type AldoHeldMessage,
  type AldoSidebarOrderInput,
} from "./sidebarOrder.logic";

const keyOf = (thread: Pick<AldoSidebarOrderInput, "environmentId" | "id">) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

/**
 * The messages Aldo holds, a line each (thread key, failed, when), as one
 * string, so a directory fetch that changes none re-renders nothing.
 */
function readHeld(): string {
  const lines: string[] = [];
  for (const environment of getAldoEnvironments() ?? []) {
    for (const [threadId, start] of Object.entries(environment.starts ?? {})) {
      const atMs = start.at === undefined ? 0 : Date.parse(start.at) || 0;
      const key = scopedThreadKey(
        scopeThreadRef(environment.environmentId as EnvironmentId, threadId as ThreadId),
      );
      lines.push(`${key}\t${start.state === "failed" ? 1 : 0}\t${atMs}`);
    }
  }
  return lines.sort().join("\n");
}

function parseHeld(held: string): Map<string, AldoHeldMessage> {
  const byKey = new Map<string, AldoHeldMessage>();
  for (const line of held === "" ? [] : held.split("\n")) {
    const [key = "", failed, atMs] = line.split("\t");
    byKey.set(key, { failed: failed === "1", atMs: Number(atMs) || 0 });
  }
  return byKey;
}

const subscribeNever = () => () => undefined;
const readNone = () => "";

export type AldoSidebarSection = "pinned" | "active";

/** `hold`: keep rows in place for a reason of the sidebar's own (a search open). */
export function useAldoSidebarOrder(options: { readonly hold?: boolean } = {}) {
  const held = useSyncExternalStore(
    isAldoCloud ? subscribeAldoEnvironments : subscribeNever,
    isAldoCloud ? readHeld : readNone,
    readNone,
  );
  const [hovering, setHovering] = useState(false);
  const [pressed, setPressed] = useState(false);
  const holding = hovering || pressed || options.hold === true;
  const shown = useRef(new Map<AldoSidebarSection, readonly string[]>());

  /** The order alone, as a drop will land in it (a drag's preview). */
  const sort = useCallback(
    <T extends AldoSidebarOrderInput>(threads: readonly T[]): T[] => {
      const byKey = parseHeld(held);
      return sortAldoSidebarThreads(threads, (thread) => byKey.get(keyOf(thread)));
    },
    [held],
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
