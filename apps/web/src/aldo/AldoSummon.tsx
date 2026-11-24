// Aldo over whatever's on screen. ⌘I (Ctrl+I), or the dock's keyboard, opens a
// bar that knows which thread is open (screen.ts, which this keeps up with the
// route): things to say about it, what needs the user elsewhere (peeked at,
// and answered, right in the bar), and what's working. Typed words ask Aldo
// (↵), its answer showing under the bar as the same conversation as the home
// screen's; or go into the thread's own composer for its agent (⌘↵), to send
// from there; or jump to a thread whose title has them. With nothing typed,
// Space starts a call. On the home screen's conversation, ⌘I is its composer.
// A stalled turn's Ask Aldo (AldoStall.tsx) opens the bar with a question
// about its thread already typed.

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useLocation, useParams } from "@tanstack/react-router";
import { lazy, Suspense, useEffect } from "react";
import { create } from "zustand";

import { useThreadShells } from "../state/entities";
import { useAldoAssistantAvailable } from "./AldoAssistant";
import { seedAldoComposer } from "./assistantSession";
import { isAldoCloud, isAldoEnvironmentId } from "./api";
import { aldoHomeShowsConversation } from "./simpleMode";
import { setAldoRouteThread } from "./screen";
import { isSummonShortcut } from "./summon.logic";

const SummonBar = lazy(() => import("./AldoSummonBar").then((m) => ({ default: m.SummonBar })));

/** `query`: words the bar opens with, as if typed. */
export const useAldoSummon = create<{ readonly open: boolean; readonly query: string }>(() => ({
  open: false,
  query: "",
}));

export function openAldoSummon(): void {
  useAldoSummon.setState({ open: true });
}

/** Opens the bar with words already in it (a question about the thread on screen), to ask or edit. */
export function openAldoSummonWith(query: string): void {
  useAldoSummon.setState({ open: true, query });
}

export function closeAldoSummon(): void {
  useAldoSummon.setState({ open: false, query: "" });
}

/** The thread the route shows, for what's on screen (with its title from the sidebar). */
function useRouteThread(): void {
  const params = useParams({ strict: false }) as { environmentId?: string; threadId?: string };
  const shells = useThreadShells();
  const { environmentId, threadId } = params;
  const title = shells.find((s) => s.environmentId === environmentId && s.id === threadId)?.title;
  useEffect(() => {
    setAldoRouteThread(
      environmentId && threadId && isAldoEnvironmentId(environmentId)
        ? { environmentId, threadId, title: title ?? "this thread" }
        : null,
    );
  }, [environmentId, threadId, title]);
}

export function AldoSummon() {
  const available = useAldoAssistantAvailable();
  const open = useAldoSummon((s) => s.open);
  const { pathname } = useLocation();
  useRouteThread();
  useEffect(() => {
    if (!isAldoCloud || !available) return;
    const onKey = (event: KeyboardEvent) => {
      if (!isSummonShortcut(event) || event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      // Aldo's own page has its composer right there.
      if (pathname === "/" && aldoHomeShowsConversation()) {
        seedAldoComposer("");
        return;
      }
      useAldoSummon.setState((s) => (s.open ? { open: false, query: "" } : { open: true }));
    };
    // Before the page's own keys (an editor's italic), so it works from a composer too.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [available, pathname]);
  // Leaving the page puts the bar away.
  useEffect(() => {
    closeAldoSummon();
  }, [pathname]);
  if (!isAldoCloud || !available) return null;
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => (next ? openAldoSummon() : closeAldoSummon())}
    >
      {open ? (
        <Suspense fallback={null}>
          <SummonBar />
        </Suspense>
      ) : null}
    </DialogPrimitive.Root>
  );
}
