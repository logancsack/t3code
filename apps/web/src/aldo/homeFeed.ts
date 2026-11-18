// Aldo's read of the user's work (homeApi.ts fetchAldoHome), one copy per page
// for everything that shows it: the home screen's conversation and board, the
// cards in Aldo's conversation and the summon bar (and its peek). It's kept fresh
// while something on the page shows it: with the directory, on a push, when
// the tab comes back, and every so often (a read with nothing new is a 304
// the browser answers from its cache, from an Aldo that tags it). A tab no one
// sees doesn't poll, and tabs on screen share their reads (sharedReads). What
// the user answers from here is held out of what's shown until a read says the
// thread has moved on (answered.logic.ts), so a card goes the moment it's sent.
// The last read is kept on the device for whoever is signed in (who.ts), and
// shown at the next open until this page's first read answers.

import { useEffect } from "react";
import { create } from "zustand";

import { AldoApiError } from "./api";
import { askOf, HOLD_MS, withHolds, type AldoHolds } from "./answered.logic";
import {
  APPROVAL_HOLD_MS,
  heldStatus,
  withApprovalHolds,
  type ApprovalHolds,
} from "./approvals.logic";
import { actionsDone } from "./assistant.logic";
import { noteAldoHiddenPrompts, pullAldoConversation, useAldoAssistant } from "./assistantSession";
import { sameTarget } from "./home.logic";
import {
  decideAldoApproval,
  fetchAldoHome,
  type AldoApproval,
  type AldoChatDecision,
  type AldoHome,
  type AldoHomeConversation,
  type AldoHomeTarget,
} from "./homeApi";
import { requestAldoDirectoryRefresh, subscribeAldoEnvironments } from "./directory";
import { aldoPageInUseNow } from "./pageUse";

import { reconcileAldoWalkthrough } from "./walkthrough";
import { aldoWho } from "./who";

const REFRESH_EVERY_MS = 30_000;
/** How often a page on screen looks whether its read is REFRESH_EVERY_MS old. */
const LOOK_EVERY_MS = 5_000;
/** Directory fetches come every 15 seconds; the home read follows them no closer than this. */
const FOLLOW_DIRECTORY_MIN_MS = 8_000;
const SAVED_KEY = "aldo-home-copy";
/** How old a kept copy of the last read can be and still show at an open. */
const SAVED_FOR_MS = 24 * 60 * 60_000;

export interface AldoHomeFeed {
  readonly home: AldoHome | null;
  /** Whether this Aldo has the home read; null until it's known. */
  readonly supported: boolean | null;
  readonly error: string | null;
  /** Whether `home` is the copy this device kept of the last read, not yet this page's own. */
  readonly saved: boolean;
}

export const useAldoHomeFeed = create<AldoHomeFeed>(() => ({
  home: null,
  supported: null,
  error: null,
  saved: false,
}));

/**
 * When this page last had a read of the home, its own or another tab's (0
 * before the first: the copy kept from the last visit isn't a read). A read
 * with nothing new counts, so it says how old what's shown can be.
 */
export const useAldoHomeReadAt = create<{ readonly at: number }>(() => ({ at: 0 }));

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
 * Approvals decided from here that Aldo's read may still show waiting, by id:
 * the card goes the moment it's tapped, wherever it is shown (Home, the thread
 * that asked), and returns only if Aldo refuses the decision.
 */
let approvalHolds: ApprovalHolds = {};
/**
 * When the read the home shown comes from began, or a card was last hidden
 * here: another tab's read begun earlier could put back what changed since.
 */
let homeFrom = 0;

/** A copy of the last read, as it was kept: by whom, and when. */
interface SavedHome {
  readonly who: string;
  readonly at: number;
  readonly home: AldoHome;
}

