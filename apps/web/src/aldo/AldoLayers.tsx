// Home is the floor: it stays mounted under every thread, which lies over it and slides away to
// show it again (layers.ts has the history that goes with it). Its scroll, open cards and
// half-typed message survive a visit to a thread.

import { ChevronLeftIcon } from "lucide-react";
import { Activity, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { ThreadRouteTarget } from "../threadRoutes";
import { AldoHome } from "./AldoHome";
import { closeAldoThread, useAldoDrawerOpen } from "./layers";
import "./layers.css";

/** The slide's length on a phone (layers.css), which Home waits out before it rests. */
const SLIDE_MS = 300;

/**
 * Esc closes a thread when nothing else has a use for it: no field, menu or popup has the focus
 * (a field's Esc, and a popup's, are theirs), and no dialog or call screen is open.
 */
function escapeIsFree(event: KeyboardEvent) {
  return (
    event.key === "Escape" &&
    !event.defaultPrevented &&
    document.activeElement === document.body &&
    !document.querySelector('[aria-modal="true"], [data-aldo-call-screen]')
  );
}

export function AldoLayers({
  target,
  thread,
}: {
  readonly target: ThreadRouteTarget | null;
  readonly thread: (target: ThreadRouteTarget) => ReactNode;
}) {
  const open = target !== null;
  const drawer = useAldoDrawerOpen();
  /** The thread that last lay over Home, kept while it slides away. */
  const last = useRef<ThreadRouteTarget | null>(null);
  const [, setLeaving] = useState(false);
  if (target) last.current = target;
  // A card that grows into its thread is the entrance: the slide is for everything else.
  const still = useRef(false);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) {
    still.current = document.documentElement.hasAttribute("data-aldo-morph");
  }
  wasOpen.current = open;

  // Home rests once a thread covers it (its effects stop, as they did when it unmounted),
  // but not before the slide has shown it behind. A thread opened first has nothing to wait for.
  const [resting, setResting] = useState(open);
  useEffect(() => {
    if (!open) {
      setResting(false);
      return;
    }
    const timer = setTimeout(() => setResting(true), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (open) {
      setLeaving(false);
      return;
    }
    if (!last.current) return;
    setLeaving(true);
    const timer = setTimeout(() => {
      last.current = null;
      setLeaving(false);
    }, SLIDE_MS);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (escapeIsFree(event)) closeAldoThread();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const shown = target ?? last.current;
  return (
    <div className="relative flex min-w-0 flex-1">
      <div
        data-aldo-under=""
        className="flex min-w-0 flex-1"
        data-covered={open}
        inert={open}
        aria-hidden={open || undefined}
      >
        <Activity mode={resting ? "hidden" : "visible"}>
          <AldoHome />
        </Activity>
      </div>
      {shown ? (
        <div
          data-aldo-layer=""
          data-phase={open ? "in" : "out"}
          data-still={still.current && open ? "true" : undefined}
          inert={!open}
        >
          {thread(shown)}
        </div>
      ) : null}
      {open && !drawer
        ? createPortal(
            <button
              type="button"
              aria-label="Close thread"
              onClick={closeAldoThread}
              className="fixed top-[var(--workspace-controls-top)] left-[calc(var(--workspace-controls-left)+2.5rem)] z-40 flex h-[var(--workspace-topbar-height)] w-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:hidden"
            >
              <ChevronLeftIcon className="size-5" />
            </button>,
            document.body,
          )
        : null}
    </div>
  );
}
