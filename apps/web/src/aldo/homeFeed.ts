// Aldo's read of the user's work (homeApi.ts fetchAldoHome), one copy per page
// for everything that shows it: the home screen's conversation and board, the
// cards in Aldo's conversation and the summon bar (and its peek). It's kept fresh
// while something on the page shows it: with the directory, on a push, when
// the tab comes back, and every so often (a read with nothing new is a 304
// the browser answers from its cache, from an Aldo that tags it). A tab no one
// sees doesn't poll, and tabs on screen share their reads (sharedReads). What
// the user answers from here is held out of what's shown until a read says the
// thread has moved on (answered.logic.ts), so a card goes the moment it's sent.

import { useEffect } from "react";
import { create } from "zustand";

import { AldoApiError } from "./api";
import { askOf, HOLD_MS, withHolds, type AldoHolds } from "./answered.logic";
import { actionsDone } from "./assistant.logic";
import { noteAldoHiddenPrompts, pullAldoConversation, useAldoAssistant } from "./assistantSession";
import { sameTarget } from "./home.logic";
import {
  fetchAldoHome,
  type AldoHome,
  type AldoHomeConversation,
  type AldoHomeTarget,
} from "./homeApi";
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
 * Aldo's latest read, with what was done here since (a dismissal): what the
 * answers sent from here are held out of, to give the home shown.
 */
let serverHome: AldoHome | null = null;
const HOLDS_KEY = "aldo-answered";
/**
 * Answers sent from here that Aldo's read may still show unanswered, by
 * conversation. Ones Aldo has taken are kept across a reload (an answer whose
 * request hadn't reached Aldo when the page went isn't: its card is back).
 */
let holds: AldoHolds = loadHolds();
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
  if (watchers === 0 || document.visibilityState === "hidden") return;
  if (typeof startedAt !== "number" || startedAt <= homeFrom || read?.home === undefined) return;
  // A read of this page's own under way answers for it. One begun after it
  // still puts this page's next read back, so tabs that read at the same time
  // fall out of step, and one goes on reading for both.
  if (inflight) {
    if (startedAt > fetchedAt) fetchedAt = Date.now() + SHARED_READ_SLACK_MS;
    return;
  }
  fetchedAt = Date.now() + SHARED_READ_SLACK_MS;
  homeFrom = startedAt;
  takeHome(read.home);
}

function loadHolds(): AldoHolds {
  try {
    const stored = JSON.parse(localStorage.getItem(HOLDS_KEY) ?? "{}") as AldoHolds;
    const now = Date.now();
    return Object.fromEntries(
      Object.entries(stored).filter(
        ([, hold]) =>
          typeof hold?.ask === "string" &&
          typeof hold.at === "string" &&
          typeof hold.until === "number" &&
          hold.until > now,
      ),
    );
  } catch {
    return {};
  }
}

function saveHolds(): void {
  try {
    const taken = Object.entries(holds).filter(([, hold]) => hold.until !== undefined);
    if (taken.length > 0)
      localStorage.setItem(HOLDS_KEY, JSON.stringify(Object.fromEntries(taken)));
    else localStorage.removeItem(HOLDS_KEY);
  } catch {
    // No storage: the holds last as long as this page.
  }
}

// Another tab on this device answered: its accepted holds are this tab's too
// (the ones still on their way there aren't saved, and aren't taken from here).
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== HOLDS_KEY) return;
    const mine = Object.entries(holds).filter(([, hold]) => hold.until === undefined);
    holds = { ...loadHolds(), ...Object.fromEntries(mine) };
    publish();
  });
}

/** A read of the home as the page shows it: less what the user has answered since. */
function shown(home: AldoHome): AldoHome {
  const applied = withHolds(home, holds, Date.now());
  if (applied.holds !== holds) {
    holds = applied.holds;
    saveHolds();
  }
  return applied.home;
}

/** Shows the home again after a hold came or went. */
function publish(): void {
  if (serverHome) useAldoHomeFeed.setState({ home: shown(serverHome) });
}