function loadSavedHome(): AldoHome | null {
  const who = aldoWho();
  if (!who) return null;
  try {
    const saved = JSON.parse(
      localStorage.getItem(SAVED_KEY) ?? "null",
    ) as Partial<SavedHome> | null;
    if (
      saved?.who !== who ||
      typeof saved.at !== "number" ||
      Date.now() - saved.at > SAVED_FOR_MS
    ) {
      return null;
    }
    return Array.isArray(saved.home?.conversations) ? saved.home : null;
  } catch {
    return null;
  }
}

/**
 * Keeps a read (its JSON, as it came) for the next open, for whoever is
 * signed in; none, or no one known, leaves no copy.
 */
function saveHome(body: string | null): void {
  const who = body ? aldoWho() : null;
  try {
    // A SavedHome, written around the read's own JSON rather than serializing it again.
    if (body && who)
      localStorage.setItem(SAVED_KEY, `{"who":"${who}","at":${Date.now()},"home":${body}}`);
    else localStorage.removeItem(SAVED_KEY);
  } catch {
    // No storage, or too little: the next open waits for its read.
  }
}

// What Home last showed here, at once, as it was left (with what was answered
// since held out), until this page's first read answers.
const savedHome = loadSavedHome();
if (savedHome) {
  serverHome = savedHome;
  useAldoHomeFeed.setState({ home: shown(savedHome), supported: true, saved: true });
}

// Each tab on screen reads the home every 30 seconds, so windows side by
// side read it once each. A page shares each read with this browser's other
// tabs, and one on screen with the home showing takes it as its own: its
// next read waits a little longer than the reading tab's, so that one goes
// on reading for all of them while it's seen. The page in use (only one has
// focus) keeps reading for itself, so Aldo hears it's in use, and the others
// take its reads.
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
  // The page in use goes on reading for itself: its reads say it's in use
  // (homeApi.ts), which a tab left alone can't say for it.
  const ownReads = aldoPageInUseNow();
  // A read of this page's own under way answers for it. One begun after it
  // still puts this page's next read back, so tabs that read at the same time
  // fall out of step, and one goes on reading for both.
  if (inflight) {
    if (!ownReads && startedAt > fetchedAt) fetchedAt = Date.now() + SHARED_READ_SLACK_MS;
    return;
  }
  if (!ownReads) fetchedAt = Date.now() + SHARED_READ_SLACK_MS;
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
  const approved = withApprovalHolds(applied.home, approvalHolds, Date.now());
  approvalHolds = approved.holds;
  return approved.home;
}

/** Shows the home again after a hold came or went. */
function publish(): void {
  if (serverHome) useAldoHomeFeed.setState({ home: shown(serverHome) });
}

