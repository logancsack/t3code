// Aldo's read of the user's work (cloud.ts fetchAldoHome), one copy per page
// for everything that shows it: the home screen's conversation and board, the
// peek, the cards in Aldo's conversation and the summon bar. It's kept fresh
// while something on the page shows it: with the directory, on a push, when
// the tab comes back, and every so often (a read with nothing new is a 304
// the browser answers from its cache, from an Aldo that tags it). A tab no one
// sees doesn't poll.

import { useEffect } from "react";
import { create } from "zustand";

import { pullAldoConversation, useAldoAssistant } from "./assistantSession";
import {
  fetchAldoHome,
  requestAldoDirectoryRefresh,
  subscribeAldoEnvironments,
  type AldoHome,
} from "./cloud";

const REFRESH_EVERY_MS = 30_000;
/** Directory fetches come every 15 seconds; the home read follows them no closer than this. */
const FOLLOW_DIRECTORY_MIN_MS = 8_000;

interface AldoHomeFeed {
  readonly home: AldoHome | null;
  /** Whether this Aldo has the home read; null until it's known. */
  readonly supported: boolean | null;
  readonly error: string | null;
}

export const useAldoHomeFeed = create<AldoHomeFeed>(() => ({
  home: null,
  supported: null,
  error: null,
}));

let inflight = false;
/** A refresh asked for during a read: the read may predate what asked, so it runs again after. */
let again = false;
let fetchedAt = 0;

/** Reads the home again; `force: false` follows the directory, no closer than every few seconds. */
export async function refreshAldoHome(force = true): Promise<void> {
  if (inflight) {
    if (force) again = true;
    return;
  }
  if (!force && Date.now() - fetchedAt < FOLLOW_DIRECTORY_MIN_MS) return;
  inflight = true;
  fetchedAt = Date.now();
  try {
    const next = await fetchAldoHome();
    useAldoHomeFeed.setState(
      next ? { home: next, supported: true, error: null } : { supported: false, error: null },
    );
  } catch (cause) {
    useAldoHomeFeed.setState({ error: cause instanceof Error ? cause.message : String(cause) });
  } finally {
    inflight = false;
  }
  if (again) {
    again = false;
    await refreshAldoHome();
  }
}

function startFeed(): () => void {
  void refreshAldoHome();
  const hidden = () => document.visibilityState === "hidden";
  // With notifications off there's no push: Aldo's heads-ups show on the regular refresh too.
  const timer = window.setInterval(() => {
    if (hidden()) return;
    void refreshAldoHome();
    void pullAldoConversation();
  }, REFRESH_EVERY_MS);
  const unsubscribe = subscribeAldoEnvironments(() => {
    if (!hidden()) void refreshAldoHome(false);
  });
  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    void refreshAldoHome();
    void pullAldoConversation();
  };
  document.addEventListener("visibilitychange", onVisible);
  // A push for a thread that finished or needs the user: refresh now rather than on the next poll.
  const onMessage = (event: MessageEvent) => {
    if ((event.data as { type?: unknown } | null)?.type !== "aldo-push") return;
    requestAldoDirectoryRefresh();
    void refreshAldoHome();
    // A heads-up is Aldo speaking: it shows in the conversation too.
    void pullAldoConversation();
  };
  const worker = "serviceWorker" in navigator ? navigator.serviceWorker : null;
  worker?.addEventListener("message", onMessage);
  // What Aldo just did shows at once.
  const acted = (entries: ReturnType<typeof useAldoAssistant.getState>["entries"]) =>
    entries.filter((e) => e.kind === "action").length;
  const unsubscribeActions = useAldoAssistant.subscribe((state, previous) => {
    if (acted(state.entries) > acted(previous.entries)) void refreshAldoHome();
  });
  return () => {
    window.clearInterval(timer);
    unsubscribe();
    unsubscribeActions();
    document.removeEventListener("visibilitychange", onVisible);
    worker?.removeEventListener("message", onMessage);
  };
}

let watchers = 0;
let stopFeed: (() => void) | null = null;

/** The home read, kept fresh while the calling component is mounted (any number share one feed). */
export function useAldoHomeRead(): AldoHomeFeed {
  useEffect(() => {
    watchers += 1;
    if (watchers === 1) stopFeed = startFeed();
    return () => {
      watchers -= 1;
      if (watchers === 0) {
        stopFeed?.();
        stopFeed = null;
      }
    };
  }, []);
  return useAldoHomeFeed();
}

// ---------------------------------------------------------------------------
// Which way the home screen shows the user's work: Aldo's conversation (the
// default) or the board; on a phone, Aldo's or the Agents tab, which the
// board's choice opens too. Kept per device.

export type AldoHomeView = "aldo" | "board" | "agents";

const VIEW_KEY = "aldo:home:view";

function storedView(): AldoHomeView {
  try {
    const stored = window.localStorage.getItem(VIEW_KEY);
    return stored === "board" || stored === "agents" ? stored : "aldo";
  } catch {
    return "aldo";
  }
}

export const useAldoHomeView = create<{ readonly view: AldoHomeView }>(() => ({
  view: typeof window === "undefined" ? "aldo" : storedView(),
}));

export function setAldoHomeView(view: AldoHomeView): void {
  useAldoHomeView.setState({ view });
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Private mode: the choice lasts this page.
  }
}