/** Shows a read of the home, this page's or another tab's. */
function takeHome(next: AldoHome | null): void {
  const body = JSON.stringify(next);
  const changed = body !== lastServerBody;
  lastServerBody = body;
  if (next && changed) {
    serverHome = next;
    noteHiddenPrompts(next);
  }
  const state = useAldoHomeFeed.getState();
  // While an answer is held, each read is looked over again: it may be the one that has caught up.
  const holding = Object.keys(holds).length > 0;
  if (changed || holding || state.error !== null || state.supported !== Boolean(next)) {
    useAldoHomeFeed.setState({
      ...(next && serverHome && (changed || holding) ? { home: shown(serverHome) } : {}),
      supported: Boolean(next),
      error: null,
    });
  }
}

/** The read in progress, with the one that follows it if another was asked for meanwhile. */
let reading: Promise<void> = Promise.resolve();

/**
 * Reads the home again; `force: false` follows the directory, no closer than
 * every few seconds. Done once the read in progress, and any asked for while
 * it ran, has been taken.
 */
export function refreshAldoHome(force = true): Promise<void> {
  if (inflight) {
    if (force) again = true;
    return reading;
  }
  if (!force && Date.now() - fetchedAt < FOLLOW_DIRECTORY_MIN_MS) return Promise.resolve();
  inflight = true;
  reading = readHome();
  return reading;
}

async function readHome(): Promise<void> {
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
  const unsubscribeActions = useAldoAssistant.subscribe((state, previous) => {
    if (actionsDone(state.entries) > actionsDone(previous.entries)) void refreshAldoHome();
    // A reply in: a plan it proposed is a card from the home read.
    else if (previous.replying && !state.replying) void refreshAldoHome();
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
  const home = serverHome;
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
  serverHome = next;
  publish();
}

/**
 * The user sent an answer to what a conversation waits on: its card goes now,
 * and the conversation shows as carrying on, however long Aldo's read takes to
 * say so (its machine may have to wake to take the answer). Gives what was
 * answered, which keepAldoAnswer and releaseAldoAnswer need so a late result
 * can't touch the hold of a question asked since; null if it waits on nothing
 * to answer.
 */
export function holdAldoAnswer(c: AldoHomeConversation): string | null {
  const ask = askOf(c);
  if (ask === null) return null;
  holds = { ...holds, [c.ref]: { ask, at: new Date().toISOString() } };
  publish();
  return ask;
}

/** Aldo has the answer: it stays held until a read has caught up (a few minutes at most), across a reload. */
export function keepAldoAnswer(c: AldoHomeConversation, ask: string): void {
  const hold = holds[c.ref];
  if (hold?.ask !== ask) return;
  holds = { ...holds, [c.ref]: { ...hold, until: Date.now() + HOLD_MS } };
  saveHolds();
}

/** The answer wasn't taken: the card is back, as Aldo's read has it. */
export function releaseAldoAnswer(c: AldoHomeConversation, ask: string): void {
  if (holds[c.ref]?.ask !== ask) return;
  const { [c.ref]: _released, ...rest } = holds;
  holds = rest;
  saveHolds();
  publish();
}

/**
 * Sends an answer (`send`, to Aldo) to what a conversation waits on, with its
 * card gone from the first moment. It comes back only if Aldo refuses the
 * answer, saying why (the error's message); one that's only slow stays gone.
 * A refusal that says the thread has moved on (409) waits for the next read, so
 * a card that was answered elsewhere doesn't come back for a moment.
 */
export async function sendAldoAnswer<T>(
  c: AldoHomeConversation,
  send: () => Promise<T>,
): Promise<T> {
  const ask = holdAldoAnswer(c);
  try {
    const sent = await send();
    if (ask !== null) keepAldoAnswer(c, ask);
    return sent;
  } catch (cause) {
    if (cause instanceof AldoApiError && cause.status === 409) await refreshAldoHome();
    if (ask !== null) releaseAldoAnswer(c, ask);
    throw cause;
  }
}

/** An answer the assistant sent for the user (its tool call, taken by Aldo): the card goes the same way. */
export function noteAldoAnswered(target: AldoHomeTarget): void {
  const c = useAldoHomeFeed
    .getState()
    .home?.conversations.find((candidate) => sameTarget(target, candidate.thread));
  if (!c) return;
  const ask = holdAldoAnswer(c);
  if (ask !== null) keepAldoAnswer(c, ask);
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