/** Shows a read of the home, this page's or another tab's. */
function takeHome(next: AldoHome | null): void {
  if (next) useAldoHomeReadAt.setState({ at: Date.now() });
  const body = JSON.stringify(next);
  const changed = body !== lastServerBody;
  lastServerBody = body;
  const state = useAldoHomeFeed.getState();
  if (changed) saveHome(next ? body : null);
  if (next && changed) {
    serverHome = next;
    noteHiddenPrompts(next);
  }
  // An Aldo without the read (rolled back) shows no copy of an earlier one.
  const unsaved = state.saved && !next;
  if (unsaved) serverHome = null;
  // While an answer is held, each read is looked over again: it may be the one that has caught up.
  const holding = Object.keys(holds).length + Object.keys(approvalHolds).length > 0;
  if (
    changed ||
    holding ||
    state.saved ||
    state.error !== null ||
    state.supported !== Boolean(next)
  ) {
    useAldoHomeFeed.setState({
      ...(next && serverHome && (changed || holding) ? { home: shown(serverHome) } : {}),
      ...(unsaved ? { home: null } : {}),
      supported: Boolean(next),
      error: null,
      saved: false,
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
    const next = await fetchAldoHome({ active: aldoPageInUseNow() });
    // A poll begun before a persisted hide must not put the card back.
    if (revision !== dismissalRevision) again = true;
    else {
      sharedReads()?.postMessage({ startedAt, home: next } satisfies SharedRead);
      homeFrom = Math.max(homeFrom, startedAt);
      takeHome(next);
    }
  } catch (cause) {
    // Signed out (api.ts sends them to sign in): nothing of theirs is kept for the next open,
    // unless a read after this one is theirs again.
    if (cause instanceof AldoApiError && cause.status === 401) {
      saveHome(null);
      lastServerBody = null;
    }
    // One that never reached Aldo (a phone just back from sleep, a network that changed)
    // goes again at the next look rather than the next refresh.
    if (!(cause instanceof AldoApiError)) fetchedAt = 0;
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

/** The home read, kept fresh while the calling component is mounted (any number share one feed); `enabled: false` only reads what's there. */
export function useAldoHomeRead(enabled = true): AldoHomeFeed {
  useEffect(() => {
    if (!enabled) return;
    watchers += 1;
    if (watchers === 1) stopFeed = startFeed();
    return () => {
      watchers -= 1;
      if (watchers === 0) {
        stopFeed?.();
        stopFeed = null;
      }
    };
  }, [enabled]);
  return useAldoHomeFeed();
}

/** Applies `change` to the decisions named `ids` in the home as it stands, now; Aldo's next read says the same. */
function changeDecisions(
  ids: ReadonlySet<string>,
  change: (decision: AldoChatDecision) => AldoChatDecision,
): void {
  const home = serverHome;
  if (!home) return;
  dismissalRevision += 1;
  homeFrom = Date.now();
  const update = <T extends { readonly chatDecision?: AldoChatDecision }>(item: T): T =>
    item.chatDecision && ids.has(item.chatDecision.id)
      ? { ...item, chatDecision: change(item.chatDecision) }
      : item;
  const next = {
    ...home,
    conversations: home.conversations.map(update),
    approvals: (home.approvals ?? []).map(update),
    pullRequests: home.pullRequests.map(update),
    ...(Array.isArray(home.plans) ? { plans: home.plans.map(update) } : {}),
  };
  noteHiddenPrompts(next);
  serverHome = next;
  publish();
}

/** A persisted dismissal takes effect immediately, including when the next read fails. */
export function setAldoChatDecisionDismissed(id: string, dismissed: boolean, until?: Date): void {
  changeDecisions(new Set([id]), (decision) => ({
    ...decision,
    dismissed,
    // Put off until then, or not (shown again, or hidden for good), as Aldo's next read will say.
    ...(decision.until !== undefined
      ? { until: dismissed && until ? until.toISOString() : null }
      : {}),
  }));
}

/** Dismissed from Needs you (or restored), as a persisted dismissal: it counts nowhere at once. */
export function setAldoDecisionsCleared(ids: ReadonlyArray<string>, cleared: boolean): void {
  changeDecisions(new Set(ids), (decision) => ({ ...decision, dismissed: cleared, cleared }));
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

/**
 * The user's decision on an approval, from wherever it's shown: it's decided
 * on every card at once, Aldo takes it after (it's claimed there, so a second
 * tap elsewhere is told how the first went and nothing is done twice), and
 * the card returns, as Aldo's read has it, only if Aldo refuses.
 */
export async function sendAldoApproval(
  approval: Pick<AldoApproval, "id" | "kind">,
  decision: "approve" | "discard" | "always",
): ReturnType<typeof decideAldoApproval> {
  const at = new Date().toISOString();
  approvalHolds = {
    ...approvalHolds,
    [approval.id]: { status: heldStatus(approval, decision), result: null, at },
  };
  publish();
  try {
    const sent = await decideAldoApproval(approval.id, decision);
    // As Aldo says it stands (decided elsewhere first, say), until a read has it too.
    approvalHolds = {
      ...approvalHolds,
      [approval.id]: {
        status: sent.approval.status,
        result: sent.approval.result,
        at,
        until: Date.now() + APPROVAL_HOLD_MS,
      },
    };
    publish();
    return sent;
  } catch (cause) {
    const { [approval.id]: _released, ...rest } = approvalHolds;
    approvalHolds = rest;
    publish();
    void refreshAldoHome();
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
