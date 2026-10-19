// Aldo's read of the user's work (homeApi.ts fetchAldoHome), one copy per page
// for everything that shows it: the home screen's conversation and board, the
// cards in Aldo's conversation and the summon bar (and its peek). It's kept fresh
// while something on the page shows it: with the directory, on a push, when
// the tab comes back, and every so often (a read with nothing new is a 304
// the browser answers from its cache, from an Aldo that tags it). A tab no one
// sees doesn't poll, and tabs on screen share their reads (sharedReads).

import { useEffect } from "react";
import { create } from "zustand";

import { noteAldoHiddenPrompts, pullAldoConversation, useAldoAssistant } from "./assistantSession";
import { fetchAldoHome, type AldoHome } from "./homeApi";
import { requestAldoDirectoryRefresh, subscribeAldoEnvironments } from "./directory";

import { reconcileAldoWalkthrough } from "./walkthrough";

const REFRESH_EVERY_MS = 30_000;
/** How often a page on screen looks whether its read is REFRESH_EVERY_MS old. */
const LOOK_EVERY_MS = 5_000;
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
/** When this page last read the home, or took another tab's read (sharedReads), as its next read's clock. */
let fetchedAt = 0;
let dismissalRevision = 0;
let lastServerBody: string | null = null;
/**
 * When the read the home shown comes from began, or a card was last hidden
 * here: another tab's read begun earlier could put back what changed since.
 */
let homeFrom = 0;

// Each tab on screen reads the home every 30 seconds, so windows side by
// side read it once each. A page shares each read with this browser's other
// tabs, and one on screen with the home showing takes it as its own: its
// next read waits a little longer than the reading tab's, so that one goes
// on reading for all of them while it's seen.
const SHARED_READS = "aldo-home";
/** How much later than the reading tab's a tab that took its read reads next. */
const SHARED_READ_SLACK_MS = 2_000;
let sharedReadChannel: BroadcastChannel | null | undefined;

/** A tab's read of the home, and when it began. */
interface SharedRead {
  readonly startedAt: number;
  readonly home: AldoHome | null;
}

function sharedReads(): BroadcastChannel | null {
  if (sharedReadChannel === undefined) {
    sharedReadChannel =
      typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(SHARED_READS);
    sharedReadChannel?.addEventListener("message", (event: MessageEvent<unknown>) =>
      takeSharedRead(event.data as Partial<SharedRead> | null),
    );
  }
  return sharedReadChannel;
}

function takeSharedRead(read: Partial<SharedRead> | null): void {
  const startedAt = read?.startedAt;
  // A read of this page's own under way answers for it.
  if (watchers === 0 || document.visibilityState === "hidden" || inflight) return;
  if (typeof startedAt !== "number" || startedAt <= homeFrom || read?.home === undefined) return;
  fetchedAt = Date.now() + SHARED_READ_SLACK_MS;
  homeFrom = startedAt;
  takeHome(read.home);
}

/** Shows a read of the home, this page's or another tab's. */
function takeHome(next: AldoHome | null): void {
  const body = JSON.stringify(next);
  const changed = body !== lastServerBody;
  lastServerBody = body;
  if (next && changed) noteHiddenPrompts(next);
  const state = useAldoHomeFeed.getState();
  if (changed || state.error !== null || state.supported !== Boolean(next)) {
    useAldoHomeFeed.setState({
      ...(next && changed ? { home: next } : {}),
      supported: Boolean(next),
      error: null,
    });
  }
}

/** Reads the home again; `force: false` follows the directory, no closer than every few seconds. */
export async function refreshAldoHome(force = true): Promise<void> {
  if (inflight) {
    if (force) again = true;
    return;
  }
  if (!force && Date.now() - fetchedAt < FOLLOW_DIRECTORY_MIN_MS) return;
  inflight = true;
  const revision = dismissalRevision;
  const startedAt = Date.now();
  fetchedAt = startedAt;
  try {
    const next = await fetchAldoHome();
    // A poll begun before a persisted hide must not put the card back.
    if (revision !== dismissalRevision) again = true;
    else {
      sharedReads()?.postMessage({ startedAt, home: next } satisfies SharedRead);
      homeFrom = Math.max(homeFrom, startedAt);
      takeHome(next);
    }
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
    if (!hidden()) void pullAldoConversation();
  }, REFRESH_EVERY_MS);
  const look = window.setInterval(() => {
    if (!hidden() && Date.now() - fetchedAt >= REFRESH_EVERY_MS) void refreshAldoHome();
  }, LOOK_EVERY_MS);
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
    window.clearInterval(look);
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

/** A persisted dismissal takes effect immediately, including when the next read fails. */
export function setAldoChatDecisionDismissed(id: string, dismissed: boolean): void {
  const home = useAldoHomeFeed.getState().home;
  if (!home) return;
  dismissalRevision += 1;
  homeFrom = Date.now();
  const update = <
    T extends { readonly chatDecision?: { readonly id: string; readonly dismissed: boolean } },
  >(
    item: T,
  ): T => (item.chatDecision?.id === id ? { ...item, chatDecision: { id, dismissed } } : item);
  const next = {
    ...home,
    conversations: home.conversations.map(update),
    approvals: (home.approvals ?? []).map(update),
    pullRequests: home.pullRequests.map(update),
  };
  noteHiddenPrompts(next);
  useAldoHomeFeed.setState({ home: next });
}

function noteHiddenPrompts(home: AldoHome): void {
  reconcileAldoWalkthrough(home);
  noteAldoHiddenPrompts([
    ...home.conversations
      .filter((c) => c.chatDecision?.dismissed)
      .map((c) => `${c.title}: ${c.summary ?? c.state}`),
    ...(home.approvals ?? [])
      .filter((a) => a.chatDecision?.dismissed)
      .map((a) => `${a.title}: ${a.summary}`),
    ...home.pullRequests
      .filter((pr) => pr.chatDecision?.dismissed)
      .map((pr) => `Merge #${pr.number}: ${pr.title}`),
  ]);
}
