// Talking to Aldo. The browser connects straight to Aldo's voice over WebRTC:
// the microphone goes up, Aldo's voice comes down, and the voice's events
// arrive on a data channel. The voice is GPT-Live, which listens while it
// talks and keeps the conversation going while work runs: Aldo makes the call
// from the page's WebRTC offer (its instructions and what it knows about the
// user are in it), and when the voice hands something over (a delegation),
// the page brings it to Aldo with the call's transcript so far; Aldo does it
// with its tools (an action runs only if the user asked for it) and the
// result goes back for the voice to say. A call nobody's used for a minute
// and a half is hung up: GPT-Live bills every connected second. An older Aldo
// gives a realtime call instead, whose model calls Aldo's tools itself: the
// page relays each call to Aldo with what the user said lately, and the
// result goes back to the model. What's said on either side is kept by Aldo,
// so the next conversation picks up from this one. Typed without a call on,
// the words go to Aldo in writing instead (its text model, with the same
// tools): each turn comes back with Aldo's reply and what it did. The session
// lives here, not in a screen: Aldo opening a thread moves the page, and the
// conversation carries on (the dock shows it). Aldo hears which thread is on screen (screen.ts): with each
// written turn, and on a call as it changes. A call can open with words of
// its own instead of the greeting, and the page can tell a call what it shows
// (going through decisions, walkthrough.ts). A thread Aldo starts shows in the
// sidebar at once, and is followed until its first turn is under way: if it
// has to wait, runs into trouble, can't start or stops at once (an agent
// signed out), Aldo says so (or, once the conversation has ended, a toast
// does). On a GPT-Live call, what comes back of work handed over (an answer,
// a question for the user, a failure, a start that has to wait) and what an
// agent tells the user itself are Aldo's to tell (followups): the page asks
// for them while the call is on, and the voice brings each up unprompted at
// a pause, once (an Aldo that has them tells of a start itself, too).

import {
  voiceReferencesOf,
  mergeVoiceReferences,
  type AldoVoiceReference,
} from "./voiceReferences";
import { minimizeAldoCall } from "./callView";
import { create } from "zustand";

import { toastManager } from "../components/ui/toast";
import {
  actionFor,
  callLinksFrom,
  followupAction,
  followupPrompt,
  followupsEvery,
  functionCallsIn,
  newsPause,
  NEWS_UNSPOKEN_MS,
  openTargetOf,
  previewOf,
  phaseAfter,
  rememberHeard,
  screenNote,
  startNews,
  startWatchFor,
  isCallEntry,
  unseenMessages,
  withCalls,
  withoutRetriedFailures,
  type AldoAssistantAction,
  type AldoAssistantMessage,
  type AldoAssistantPhase,
  type AldoFunctionCall,
  type AldoOnScreen,
  type AldoOpenTarget,
  type AldoStartNews,
  type AldoStartWatch,
  type AldoCallEntry,
} from "./assistant.logic";
import { AldoApiError } from "./api";
import { noteAldoAnswered } from "./homeFeed";
import {
  aldoAssistant,
  type AldoHistory,
  requestAldoProfile,
  type AldoChatTurn,
  type AldoFollowupNews,
  type AldoFileUpload,
  type AldoImageUpload,
} from "./assistantApi";
import { dropHomeMessage, homeMessages, keepHomeMessage } from "./homeOutbox";
import {
  getAldoEnvironments,
  requestAldoDirectoryRefresh,
  subscribeAldoEnvironments,
} from "./directory";
import {
  AldoLiveTranscript,
  cutForLive,
  idleCall,
  livePhase,
  splitForLive,
  type AldoLiveTurn,
} from "./liveTranscript.logic";
import { aldoOnScreen, subscribeAldoOnScreen } from "./screen";
import {
  checkoutReturnOf,
  confirmAgainIn,
  keptStep,
  needsPlanOf,
  saidAlready,
  withoutCheckoutReturn,
  type AldoKept,
  type AldoKeptRequest,
  type AldoNeedsPlan,
  type AldoResumed,
} from "./planPicker.logic";

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
/** How long a tool call waits for the transcript of what the user just said. */
const TRANSCRIPT_WAIT_MS = 8_000;
const LEVELS_EVERY_MS = 120;
const GREETING =
  "Pick up the call: greet the user in a few words, warmly, like a colleague. If something needs them, say so in the same breath. Don't list anything.";
/** GPT-Live's greeting (it waits for the user unless told to say something, plainly). They opened the call, so they know who it is. */
const LIVE_GREETING =
  "Say hello to the user now. They opened this call, so there's no need to say who you are: pick up the way a colleague would, in a few words (\"Hey, what's up?\"). If something needs them, say so in the same breath, then let them talk.";
/**
 * A request still being worked on after this long gets a word that it is, so the line isn't silent: a different one
 * each time, promising no time. Only a ninth slow request on one call hears one again, which beats silence.
 */
const STILL_WORKING_MS = 6_000;
const STILL_WORKING = [
  "Still on it.",
  "Bear with me, I'm still working on that.",
  "Hang on, still working through this one.",
  "Still going. I'll tell you as soon as it's done.",
  "Still with you, this one's taking a while.",
  "Working on it, hang tight.",
  "Not done yet, still at it.",
  "Still digging into that.",
];
/** A delegation waits this long (the call's time) for the user to stop talking, so it has their whole request. */
const SETTLE_MS = 700;
const SETTLE_MAX_MS = 2_500;
/** A delegation's request is the user's words transcribed up to about where it was made (its offset on the call's timeline). */
const HEARD_SLACK_MS = 1_500;
/** What the voice says when a result it was sent was refused (OpenAI rejects an update it can't take): it's on screen instead. */
const UNSAID = "I couldn't read that one out, so it's on your screen now.";
/** GPT-Live bills every connected second: a call nobody's used for this long is hung up. */
const IDLE_MS = 90_000;
/** How long a GPT-Live call has to start once OpenAI has answered. */
const START_MS = 20_000;
/** What a call that ran out of the period's voice minutes ends with. */
const VOICE_USED_UP = "This month's voice minutes are used up. Type to Aldo until they renew.";
/** How long hanging up waits for GPT-Live to confirm the call is closed (and billing stopped) before letting go. */
const CLOSE_WAIT_MS = 3_000;
/** What one update to the voice takes (500 tokens), with room to spare. */
const APPEND_TOKENS = 450;
/** Aldo's voice louder than this is Aldo speaking (GPT-Live streams silence between words). */
const SPEAKING_LEVEL = 0.01;

export type AldoConversationEntry =
  | ({ readonly kind: "message" } & AldoAssistantMessage)
  | ({ readonly kind: "action" } & AldoAssistantAction)
  | AldoCallEntry;

/**
 * The plan picker under a request Aldo kept until a plan's chosen
 * (planPicker.logic.ts; AldoPlanPicker.tsx shows it under `entry`).
 */
export interface AldoPlanPick {
  /** The kept request. */
  readonly requestId: string;
  /** The user's message it's under. */
  readonly entry: AldoConversationEntry;
  /** What the picker offers; null when the plan was on before the page asked (back from Checkout). */
  readonly needs: AldoNeedsPlan | null;
  /**
   * choose: pick a plan and pay; confirming: Aldo sends the request (back
   * from Checkout, confirming the plan first); on: it went, on `plan`;
   * waiting: it's still kept (Stripe hasn't confirmed the plan, or Aldo
   * couldn't be reached), and `note` says why.
   */
  readonly stage: "choose" | "confirming" | "on" | "waiting";
  readonly plan: string | null;
  readonly note: string | null;
  /** Checkout's session, back from it: Aldo confirms the plan by it. */
  readonly checkoutSession: string | null;
}

interface AldoAssistantState {
  readonly references: ReadonlyArray<AldoVoiceReference>;
  readonly phase: AldoAssistantPhase;
  readonly error: string | null;
  /** The microphone is on for this conversation (off: typed only, or the user muted it). */
  readonly micOn: boolean;
  readonly muted: boolean;
  /** What Aldo is saying now, as it says it. */
  readonly said: string;
  readonly entries: ReadonlyArray<AldoConversationEntry>;
  readonly historyLoaded: boolean;
  /** Loudness of the user's microphone and of Aldo's voice, 0 to 1. */
  readonly levels: { readonly mic: number; readonly aldo: number };
  /** What the user typed that couldn't be sent (the conversation didn't start), for the composer to give back. */
  readonly unsent: string | null;
  /** Images that couldn't be sent with it, given back the same way. */
  readonly unsentImages: ReadonlyArray<AldoImageUpload> | null;
  /** And files (uploaded already, so named only). */
  readonly unsentFiles: ReadonlyArray<AldoFileUpload> | null;
  /** A written reply is on its way (typed without a call on). */
  readonly replying: boolean;
  /**
   * Written messages not through to Aldo, shown under each: `error` null while
   * the page sends it again by itself ("Sending…"), else why it isn't sent
   * yet (it may still be trying).
   */
  readonly undelivered: ReadonlyArray<{
    readonly entry: AldoConversationEntry;
    readonly error: string | null;
  }>;
  /** When the call connected (ms), for how long it's been on; null without one. */
  readonly connectedAt: number | null;
  /** Where the call's own entries start in `entries`: what was said and done on it. */
  readonly callFrom: number;
  /** Aldo's voice is off on this device: its words still show. */
  readonly voiceOff: boolean;
  /** A request kept until a plan's chosen, and the picker under it. */
  readonly planPick: AldoPlanPick | null;
}

export const useAldoAssistant = create<AldoAssistantState>(() => ({
  references: [],
  phase: "idle",
  error: null,
  micOn: false,
  muted: false,
  said: "",
  entries: [],
  historyLoaded: false,
  levels: { mic: 0, aldo: 0 },
  unsent: null,
  unsentImages: null,
  unsentFiles: null,
  replying: false,
  undelivered: [],
  connectedAt: null,
  callFrom: 0,
  voiceOff: false,
  planPick: null,
}));

const set = (patch: Partial<AldoAssistantState>) => useAldoAssistant.setState(patch);
const get = () => useAldoAssistant.getState();

let peer: RTCPeerConnection | null = null;
let channel: RTCDataChannel | null = null;
let microphone: MediaStream | null = null;
let speaker: HTMLAudioElement | null = null;
let sessionId: string | null = null;
let heard: ReadonlyArray<string> = [];
/** What the user said that's still being transcribed (by conversation item). */
const transcribing = new Set<string>();
let levelsTimer: ReturnType<typeof setInterval> | null = null;
/** Typed before the conversation was connected: sent once it is, instead of the greeting. */
let queuedText: string | null = null;
export function openAldoVoiceThread(target: AldoOpenTarget): void {
  minimizeAldoCall();
  openThread?.(target);
}

let openThread: ((target: AldoOpenTarget) => void) | null = null;
/** The written conversation's session with Aldo, continued turn after turn. */
let chatSessionId: string | null = null;
/** Whether this Aldo can chat in writing; null until tried. An older one takes typing on a call instead. */
let chatSupported: boolean | null = null;
/** A request Aldo kept is being sent (sendKept). */
let resuming = false;
/**
 * A response has been asked for or is being made (only one at a time), or
 * tool calls run (their results then ask for one).
 */
let responding = false;
let calling = false;
/**
 * News for Aldo, in the conversation already, that came while it was busy: no
 * response since has had it, so the next one asked for is its (or, if the
 * conversation ends first, a toast).
 */
let newsWaiting: AldoStartNews[] = [];
/** Threads this page started through Aldo, until they've started (or couldn't). */
let startWatches: ReadonlyArray<AldoStartWatch> = [];
let stopWatchingStarts: (() => void) | null = null;
/** What the call was last told is on screen (screenNote), so it hears only changes. */
let toldScreen: string | null = null;
/** The page told the call something to say while it was busy: the next response is asked for once it's free. */
let promptWaiting = false;
let stopWatchingScreen: (() => void) | null = null;
/** This call is on GPT-Live (otherwise, a realtime call from an older Aldo). */
let live = false;
/** GPT-Live said the call started: it takes updates now. */
let liveStarted = false;
/** What the call says first instead of the greeting, once it starts. */
let liveOpening: string | undefined;
/** What's been said on the call, as turns (GPT-Live sends fragments). */
let transcript: AldoLiveTranscript | null = null;
/** Requests the voice handed over that Aldo is working on (and typed words it is). */
const delegating = new Map<string, AbortController>();
/** Results sent to the voice (what they said), by the event id OpenAI names if it refuses one. */
const results = new Map<string, string>();
let eventNumber = 0;
/** How many times this call has said it's still working on something, for the next to differ. */
let waits = 0;
/** When anyone last said anything on the call (wall clock), for hanging up one nobody's using. */
let lastSpokeAt = 0;
/** Whether this Aldo tells a call what came back of work it handed over; null until asked. */
let followupsSupported: boolean | null = null;
/** What's back to tell, as Aldo last said (in the order to say it), and how much is still working. */
let followups: ReadonlyArray<AldoFollowupNews> = [];
let following = 0;
let followupsTimer: ReturnType<typeof setTimeout> | null = null;
let followupsDue = 0;
let readingFollowups = false;
let tellingFollowup = false;
/** News claimed for this call and not yet said: said at the next pause, or kept in the conversation if the call ends first. */
let claimed: { news: AldoFollowupNews; line: string; session: string } | null = null;
/** When the last result or news went to the voice, and how far Aldo's words had come then (past it, it's being said). */
let resultSentAt = 0;
let sentFrom = 0;
let newsSaidAt = 0;
let liveTimer: ReturnType<typeof setInterval> | null = null;
/** The connection a GPT-Live session is being made for: one hung up meanwhile is closed with OpenAI, not just dropped. */
let startingLive: RTCPeerConnection | null = null;
let startTimer: ReturnType<typeof setTimeout> | null = null;
/** Ends the call when the voice minutes Aldo said it had left are used up. */
let voiceLimitTimer: ReturnType<typeof setTimeout> | null = null;

/** How the conversation opens a thread on the page (the router, from the dock). */
export function setAldoAssistantNavigator(
  navigate: ((target: AldoOpenTarget) => void) | null,
): void {
  openThread = navigate;
}

/**
 * Opens the app a tool's result names (open_preview) in a new tab. A browser
 * may block it outside a click; the conversation links to it either way.
 */
function openPreview(outcome: unknown): void {
  const url = previewOf(outcome);
  if (url && typeof window !== "undefined") window.open(url, "_blank", "noopener");
}

export function aldoAssistantLive(): boolean {
  const { phase } = get();
  return phase !== "idle" && phase !== "error";
}

function addEntry(entry: AldoConversationEntry): void {
  // What the call does is on its card.
  set({
    entries: [
      ...get().entries,
      entry.kind === "action" && callOpen ? { ...entry, call: callOpen } : entry,
    ],
  });
}

/**
 * What was said on the call shows on the call screen, and Aldo keeps it in the call's session (`session`, even as it
 * closes): on Home it's the call card's transcript, not a message. `turn` is false for news the call never said,
 * which is a message of its own.
 */
function say(
  role: "user" | "assistant",
  text: string,
  session: string | null = sessionId,
  turn = true,
): void {
  const words = text.trim();
  if (!words) return;
  const call = turn && callCards === true && session ? { call: session } : {};
  addEntry({ kind: "message", role, text: words, at: new Date().toISOString(), ...call });
  if (!session) return;
  const kept = aldoAssistant
    .record(session, [{ role, text: words, ...(turn ? {} : { call: false as const }) }])
    .catch(() => {});
  recording.add(kept);
  void kept.finally(() => recording.delete(kept));
}

function send(event: Record<string, unknown>): void {
  if (channel?.readyState === "open") channel.send(JSON.stringify(event));
}

/** The newest message read from Aldo, so a later read adds only what came after it. */
let historyUntil: string | null = null;
/**
 * Whether this Aldo shows a call as one card (null until the conversation is read). An older one keeps every
 * turn as a message, so a call's lines show as they always did.
 */
let callCards: boolean | null = null;
/** The call on now (its session), whose lines and actions the conversation leaves to its card. */
let callOpen: string | null = null;
/** What the call has said to Aldo that isn't through yet: its end waits for the last words. */
const recording = new Set<Promise<unknown>>();
/** Messages that came from Aldo's record, or were found in it: the rest were said on this page and not read back yet. */
const recorded = new WeakSet<AldoConversationEntry>();

function fromRecord(items: AldoHistory): AldoConversationEntry[] {
  const entries = items.map((item): AldoConversationEntry =>
    "kind" in item ? item : { kind: "message", ...item },
  );
  for (const entry of entries) recorded.add(entry);
  return entries;
}

/** The messages among what Aldo kept (its calls are cards). */
const messagesOf = (items: AldoHistory) => items.flatMap((item) => ("kind" in item ? [] : [item]));

/** The conversation so far, from Aldo (once per page). */
let loadingHistory: Promise<void> | null = null;

export function loadAldoConversation(): Promise<void> {
  if (get().historyLoaded) return Promise.resolve();
  // One load at a time, or two on the page at once would each add what was said.
  loadingHistory ??= (async () => {
    const items = await aldoAssistant.history().catch(() => null);
    const messages = messagesOf(items ?? []);
    callCards = items ? items.calls === true : null;
    historyUntil = messages.at(-1)?.at ?? historyUntil;
    set({
      historyLoaded: true,
      // Anything said since the page opened stays after what came before.
      entries: [...fromRecord(items ?? []), ...get().entries],
    });
    void settleKept().catch(() => {});
    void resendKept(messages);
  })();
  return loadingHistory;
}

// ---------------------------------------------------------------------------
// A request sent before choosing a plan (planPicker.logic.ts)

/** The plan this tab chose in the picker, for "You're on <plan>" back from Checkout when Aldo doesn't name it. */
const PICKED_PLAN_KEY = "aldo:picked-plan";

/** Notes the plan the user is about to pay for in the picker (AldoPlanPicker.tsx), for the way back. */
export function noteAldoPickedPlan(name: string): void {
  try {
    sessionStorage.setItem(PICKED_PLAN_KEY, name);
  } catch {
    // No storage: Aldo names the plan itself.
  }
}

function pickedPlan(): string | null {
  try {
    const name = sessionStorage.getItem(PICKED_PLAN_KEY);
    sessionStorage.removeItem(PICKED_PLAN_KEY);
    return name || null;
  } catch {
    return null;
  }
}

function keptEntry(request: Pick<AldoKeptRequest, "text" | "at">): AldoConversationEntry {
  return { kind: "message", role: "user", text: request.text, at: request.at };
}

/**
 * Once a page has the conversation: a request Aldo kept shows again with the
 * picker, or, back from Checkout or with a plan on (a tab closed meanwhile),
 * goes as the user's message. The way back's address is read once.
 */
async function settleKept(): Promise<void> {
  const returning = checkoutReturnOf(window.location.search);
  if (returning) {
    const { pathname, search, hash } = window.location;
    window.history.replaceState(
      window.history.state,
      "",
      `${pathname}${withoutCheckoutReturn(search)}${hash}`,
    );
  }
  const kept = await keptOnLoad();
  const step = keptStep(returning, kept);
  // This page has one already (sent before Aldo answered).
  if (step.kind === "nothing" || get().planPick) return;
  if (step.kind === "pick") {
    const entry = keptEntry(step.request);
    addEntry(entry);
    set({ planPick: pick(step.needs.requestId, entry, step.needs, "choose") });
    return;
  }
  const entry = step.request ? keptEntry(step.request) : null;
  if (entry) addEntry(entry);
  await sendKept(step.requestId, entry, step.needs, step.checkoutSession, step.returning);
}

/** What Aldo keeps, asked again for a little while if it can't be reached (null: it couldn't say). */
async function keptOnLoad(): Promise<AldoKept | null> {
  for (const wait of [0, 2_000, 5_000]) {
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      return await aldoAssistant.kept();
    } catch {
      // Offline or a server error: ask again.
    }
  }
  return null;
}

/** The images a message on this page went with, to give back with its words if it's refused. */
const sentImages = new WeakMap<AldoConversationEntry, ReadonlyArray<AldoImageUpload>>();

function pick(
  requestId: string,
  entry: AldoConversationEntry,
  needs: AldoNeedsPlan | null,
  stage: AldoPlanPick["stage"],
  more: Partial<Pick<AldoPlanPick, "plan" | "note" | "checkoutSession">> = {},
): AldoPlanPick {
  return {
    requestId,
    entry,
    needs,
    stage,
    plan: more.plan ?? null,
    note: more.note ?? null,
    checkoutSession: more.checkoutSession ?? null,
  };
}

/** Sends the kept request again: the picker's "Check again", or once Checkout says the user has a plan already. */
export async function resumeAldoKept(): Promise<void> {
  const current = get().planPick;
  if (!current || current.stage === "confirming" || current.stage === "on") return;
  await sendKept(current.requestId, current.entry, current.needs, current.checkoutSession, true);
}

/**
 * After a turn that went ("What can you do?" goes without a plan): once a plan
 * is on (chosen elsewhere), the request still kept goes too, as the picker
 * promised; one that's gone (sent from another tab) leaves the page.
 */
async function sendKeptOnceFree(): Promise<void> {
  const current = get().planPick;
  if (!current || (current.stage !== "choose" && current.stage !== "waiting")) return;
  const kept = await aldoAssistant.kept().catch(() => null);
  if (!kept || get().planPick !== current) return;
  if (!kept.pending) {
    await settleGone(current.entry, current.entry.kind === "message" ? current.entry.text : "");
    return;
  }
  // Back from Checkout (a session to confirm the plan by), it asks too.
  if (kept.pending.id === current.requestId && (!kept.needsPlan || current.checkoutSession)) {
    await resumeAldoKept();
  }
}

/**
 * Asks Aldo to send the kept request (`entry`, its message on the page, when
 * it knows the words), and shows what came of it. Back from Checkout
 * (`returning`), a plan Stripe hasn't confirmed yet is asked about again for
 * a little while.
 */
async function sendKept(
  requestId: string,
  entry: AldoConversationEntry | null,
  needs: AldoNeedsPlan | null,
  checkoutSession: string | null,
  returning: boolean,
): Promise<void> {
  if (get().replying) {
    // Another reply is on its way: the request waits under its picker, and goes once that's in (sendKeptOnceFree).
    if (entry) {
      set({
        planPick: pick(requestId, entry, needs, "waiting", {
          checkoutSession,
          note: "Your request is saved, and goes as soon as Aldo has answered.",
        }),
      });
    }
    return;
  }
  resuming = true;
  set({
    error: null,
    ...(entry
      ? { planPick: pick(requestId, entry, needs, "confirming", { checkoutSession }) }
      : {}),
  });
  syncReplying();
  try {
    for (let attempt = 0; ; attempt++) {
      const outcome = await aldoAssistant.resume(requestId, chatSessionId, checkoutSession);
      const wait = outcome.kind === "needsPlan" && returning ? confirmAgainIn(attempt) : null;
      if (wait === null) {
        await showResumed(outcome, requestId, entry, checkoutSession, returning);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  } finally {
    resuming = false;
    syncReplying();
  }
}

async function showResumed(
  outcome: AldoResumed,
  requestId: string,
  shown: AldoConversationEntry | null,
  checkoutSession: string | null,
  returning: boolean,
): Promise<void> {
  const text = shown?.kind === "message" ? shown.text : "";
  const ensure = (words: string) => {
    if (shown) return shown;
    const entry = keptEntry({ text: words, at: new Date().toISOString() });
    addEntry(entry);
    return entry;
  };
  switch (outcome.kind) {
    case "sent": {
      const entry = ensure(outcome.text || text);
      chatSupported = true;
      chatSessionId = outcome.turn.sessionId;
      heard = rememberHeard(heard, outcome.text || text);
      const plan = outcome.plan ?? pickedPlan();
      set({ planPick: pick(requestId, entry, get().planPick?.needs ?? null, "on", { plan }) });
      showCalls(outcome.turn.calls);
      addEntry({
        kind: "message",
        role: "assistant",
        text: outcome.turn.reply,
        at: new Date().toISOString(),
        ...(outcome.turn.artifacts ? { artifacts: outcome.turn.artifacts } : {}),
      });
      return;
    }
    case "needsPlan": {
      const entry = ensure(outcome.needs.text);
      set({
        planPick: pick(
          outcome.needs.requestId,
          entry,
          outcome.needs,
          returning ? "waiting" : "choose",
          returning
            ? {
                checkoutSession,
                note: "Stripe hasn’t confirmed your plan yet. Your request is saved, and goes as soon as it does.",
              }
            : {},
        ),
      });
      return;
    }
    case "refused": {
      // Not kept for what a plan doesn't fix: the words go back to the composer, with why.
      const images = shown ? sentImages.get(shown) : undefined;
      const files = shown?.kind === "message" ? shown.files : undefined;
      dropShown(shown);
      set({
        error: outcome.message,
        ...(text ? { unsent: text } : {}),
        ...(images && images.length > 0 ? { unsentImages: images } : {}),
        ...(files && files.length > 0 ? { unsentFiles: files } : {}),
      });
      return;
    }
    case "failed": {
      // Whether it went: still kept, it waits for another try; else the conversation says.
      const kept = await aldoAssistant.kept().catch(() => null);
      if (kept?.pending?.id === requestId && shown) {
        set({
          planPick: pick(requestId, shown, get().planPick?.needs ?? null, "waiting", {
            checkoutSession,
            note: `${/[.?!]$/.test(outcome.message) ? outcome.message : `${outcome.message}.`} Your request is saved.`,
          }),
        });
        return;
      }
      await settleGone(shown, text);
      if (!saidAlready(messagesIn(get().entries), text)) set({ error: outcome.message });
      return;
    }
    case "gone":
      await settleGone(shown, text);
      return;
  }
}

function dropShown(shown: AldoConversationEntry | null): void {
  set({ entries: get().entries.filter((e) => e !== shown), planPick: null });
}

/**
 * The request isn't kept any more: sent (another tab), or it was never sent.
 * What was said comes from Aldo, and words that never went go back to the
 * composer.
 */
async function settleGone(shown: AldoConversationEntry | null, text: string): Promise<void> {
  dropShown(shown);
  await pullAldoConversation();
  if (text && !saidAlready(messagesIn(get().entries), text)) set({ unsent: text });
}

function messagesIn(entries: ReadonlyArray<AldoConversationEntry>) {
  return entries.flatMap((e) => (e.kind === "message" ? [e] : []));
}

/**
 * What was said since the conversation loaded that the page doesn't show: a
 * heads-up Aldo gave, or a turn on another device, added at its end. Run on
 * the home screen's refresh, and when a push arrives.
 */
export async function pullAldoConversation(): Promise<void> {
  if (!get().historyLoaded) return;
  const history = await aldoAssistant.history(20).catch(() => null);
  if (!history?.length) return;
  const messages = messagesOf(history);
  callCards = history.calls === true;
  // What was said on this page's calls isn't read back (Aldo keeps it as a card's transcript).
  const said = get().entries.flatMap((e) =>
    e.kind === "message" && !recorded.has(e) && !e.call ? [e] : [],
  );
  const { fresh, matched } = unseenMessages(said, messages, historyUntil);
  const calls = history.flatMap((item) => ("kind" in item ? [item] : []));
  const shown = get().entries;
  const entries = withCalls(shown, calls, historyUntil);
  historyUntil = messages.at(-1)?.at ?? historyUntil;
  for (const entry of matched) recorded.add(entry);
  // What's new, calls and messages alike, goes after what's shown in the order Aldo kept it.
  const added = [...entries.slice(shown.length), ...fromRecord(fresh)].toSorted((a, b) =>
    "at" in a && "at" in b ? a.at.localeCompare(b.at) : 0,
  );
  if (added.length > 0 || entries !== shown)
    set({ entries: [...entries.slice(0, shown.length), ...added] });
}

async function transcriptsSettled(): Promise<void> {
  const deadline = Date.now() + TRANSCRIPT_WAIT_MS;
  while (transcribing.size > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Asks for a response, which has everything in the conversation so far. One
 * asked for while another is on its way is refused, so news keeps waiting.
 */
function requestResponse(response?: Record<string, unknown>): void {
  if (!responding) newsWaiting = [];
  responding = true;
  send(response ? { type: "response.create", response } : { type: "response.create" });
}

/**
 * Tells the call what's on screen when that changes: a note in the
 * conversation, for its next response (it doesn't ask for one). The first is
 * told only when there's a thread to name.
 */
function tellScreen(): void {
  if (channel?.readyState !== "open" || (live && !liveStarted)) return;
  const onScreen: AldoOnScreen | null = aldoOnScreen();
  const note = screenNote(onScreen);
  if (note === toldScreen || (toldScreen === null && !onScreen)) return;
  toldScreen = note;
  if (live) {
    appendLive("session.thinking.append", note);
    return;
  }
  send({
    type: "conversation.item.create",
    item: { type: "message", role: "system", content: [{ type: "input_text", text: note }] },
  });
}

function toastStartNews(news: AldoStartNews): void {
  const failed = news.state === "failed" || news.state === "stopped";
  toastManager.add({
    id: news.id,
    type: failed ? "error" : "info",
    title: news.label,
    timeout: failed ? 0 : 10_000,
  });
}

/**
 * News for Aldo to tell the user, in the conversation: now, or once it's free
 * (a response on its way, tool calls running, or the user speaking, whose
 * words get a response of their own first).
 */
function tellAldo(news: AldoStartNews): void {
  if (live) {
    appendLive("session.instructions.append", news.prompt);
    return;
  }
  send({
    type: "conversation.item.create",
    item: { type: "message", role: "system", content: [{ type: "input_text", text: news.prompt }] },
  });
  const phase = get().phase;
  if (calling || responding || phase === "hearing" || phase === "thinking")
    newsWaiting = [...newsWaiting, news];
  else requestResponse();
}

function tellStartNews(watch: AldoStartWatch, news: AldoStartNews): void {
  const id = `start-${watch.environmentId}-${watch.threadId}`;
  news = { ...news, id };
  // On a call where Aldo tells what came of its work (followups), it tells this too, with a line of its own:
  // only a retry, which it doesn't tell, shows here.
  const aldoTells = live && liveStarted && followupsSupported === true;
  if (aldoTells && news.state !== "retrying") return;
  addEntry({
    kind: "action",
    id,
    tool: "start_status",
    label: news.label,
    failed: news.state === "failed" || news.state === "stopped",
    open: { environmentId: watch.environmentId, threadId: watch.threadId },
  });
  // Retrying is a retractable status, not a spoken reply kept in chat history.
  if (news.state === "retrying") return toastStartNews(news);
  if (aldoTells) return;
  if (aldoAssistantLive() && channel?.readyState === "open" && (!live || liveStarted))
    tellAldo(news);
  else toastStartNews(news);
}

/** On every directory fetch: how the threads Aldo started stand. */
function checkStarts(): void {
  const environments = getAldoEnvironments();
  const next: AldoStartWatch[] = [];
  for (const watch of startWatches) {
    const { news, done } = startNews(watch, environments, Date.now());
    const environment = environments?.find((e) => e.environmentId === watch.environmentId);
    if (news || done || (environment?.starts && !environment.starts[watch.threadId])) {
      const id = `start-${watch.environmentId}-${watch.threadId}`;
      toastManager.close(id);
      set({ entries: get().entries.filter((entry) => entry.kind !== "action" || entry.id !== id) });
      newsWaiting = newsWaiting.filter((entry) => entry.id !== id);
    }
    if (news) tellStartNews(watch, news);
    if (!done) next.push(news ? { ...watch, told: [...watch.told, news.state] } : watch);
  }
  startWatches = next;
  if (next.length === 0) {
    stopWatchingStarts?.();
    stopWatchingStarts = null;
  }
}

function watchStart(watch: AldoStartWatch): void {
  startWatches = [...startWatches, watch];
  stopWatchingStarts ??= subscribeAldoEnvironments(checkStarts);
}

/** The tools that answer what a thread waits on. */
const ANSWERING_TOOLS: ReadonlySet<string> = new Set(["answer_thread", "approve_plan"]);

/**
 * What a tool call did, on the page: the thread it opened or the app it
 * previewed, a line in the conversation, and a thread it started followed
 * until it's under way.
 */
function showCall(call: AldoFunctionCall, outcome: unknown): void {
  if (aldoAssistantLive())
    set({
      references: mergeVoiceReferences(
        get().references,
        voiceReferencesOf((outcome as { references?: unknown } | null)?.references),
      ),
    });
  const open = openTargetOf(outcome);
  if (
    open &&
    aldoAssistantLive() &&
    !get().references.some(
      (r) =>
        r.kind === "thread" &&
        r.target.environmentId === open.environmentId &&
        r.target.threadId === open.threadId,
    )
  ) {
    set({
      references: mergeVoiceReferences(get().references, [
        { kind: "thread", title: "Open thread", target: open },
      ]),
    });
  } else if (open && !aldoAssistantLive()) openThread?.(open);
  openPreview(outcome);
  const action = actionFor(call, outcome);
  // Why it failed stays out of the conversation (Aldo says it), but not out of sight.
  if (action?.detail) console.warn(`Aldo: ${action.label}:`, action.detail);
  // A call is shown as it comes: a request tried again replaces its failed try, even when the try has nothing to show.
  const { entries, callFrom } = get();
  const kept = withoutRetriedFailures(entries, call, outcome, callFrom);
  if (action)
    set({
      entries: [...kept, { kind: "action", ...action, ...(callOpen ? { call: callOpen } : {}) }],
    });
  else if (kept !== entries) set({ entries: kept });
  // What it changed shows in the sidebar now (a new thread at once), not on the next refresh.
  if (action && !action.failed) requestAldoDirectoryRefresh();
  // An answer or approval it sent for the user: the card goes as it does with a tap, without waiting for the thread to report.
  if (action?.open && !action.failed && ANSWERING_TOOLS.has(action.tool))
    noteAldoAnswered(action.open);
  const watch = startWatchFor(call, outcome, Date.now());
  if (watch) watchStart(watch);
}

function showCalls(calls: AldoChatTurn["calls"]): void {
  for (const call of calls) {
    showCall({ callId: call.callId, name: call.name, arguments: call.arguments }, call.outcome);
  }
}

async function runCalls(calls: ReadonlyArray<AldoFunctionCall>): Promise<void> {
  set({ phase: "thinking" });
  calling = true;
  for (const call of calls) {
    // An action is checked against what the user said: wait for the words they just spoke.
    await transcriptsSettled();
    const outcome = sessionId
      ? await aldoAssistant
          .runTool(call.name, call.arguments, sessionId, heard)
          .catch((error: unknown) => ({
            error: error instanceof Error ? error.message : String(error),
          }))
      : { error: "The conversation ended." };
    showCall(call, outcome);
    send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: call.callId, output: JSON.stringify(outcome) },
    });
  }
  calling = false;
  requestResponse();
}

function onEvent(event: { type: string } & Record<string, unknown>): void {
  const next = phaseAfter(get().phase, event.type);
  if (next) set({ phase: next });
  switch (event.type) {
    case "input_audio_buffer.committed":
      if (typeof event.item_id === "string") transcribing.add(event.item_id);
      break;
    case "conversation.item.input_audio_transcription.completed": {
      if (typeof event.item_id === "string") transcribing.delete(event.item_id);
      const text = typeof event.transcript === "string" ? event.transcript : "";
      heard = rememberHeard(heard, text);
      say("user", text);
      break;
    }
    case "conversation.item.input_audio_transcription.failed":
      if (typeof event.item_id === "string") transcribing.delete(event.item_id);
      break;
    case "response.created":
      // One the server made itself (the user stopped speaking).
      responding = true;
      set({ said: "" });
      break;
    case "response.output_audio_transcript.delta":
      if (typeof event.delta === "string") set({ said: get().said + event.delta });
      break;
    case "response.output_audio_transcript.done":
      if (typeof event.transcript === "string") say("assistant", event.transcript);
      break;
    case "response.done": {
      responding = false;
      const calls = functionCallsIn(event);
      if (calls.length > 0) void runCalls(calls);
      else if (newsWaiting.length > 0 || promptWaiting) {
        promptWaiting = false;
        requestResponse();
      }
      break;
    }
    case "error": {
      const message = (event.error as { message?: unknown } | undefined)?.message;
      if (typeof message === "string") set({ error: message });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// A call on GPT-Live

/**
 * An update for the voice: instructions, quiet context, or something to say
 * (500 tokens each at most). Instructions and context too long for one go in
 * parts, a paragraph at a time; something to say is cut short. A `result`
 * (what Aldo found or did, not progress) is kept until the voice takes it, so
 * one it refuses can be shown instead.
 */
function appendLive(
  type: "session.instructions.append" | "session.thinking.append" | "session.commentary.append",
  content: string,
  delegationId: string | null = null,
  /** A result, kept to show if it's refused: the content itself, or what to show instead. */
  result: boolean | string = false,
): void {
  const parts =
    type === "session.commentary.append"
      ? [cutForLive(content, APPEND_TOKENS)]
      : splitForLive(content, APPEND_TOKENS);
  for (const part of parts) {
    const eventId = `aldo_${++eventNumber}`;
    if (result) results.set(eventId, typeof result === "string" ? result : content);
    send({ type, event_id: eventId, delegation_id: delegationId, content: part });
  }
}

/**
 * Asks Aldo for what was handed over (`id`, or what was typed), telling the
 * voice once if it takes a while; resolves to what the voice should say.
 */
async function worked(
  id: string | null,
  signal: AbortSignal,
  ask: () => Promise<string>,
): Promise<string> {
  const call = transcript;
  const timer = setTimeout(() => {
    if (transcript !== call || signal.aborted) return;
    appendLive("session.commentary.append", STILL_WORKING[waits++ % STILL_WORKING.length]!, id);
    lastSpokeAt = Date.now();
  }, STILL_WORKING_MS);
  try {
    return await ask();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A new request (handed over, or typed) stops the ones Aldo is still working
 * on: the voice hands over corrections and withdrawals ("never mind"), and the
 * new one has the whole conversation, to do what's still wanted.
 */
function begin(key: string): { signal: AbortSignal; stopped: boolean } {
  let stopped = false;
  for (const controller of delegating.values()) {
    if (controller.signal.aborted) continue;
    controller.abort("superseded");
    stopped = true;
  }
  const controller = new AbortController();
  delegating.set(key, controller);
  return { signal: controller.signal, stopped };
}

/** The call started: it greets the user (or says what it was opened with, or takes what was typed). */
function onLiveStarted(): void {
  if (liveStarted) return;
  liveStarted = true;
  flushAldoHiddenPrompts();
  if (startTimer) clearTimeout(startTimer);
  startTimer = null;
  lastSpokeAt = Date.now();
  openCall();
  set({
    phase: "listening",
    micOn: microphone !== null,
    connectedAt: Date.now(),
    callFrom: get().entries.length,
  });
  // What's on screen first, so the greeting (or what was typed) can mean it.
  tellScreen();
  stopWatchingScreen = subscribeAldoOnScreen(tellScreen);
  const text = queuedText;
  queuedText = null;
  if (text) sendText(text);
  else
    appendLive(
      "session.instructions.append",
      liveOpening ? `${liveOpening}\n\nSay it to the user now.` : LIVE_GREETING,
    );
  liveTimer = setInterval(tickLive, 250);
  // What came back shortly before (a call that dropped and came back) is told once the greeting's done.
  readFollowupsSoon(0);
}

/** Asks Aldo again what's back to tell the call, in `ms` (sooner replaces later, not the other way round). */
function readFollowupsSoon(ms: number): void {
  if (followupsSupported === false || !live || !liveStarted || !sessionId) return;
  const due = Date.now() + ms;
  if (followupsTimer && followupsDue <= due) return;
  if (followupsTimer) clearTimeout(followupsTimer);
  followupsDue = due;
  followupsTimer = setTimeout(() => void readFollowups(), ms);
}

async function readFollowups(): Promise<void> {
  followupsTimer = null;
  const session = sessionId;
  if (!session || !live || !liveStarted || readingFollowups) return;
  readingFollowups = true;
  try {
    const read = await aldoAssistant.followups(session);
    if (sessionId !== session) return;
    followupsSupported = read !== null;
    // What the last read had and this one doesn't is no one's to say now.
    followups = read?.news ?? [];
    following = read?.following ?? 0;
  } catch {
    // Asked again later.
  } finally {
    readingFollowups = false;
    // A call that started while this one's read was out asks for its own now.
    readFollowupsSoon(
      sessionId === session ? followupsEvery({ following, news: followups.length }) : 0,
    );
  }
}

/**
 * At a pause, the first news is claimed: once, and only if it's still how the
 * work stands. It's said at the pause after (the claim takes a moment, and the
 * user may have started speaking meanwhile).
 */
function tellFollowupAtPause(): void {
  const call = transcript;
  const session = sessionId;
  if (!call || !session || tellingFollowup || (!claimed && followups.length === 0)) return;
  if (!atPause(call)) return;
  if (claimed) {
    const { news, line } = claimed;
    claimed = null;
    appendLive("session.instructions.append", followupPrompt(line), null, line);
    set({
      references: mergeVoiceReferences(get().references, [
        { kind: "thread", title: news.title, target: news.thread },
      ]),
    });
    addEntry({ kind: "action", ...followupAction(news) });
    sent(call);
    newsSaidAt = Date.now();
    return;
  }
  const [next, ...rest] = followups;
  if (!next) return;
  followups = rest;
  tellingFollowup = true;
  void aldoAssistant
    .claimFollowup(session, next.id, next.outcome)
    .then(async (line) => {
      if (!line) return;
      const references = await aldoAssistant.references(session, line, next.thread).catch(() => []);
      if (sessionId === session)
        set({ references: mergeVoiceReferences(get().references, references) });
      if (transcript === call) claimed = { news: next, line, session };
      else keepUnsaid(next, line, session);
    })
    .catch(() => {})
    .finally(() => {
      tellingFollowup = false;
    });
}

/** Claimed news the call ended before saying: it shows in the conversation, since no other call will tell it. */
function keepUnsaid(news: AldoFollowupNews, line: string, session: string): void {
  say("assistant", line, session, false);
  addEntry({ kind: "action", ...followupAction(news) });
}

function atPause(call: AldoLiveTranscript): boolean {
  const now = call.now();
  return newsPause({
    userQuietMs: now - call.heardUntil("user"),
    aldoQuietMs: now - call.heardUntil("assistant"),
    aldoSpeaking: get().levels.aldo > SPEAKING_LEVEL,
    greeted: call.heardUntil("assistant") > 0,
    // A request being worked on, or a result the voice hasn't started on: those come first.
    busy:
      delegating.size > 0 ||
      (call.heardUntil("assistant") <= sentFrom && Date.now() - resultSentAt < NEWS_UNSPOKEN_MS),
    sinceResultMs: Date.now() - resultSentAt,
    sinceNewsMs: Date.now() - newsSaidAt,
  });
}

/** A result (or news) went to the voice: nothing else comes up until it's being said, and the line isn't quiet. */
function sent(call: AldoLiveTranscript): void {
  resultSentAt = lastSpokeAt = Date.now();
  sentFrom = call.heardUntil("assistant");
}

/** The mark follows who's speaking; a call nobody's used for a while is hung up. */
function tickLive(): void {
  if (!transcript || !liveStarted) return;
  transcript.settle();
  // Its transcript can come before or after its audio: Aldo heard speaking is Aldo speaking.
  if (get().levels.aldo > SPEAKING_LEVEL) lastSpokeAt = Date.now();
  const phase = livePhase({
    phase: get().phase,
    userQuietMs: transcript.quietFor("user"),
    aldoQuietMs: transcript.quietFor("assistant"),
    delegating: delegating.size,
  });
  if (phase !== get().phase) set({ phase });
  tellFollowupAtPause();
  if (idleCall({ lastSpokeAt, delegating: delegating.size, now: Date.now(), idleMs: IDLE_MS })) {
    toastManager.add({
      type: "info",
      title: "Aldo hung up after a quiet minute and a half",
      description: "Tap the mic to pick up where you left off.",
    });
    disconnectAldo();
  }
}

/**
 * The call has started: it's one card in the conversation, where it began, while its lines and
 * actions stay on the call screen (an Aldo that doesn't draw calls shows them as before).
 */
function openCall(): void {
  if (callCards !== true || !sessionId) return;
  callOpen = sessionId;
  addEntry({
    kind: "call",
    id: sessionId,
    at: new Date().toISOString(),
    state: "live",
    seconds: 0,
    summary: null,
    links: [],
  });
}

/** How long Aldo gets to write a call's summary before the page leaves it to the next read. */
const SUMMARY_TRIES = 24;
const SUMMARY_EVERY_MS = 2_500;

/**
 * The call hung up (`session`, begun at `began`): its card says it's being summarized, with what the call
 * started; once its last words are through, Aldo is told it ended, and the page reads back its summary.
 */
function finishCall(session: string | null, began: number | null): void {
  // Each call is finished by its own session: a new call may already be open.
  if (
    !session ||
    !get().entries.some((e) => isCallEntry(e) && e.id === session && e.state === "live")
  )
    return;
  if (callOpen === session) callOpen = null;
  const seconds = began === null ? 0 : Math.round((Date.now() - began) / 1000);
  const entries = get().entries;
  // A call where the user said nothing has no card (Aldo shows none): it only gets its end told.
  const spoke = entries.some(
    (e) => e.kind === "message" && e.call === session && e.role === "user",
  );
  set({
    entries: spoke
      ? entries.map((e) =>
          isCallEntry(e) && e.id === session
            ? {
                ...e,
                state: "summarizing" as const,
                seconds,
                links: callLinksFrom(entries, session),
              }
            : e,
        )
      : entries.filter((e) => !(isCallEntry(e) && e.id === session)),
  });
  void (async () => {
    await Promise.allSettled(recording);
    await aldoAssistant.record(session, [], true);
    if (!spoke) return;
    for (let tries = 0; tries < SUMMARY_TRIES; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, SUMMARY_EVERY_MS));
      await pullAldoConversation();
      const card = get().entries.find((e) => isCallEntry(e) && e.id === session);
      if (card?.kind !== "call" || card.state === "done") return;
    }
  })().catch(() => {});
}

/** A turn of the call (`session`) ended: it shows, and Aldo keeps it. */
function onLiveTurn(turn: AldoLiveTurn, session: string): void {
  say(turn.role, turn.text, session);
  if (turn.role === "user") heard = rememberHeard(heard, turn.text);
  else {
    set({ said: "" });
    void aldoAssistant
      .references(session, turn.text)
      .then((references) => {
        if (sessionId === session)
          set({ references: mergeVoiceReferences(get().references, references) });
      })
      .catch(() => {});
  }
}

/** What Aldo did with what was handed over shows on the page; what the voice should say comes back. */
async function delegateToAldo(
  session: string,
  turns: ReadonlyArray<AldoLiveTurn>,
  typed: string | null,
  signal: AbortSignal,
  stopped: boolean,
): Promise<string> {
  const onScreen = aldoOnScreen();
  const viewing = onScreen
    ? { environmentId: onScreen.environmentId, threadId: onScreen.threadId }
    : null;
  try {
    const result = await aldoAssistant.delegate(session, turns, typed, viewing, signal, stopped);
    if (signal.aborted || sessionId !== session) return "";
    showCalls(result.calls);
    set({ references: mergeVoiceReferences(get().references, result.references ?? []) });
    return result.say || "Done.";
  } catch (error) {
    return `That didn't go through (${messageOf(error)}). Tell the user it didn't happen, in a few words.`;
  }
}

/**
 * The voice handed something over: once the user has finished saying it,
 * Aldo does it, and the voice is told what to say.
 */
async function runDelegation(id: string, offset: number): Promise<void> {
  const { signal, stopped } = begin(id);
  tickLive();
  const call = transcript;
  const until = Date.now() + SETTLE_MAX_MS;
  // The voice can delegate as the user says their last word, or before it's transcribed: wait for it.
  const talking = () => {
    if (call === null || transcript !== call || signal.aborted || Date.now() >= until) return false;
    const heard = call.heardUntil("user");
    return heard === 0 || heard < offset - HEARD_SLACK_MS || call.quietFor("user") < SETTLE_MS;
  };
  while (talking()) await new Promise((resolve) => setTimeout(resolve, 100));
  const session = sessionId;
  if (call && transcript === call && session && !signal.aborted) {
    call.settle();
    call.flush("user");
    const turns = call.all();
    const answer = await worked(id, signal, () =>
      delegateToAldo(session, turns, null, signal, stopped),
    );
    // A call that ended meanwhile has no one to tell. One about to be told isn't quiet.
    if (transcript === call && !signal.aborted) {
      appendLive("session.commentary.append", answer, id, true);
      sent(call);
      // It may have handed work to a thread: what comes of it is followed from now.
      readFollowupsSoon(1_000);
    }
  }
  // One a newer request replaced says nothing of its own; the voice is told quietly, so it doesn't wait on it.
  if (signal.aborted && signal.reason === "superseded" && transcript === call && call) {
    appendLive(
      "session.thinking.append",
      "Replaced by the user's newer request: nothing to say for this one.",
      id,
    );
  }
  if (delegating.get(id)?.signal === signal) delegating.delete(id);
}

/** Words typed on the call: they go to Aldo as the user's (the voice hears them too), and the voice says what came of it. */
async function typeToLive(words: string): Promise<void> {
  const call = transcript;
  const session = sessionId;
  if (!call || !session) return;
  const id = `typed-${Date.now()}`;
  const { signal, stopped } = begin(id);
  lastSpokeAt = Date.now();
  tickLive();
  appendLive("session.thinking.append", `The user typed: ${words}`);
  const before = call.all();
  call.note({ role: "user", text: words });
  const answer = await worked(null, signal, () =>
    delegateToAldo(session, before, words, signal, stopped),
  );
  if (transcript === call && !signal.aborted) {
    appendLive("session.commentary.append", answer, null, true);
    sent(call);
    readFollowupsSoon(1_000);
  }
  if (delegating.get(id)?.signal === signal) delegating.delete(id);
}

function onLiveEvent(event: { type: string } & Record<string, unknown>): void {
  switch (event.type) {
    case "session.started":
      onLiveStarted();
      break;
    case "session.input_transcript.delta":
    case "session.output_transcript.delta": {
      if (typeof event.delta !== "string" || !transcript) break;
      const role = event.type === "session.input_transcript.delta" ? "user" : "assistant";
      transcript.add(role, event.delta, Number(event.start_ms) || 0, Number(event.end_ms) || 0);
      lastSpokeAt = Date.now();
      if (role === "assistant") set({ said: transcript.saying("assistant") });
      tickLive();
      break;
    }
    case "session.delegation.created": {
      const id = (event.delegation as { id?: unknown } | undefined)?.id;
      if (typeof id === "string" && !delegating.has(id))
        void runDelegation(id, Number(event.offset_ms) || 0);
      break;
    }
    case "session.commentary.appended":
      if (typeof event.client_event_id === "string") results.delete(event.client_event_id);
      break;
    case "session.closed": {
      // OpenAI ended it (its time limit, a safety stop, a lost connection), or it's the close the page asked for.
      const asked = event.reason === "close_requested";
      teardown();
      set({
        phase: asked ? "idle" : "error",
        error: asked ? null : "The call with Aldo ended. Tap to talk again.",
        said: "",
        micOn: false,
        muted: false,
        levels: { mic: 0, aldo: 0 },
        connectedAt: null,
      });
      break;
    }
    case "error": {
      // A refused update (one that came too late, say) leaves the call as it was.
      const error = event.error as { message?: unknown; client_event_id?: unknown } | undefined;
      if (typeof error?.message === "string") console.warn("Aldo's voice:", error.message);
      // A result the voice couldn't take shows on screen instead, and the voice says so (once, for the
      // whole session: its delegation may be what was refused), so the user doesn't ask for it twice.
      const refused = typeof error?.client_event_id === "string" ? error.client_event_id : null;
      const unsaid = refused ? results.get(refused) : undefined;
      if (refused && unsaid !== undefined) {
        results.delete(refused);
        say("assistant", unsaid);
        appendLive("session.commentary.append", UNSAID);
      }
      break;
    }
  }
}

/** Waits for the offer to have its network candidates (Aldo sends it whole), but not long. */
async function gathered(connection: RTCPeerConnection): Promise<void> {
  if (connection.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, 2_000);
    function done() {
      clearTimeout(timer);
      connection.removeEventListener("icegatheringstatechange", check);
      resolve();
    }
    function check() {
      if (connection.iceGatheringState === "complete") done();
    }
    connection.addEventListener("icegatheringstatechange", check);
  });
}

function watchLevels(): void {
  levelsTimer = setInterval(() => {
    // Read from the connection's own stats: an audio graph on the tracks can
    // move a phone's playback to the quiet earpiece.
    void peer?.getStats().then((stats) => {
      let mic = 0;
      let aldo = 0;
      stats.forEach((report: { type: string; kind?: string; audioLevel?: number }) => {
        if (report.kind !== "audio" || typeof report.audioLevel !== "number") return;
        if (report.type === "inbound-rtp") aldo = report.audioLevel;
        if (report.type === "media-source") mic = report.audioLevel;
      });
      set({ levels: { mic: get().muted ? 0 : mic, aldo } });
    });
  }, LEVELS_EVERY_MS);
}

/**
 * Ends the call on the page. A GPT-Live call is closed with OpenAI first
 * (`graceful`), which stops its billing; its connection is let go once that's
 * confirmed, or shortly after.
 */
function teardown(graceful = false): void {
  if (levelsTimer) clearInterval(levelsTimer);
  levelsTimer = null;
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = null;
  if (startTimer) clearTimeout(startTimer);
  startTimer = null;
  if (voiceLimitTimer) clearTimeout(voiceLimitTimer);
  voiceLimitTimer = null;
  stopWatchingScreen?.();
  stopWatchingScreen = null;
  toldScreen = null;
  const closing = {
    channel,
    peer,
    microphone,
    transcript,
    live: live && liveStarted,
    session: sessionId,
    began: get().connectedAt,
  };
  transcript = null;
  // What was said up to the end is kept: the last words still on their way too, when the call closes with OpenAI.
  const release = () => {
    closing.transcript?.flush();
    finishCall(closing.session, closing.began);
    // A connection a session is still being made for is closed once it's made (connectAldo).
    if (closing.peer && closing.peer === startingLive) return;
    closing.channel?.close();
    closing.peer?.close();
  };
  // The microphone stops at once, whatever happens to the connection.
  closing.microphone?.getTracks().forEach((track) => track.stop());
  if (speaker) speaker.srcObject = null;
  if (graceful && closing.live && closing.channel?.readyState === "open") {
    const timer = setTimeout(release, CLOSE_WAIT_MS);
    closing.channel.addEventListener("message", (message) => {
      let event: { type?: unknown; delta?: unknown; start_ms?: unknown; end_ms?: unknown };
      try {
        event = JSON.parse(String(message.data)) as typeof event;
      } catch {
        return;
      }
      if (
        typeof event.delta === "string" &&
        (event.type === "session.input_transcript.delta" ||
          event.type === "session.output_transcript.delta")
      ) {
        closing.transcript?.add(
          event.type === "session.input_transcript.delta" ? "user" : "assistant",
          event.delta,
          Number(event.start_ms) || 0,
          Number(event.end_ms) || 0,
        );
      } else if (event.type === "session.closed") {
        clearTimeout(timer);
        release();
      }
    });
    closing.channel.send(JSON.stringify({ type: "session.close" }));
  } else {
    release();
  }
  channel = null;
  peer = null;
  microphone = null;
  sessionId = null;
  live = false;
  liveStarted = false;
  liveOpening = undefined;
  // Hanging up stops what Aldo is working on for the call: nothing starts after it.
  for (const controller of delegating.values()) controller.abort("hangup");
  delegating.clear();
  results.clear();
  // News not yet claimed stays Aldo's: the user's devices were told, and the next call within a while tells it.
  if (followupsTimer) clearTimeout(followupsTimer);
  followupsTimer = null;
  if (claimed) keepUnsaid(claimed.news, claimed.line, claimed.session);
  claimed = null;
  followups = [];
  following = 0;
  resultSentAt = sentFrom = newsSaidAt = waits = 0;
  responding = false;
  calling = false;
  promptWaiting = false;
  // News no response had: shown instead of said.
  newsWaiting.forEach(toastStartNews);
  newsWaiting = [];
  transcribing.clear();
}

function messageOf(error: unknown): string {
  if (error instanceof AldoApiError) return error.message;
  if (error instanceof DOMException && error.name === "NotAllowedError")
    return "The microphone is blocked for this site.";
  if (error instanceof DOMException && error.name === "NotFoundError")
    return "There's no microphone.";
  return error instanceof Error ? error.message : String(error);
}

/**
 * Starts a conversation, with the microphone (the default) or typed only.
 * `opening` is what Aldo is asked to say first, instead of the greeting.
 */
export async function connectAldo(
  options: { mic?: boolean; opening?: string } = {},
): Promise<void> {
  const { phase } = get();
  if (phase !== "idle" && phase !== "error") return;
  liveOpening = options.opening;
  set({
    phase: "connecting",
    references: [],
    error: null,
    said: "",
    muted: false,
    micOn: false,
    connectedAt: null,
  });
  let connection: RTCPeerConnection | null = null;
  // Whether this Aldo draws calls as cards is known before the call opens (a call from the sidebar or a shortcut too).
  const conversation = loadAldoConversation().catch(() => {});
  try {
    // The microphone first, while the tap that asked for it still counts as the user's.
    // Blocked or missing, the conversation goes on typed.
    if (options.mic !== false) {
      microphone = await navigator.mediaDevices
        .getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
        .catch((error: unknown) => {
          set({ error: `${messageOf(error)} You can type to Aldo instead.` });
          return null;
        });
    }
    await conversation;
    connection = new RTCPeerConnection();
    peer = connection;
    if (!speaker) {
      speaker = Object.assign(document.createElement("audio"), { autoplay: true, hidden: true });
      document.body.append(speaker);
    }
    speaker.muted = get().voiceOff;
    connection.ontrack = (event) => {
      if (speaker) speaker.srcObject = event.streams[0] ?? null;
    };
    if (microphone) {
      for (const track of microphone.getTracks()) connection.addTrack(track, microphone);
    } else {
      connection.addTransceiver("audio", { direction: "recvonly" });
    }
    const made = connection;
    const events = made.createDataChannel("oai-events");
    channel = events;
    events.addEventListener("message", (message) => {
      // A call already ended (closing with OpenAI) is no one's now.
      if (channel !== events) return;
      try {
        const event = JSON.parse(String(message.data)) as { type: string } & Record<
          string,
          unknown
        >;
        if (live) onLiveEvent(event);
        else onEvent(event);
      } catch {
        // Not an event.
      }
    });
    events.addEventListener("open", () => {
      // A GPT-Live call starts on its own event (session.started).
      if (channel !== events || live) return;
      openCall();
      set({
        phase: "listening",
        micOn: microphone !== null,
        connectedAt: Date.now(),
        callFrom: get().entries.length,
      });
      flushAldoHiddenPrompts();
      // What's on screen first, so the greeting (or what was typed) can mean it.
      tellScreen();
      stopWatchingScreen = subscribeAldoOnScreen(tellScreen);
      const text = queuedText;
      queuedText = null;
      if (text) sendText(text);
      else requestResponse({ instructions: liveOpening ?? GREETING });
    });
    made.onconnectionstatechange = () => {
      if (peer !== made) return;
      const state = made.connectionState;
      if (state === "failed" || state === "closed") {
        teardown();
        set({
          phase: "error",
          error: "The call with Aldo dropped. Tap to talk again.",
          connectedAt: null,
        });
      }
    };
    const offer = await made.createOffer();
    await made.setLocalDescription(offer);
    await gathered(made);
    const sdp = made.localDescription?.sdp ?? offer.sdp ?? "";
    startingLive = made;
    const voice = await aldoAssistant.startLive(sdp).finally(() => {
      startingLive = null;
    });
    if (peer !== made) {
      // Hung up while Aldo was making the call: OpenAI has it now (and bills its start), so it's closed there too.
      if (voice) void closeAbandoned(made, events, voice.sdp);
      else made.close();
      return;
    }
    if (voice) {
      live = true;
      sessionId = voice.sessionId;
      endCallAfter(made, voice.secondsLeft);
      const session = voice.sessionId;
      transcript = new AldoLiveTranscript((turn) => onLiveTurn(turn, session));
      startTimer = setTimeout(() => {
        if (peer !== made || liveStarted) return;
        teardown();
        set({
          phase: "error",
          error: "Aldo's voice didn't connect. Tap to try again.",
          connectedAt: null,
        });
      }, START_MS);
      await made.setRemoteDescription({ type: "answer", sdp: voice.sdp });
    } else {
      // An older Aldo: a realtime call, with a short-lived key for OpenAI.
      const session = await aldoAssistant.startSession();
      if (peer !== made) return;
      sessionId = session.sessionId;
      endCallAfter(made, session.secondsLeft);
      const answer = await fetch(REALTIME_CALLS_URL, {
        method: "POST",
        body: sdp,
        headers: { authorization: `Bearer ${session.key}`, "content-type": "application/sdp" },
      });
      if (!answer.ok) throw new Error(`Aldo's voice didn't connect (${answer.status}).`);
      await made.setRemoteDescription({ type: "answer", sdp: await answer.text() });
    }
    watchLevels();
  } catch (error) {
    // A call hung up meanwhile is gone already, and another may have started since.
    if (connection && peer !== connection) {
      connection.close();
      return;
    }
    teardown();
    set({ phase: "error", error: messageOf(error), unsent: queuedText, connectedAt: null });
    queuedText = null;
  }
}

/**
 * Ends the call once the period's voice minutes Aldo said it has left are
 * used up, saying so. Without `secondsLeft` (an older Aldo) it goes on.
 */
function endCallAfter(made: RTCPeerConnection, secondsLeft: number | undefined): void {
  if (secondsLeft === undefined) return;
  if (voiceLimitTimer) clearTimeout(voiceLimitTimer);
  voiceLimitTimer = setTimeout(
    () => {
      voiceLimitTimer = null;
      if (peer !== made) return;
      teardown(true);
      queuedText = null;
      set({
        phase: "error",
        error: VOICE_USED_UP,
        said: "",
        micOn: false,
        muted: false,
        levels: { mic: 0, aldo: 0 },
        connectedAt: null,
      });
    },
    Math.max(0, secondsLeft) * 1000,
  );
}

/**
 * Closes a GPT-Live session the user hung up on while Aldo was making it: it
 * started with OpenAI when it was made, so it's connected only to close it,
 * and let go once that's confirmed, or shortly after.
 */
async function closeAbandoned(
  connection: RTCPeerConnection,
  events: RTCDataChannel,
  sdp: string,
): Promise<void> {
  const release = () => {
    events.close();
    connection.close();
  };
  const timer = setTimeout(release, START_MS);
  events.addEventListener("open", () => events.send(JSON.stringify({ type: "session.close" })));
  events.addEventListener("message", (message) => {
    if (!String(message.data).includes('"session.closed"')) return;
    clearTimeout(timer);
    release();
  });
  await connection.setRemoteDescription({ type: "answer", sdp }).catch(() => {
    clearTimeout(timer);
    release();
  });
}

/** Ends the conversation. What was said stays. */
export function disconnectAldo(): void {
  teardown(true);
  queuedText = null;
  set({
    phase: "idle",
    said: "",
    micOn: false,
    muted: false,
    levels: { mic: 0, aldo: 0 },
    connectedAt: null,
  });
}

/**
 * Tells a call what the page shows the user (a note Aldo reads, not words the
 * user said), and, with `respond`, has Aldo speak to it: now, or once it's
 * done with what it's saying or doing. Nothing without a call on.
 */
export function tellAldoCall(note: string, options: { readonly respond: boolean }): void {
  if (get().phase === "connecting" && options.respond) {
    // Keep the call's protocol; the newer note supersedes only its pending prompt.
    liveOpening = liveOpening
      ? `${liveOpening}\n\nUpdate while connecting (use this instead of the earlier prompt; keep the instructions for going through decisions): ${note}`
      : note;
    return;
  }
  if (channel?.readyState !== "open") return;
  if (live) {
    if (liveStarted)
      appendLive(options.respond ? "session.instructions.append" : "session.thinking.append", note);
    return;
  }
  send({
    type: "conversation.item.create",
    item: { type: "message", role: "system", content: [{ type: "input_text", text: note }] },
  });
  if (!options.respond) return;
  const phase = get().phase;
  if (calling || responding || phase === "hearing") promptWaiting = true;
  else requestResponse();
}

/** Aldo's voice on or off on this device (its words keep showing). */
export function setAldoVoiceOff(off: boolean): void {
  if (speaker) speaker.muted = off;
  set({ voiceOff: off });
}

/**
 * Typed words: into the call when one is on; otherwise to Aldo in writing
 * (or, on an older Aldo, into a call that starts typed only). Images and
 * files go in writing only: the composer offers them when no call is on.
 */
export function sendText(
  text: string,
  images: ReadonlyArray<AldoImageUpload> = [],
  files: ReadonlyArray<AldoFileUpload> = [],
): void {
  const words = text.trim();
  if (images.length + files.length > 0 && !aldoAssistantLive()) {
    void chatText(words, images, files);
    return;
  }
  if (!words) return;
  if (aldoAssistantLive()) {
    if (channel?.readyState !== "open" || (live && !liveStarted)) {
      queuedText = [queuedText, words].filter(Boolean).join("\n\n");
      return;
    }
    heard = rememberHeard(heard, words);
    say("user", words);
    if (live) {
      void typeToLive(words);
      return;
    }
    send({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: words }] },
    });
    requestResponse();
    return;
  }
  if (chatSupported === false) {
    queuedText = words;
    void connectAldo({ mic: false });
    return;
  }
  void chatText(words);
}

/** Puts words in the composer for the user to finish ("About the checkout fix: "). */
export function seedAldoComposer(text: string): void {
  set({ unsent: text });
}

// ---------------------------------------------------------------------------
// Written messages
//
// A message goes the moment it's written, each on its own: Aldo takes it in at
// once, by the id the page gave it (once, however often it's sent), and its
// answer is asked for apart, in the order the messages came, so none waits
// behind another's turn and no connection is held for one. One that doesn't
// get through is sent again by itself, and meanwhile kept on the device
// (homeOutbox.ts) in case the app closes first.

type Written = {
  id: string;
  entry: Extract<AldoConversationEntry, { kind: "message" }>;
  sessionId: string;
  words: string;
  images: ReadonlyArray<AldoImageUpload>;
  files: ReadonlyArray<AldoFileUpload>;
  viewing: { environmentId: string; threadId: string } | null;
  /** Its copy on the device, once written (the copy is dropped after it). */
  kept?: Promise<void>;
};
/** Whether Aldo has shown it takes a message by its id: then sending one again is harmless, which an older Aldo isn't. */
let idempotent = false;
/** The messages this page hasn't had through, by the entry that shows each (a failed one waits here for "Try again"). */
const written = new Map<AldoConversationEntry, Written>();
/** Those being sent or waiting for Aldo's answer. */
const delivering = new Set<Written>();
/** A message that hasn't been taken in after this long says it's being sent. */
const SLOW_SEND_MS = 3_000;
/** The pauses between tries to reach Aldo (the last repeats); a connection back, or "Try again", tries at once. */
const RETRY_PAUSES_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];
/** Tries before a message says it's not sent yet: the page goes on trying. */
const TRIES_BEFORE_SAYING = 4;
const wakers = new Set<() => void>();
let watchingConnection = false;

/** A turn that failed (Aldo took the message and couldn't answer it), as Aldo's answer to asking for it says. */
const failedTurn = (error: AldoApiError) =>
  (error.body as { failed?: unknown } | undefined)?.failed === true;

const randomId = (length: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) => (b % 36).toString(36)).join("");

/** The typing dots show while Aldo works on a message, or one is being sent, but not for one waiting on a connection. */
function syncReplying(): void {
  const troubled = new Set(get().undelivered.map((u) => u.entry));
  set({ replying: resuming || [...delivering].some((m) => !troubled.has(m.entry)) });
}

/** What shows under a message that isn't through: "Sending…" (`error` null), or why not; `undefined` clears it. */
function trouble(message: Written, error: string | null | undefined): void {
  const others = get().undelivered.filter((u) => u.entry !== message.entry);
  set({ undelivered: error === undefined ? others : [...others, { entry: message.entry, error }] });
  syncReplying();
}

function wakeDelivery(): void {
  for (const wake of wakers) wake();
}

function pause(failures: number): Promise<void> {
  const ms = RETRY_PAUSES_MS[Math.min(failures, RETRY_PAUSES_MS.length) - 1]!;
  return new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      wakers.delete(wake);
      resolve();
    };
    const timer = setTimeout(wake, ms);
    wakers.add(wake);
  });
}

/** A phone suspends a page it isn't showing, and loses its connection often: what's waiting tries again as it's back. */
function watchConnection(): void {
  if (watchingConnection || typeof window === "undefined") return;
  watchingConnection = true;
  window.addEventListener("online", wakeDelivery);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") wakeDelivery();
  });
}

/** Every tap shows its message now and sends it. */
function chatText(
  words: string,
  images: ReadonlyArray<AldoImageUpload> = [],
  files: ReadonlyArray<AldoFileUpload> = [],
): void {
  heard = rememberHeard(heard, words);
  const onScreen = aldoOnScreen();
  chatSessionId ??= `as_${randomId(12)}`;
  addWritten({
    id: `m_${randomId(16)}`,
    sessionId: chatSessionId,
    words,
    images,
    files,
    viewing: onScreen
      ? { environmentId: onScreen.environmentId, threadId: onScreen.threadId }
      : null,
    at: new Date().toISOString(),
  });
}

function addWritten(sent: Omit<Written, "entry"> & { at: string }): void {
  const { at, ...rest } = sent;
  const entry: Written["entry"] = {
    kind: "message",
    role: "user",
    text: sent.words,
    at,
    ...(sent.images.length > 0 ? { images: sent.images.map((image) => image.dataUrl) } : {}),
    ...(sent.files.length > 0 ? { files: sent.files } : {}),
  };
  addEntry(entry);
  if (sent.images.length > 0) sentImages.set(entry, sent.images);
  const message: Written = { ...rest, entry };
  written.set(entry, message);
  set({ error: null });
  void deliver(message);
}

/** Messages kept on the device (by this account) that Aldo doesn't have (the app closed before it did): sent now. */
async function resendKept(known: ReadonlyArray<AldoAssistantMessage>): Promise<void> {
  const me = (await requestAldoProfile())?.id ?? null;
  const here = new Set([...written.values()].map((m) => m.id));
  for (const kept of await homeMessages()) {
    if (kept.userId !== me || here.has(kept.id)) continue;
    // Aldo has it (the app closed as it was taken in): its answer comes with the conversation.
    if (known.some((m) => m.clientId === kept.id)) {
      void dropHomeMessage(kept.id);
      continue;
    }
    addWritten({
      id: kept.id,
      sessionId: kept.sessionId,
      words: kept.text,
      images: kept.images,
      files: kept.files ?? [],
      viewing: kept.viewing,
      at: kept.at,
    });
  }
}

/** "Try again" on a message that isn't through. */
export function retryAldoMessage(entry: AldoConversationEntry): void {
  const message = written.get(entry);
  if (!message) return;
  trouble(message, null);
  if (delivering.has(message)) wakeDelivery();
  else void deliver(message);
}

/** Drops the device's copy of a message, once it has been written. */
function forget(message: Written): void {
  void (message.kept ?? Promise.resolve()).then(() => dropHomeMessage(message.id));
}

/**
 * Gets a message to Aldo and its answer back, for as long as it takes: what
 * fails with the connection (or Aldo not answering) is tried again, since
 * sending a message again is harmless; what Aldo answers with a refusal is
 * the end of it. An Aldo not known to take a message by its id (an older one
 * runs it again) is asked whether it has the message before it's sent again.
 */
async function deliver(message: Written): Promise<void> {
  watchConnection();
  delivering.add(message);
  syncReplying();
  // Under this account's id, so another account on the device never sends it.
  message.kept = requestAldoProfile().then((profile) =>
    keepHomeMessage({
      id: message.id,
      userId: profile?.id ?? null,
      sessionId: message.sessionId,
      text: message.words,
      images: message.images,
      files: message.files,
      viewing: message.viewing,
      at: message.entry.at,
    }),
  );
  const slow = setTimeout(() => trouble(message, null), SLOW_SEND_MS);
  let taken = false;
  let answered = false;
  try {
    for (let failures = 0; ;) {
      let sending = false;
      try {
        // What Aldo says of the message: its turn, "pending" while it works, "unknown" if it hasn't it.
        let state: AldoChatTurn | "pending" | "unknown" = "unknown";
        if (taken || (failures > 0 && !idempotent)) {
          state = await aldoAssistant.turn(message.id);
          idempotent = true;
        }
        if (state === "unknown") {
          if (taken) {
            taken = false;
            failures++;
            await pause(failures);
          }
          sending = true;
          const sent = await aldoAssistant.send(
            message.id,
            message.sessionId,
            message.words,
            message.images,
            message.files,
            message.viewing,
            idempotent,
          );
          sending = false;
          if (!sent) return olderAldo(message);
          if (sent.kind === "taken") idempotent = true;
          chatSessionId = sent.kind === "taken" ? sent.sessionId : sent.turn.sessionId;
          state = sent.kind === "taken" ? "pending" : sent.turn;
        }
        if (!taken) {
          taken = true;
          clearTimeout(slow);
          trouble(message, undefined);
          forget(message);
        }
        if (state === "pending") {
          failures = 0;
          continue;
        }
        answered = true;
        written.delete(message.entry);
        showAnswer(message, state);
        return;
      } catch (error) {
        if (error instanceof AldoApiError) {
          // The session ended and the page is on its way to sign-in: the message stays on the device for after.
          if (error.status === 401) return;
          // An older Aldo can't say whether it has the message, and sending it again could run it twice.
          if (!taken && !sending && error.status === 405) return unsure(message);
          if (taken ? failedTurn(error) : sending && error.status < 500) {
            return refused(message, error, taken);
          }
        }
      }
      failures++;
      if (!taken && failures === TRIES_BEFORE_SAYING) {
        trouble(message, "Can't reach Aldo yet. Still trying.");
      }
      await pause(failures);
    }
  } finally {
    clearTimeout(slow);
    delivering.delete(message);
    syncReplying();
    if (answered && delivering.size === 0 && get().planPick)
      void sendKeptOnceFree().catch(() => {});
  }
}

/** An older Aldo: the words go into a call instead, which shows them itself. */
function olderAldo(message: Written): void {
  chatSupported = false;
  written.delete(message.entry);
  forget(message);
  set({ entries: get().entries.filter((e) => e !== message.entry) });
  queuedText = [queuedText, message.words].filter(Boolean).join("\n\n");
  if (!aldoAssistantLive()) void connectAldo({ mic: false });
}

/** The page doesn't know whether an older Aldo has the message: the user decides whether to send it again. */
function unsure(message: Written): void {
  trouble(message, "Couldn't reach Aldo. It may not have this message.");
}

/** Recorded answers (read from Aldo's record) that a turn's own answer has been matched with. */
const matchedAnswers = new WeakSet<AldoConversationEntry>();

function showAnswer(message: Written, turn: AldoChatTurn): void {
  chatSupported = true;
  chatSessionId = turn.sessionId;
  showCalls(turn.calls);
  // The home screen's refresh may have read this answer from Aldo's record already.
  const { entries } = get();
  const twin = entries
    .slice(entries.indexOf(message.entry) + 1)
    .find(
      (e) =>
        e.kind === "message" &&
        e.role === "assistant" &&
        recorded.has(e) &&
        !matchedAnswers.has(e) &&
        e.text === turn.reply,
    );
  if (twin) {
    matchedAnswers.add(twin);
    return;
  }
  addEntry({
    kind: "message",
    role: "assistant",
    text: turn.reply,
    at: new Date().toISOString(),
    ...(turn.artifacts ? { artifacts: turn.artifacts } : {}),
  });
}

/** Aldo answered the message with a refusal, or couldn't answer it: the end of trying. */
function refused(message: Written, error: AldoApiError, taken: boolean): void {
  forget(message);
  const needs = !taken && error.status === 402 ? needsPlanOf(error.body) : null;
  if (!needs) {
    // Aldo has taken in a message it couldn't answer: trying again is a new message to it.
    if (taken) message.id = `m_${randomId(16)}`;
    if (!taken && error.status === 404) return olderAldo(message);
    trouble(message, messageOf(error));
    return;
  }
  // Aldo kept it until a plan's chosen: the message stays, with the plan picker under it.
  trouble(message, undefined);
  written.delete(message.entry);
  chatSupported = true;
  const { entry, words, images, files } = message;
  const earlier = get().planPick?.entry;
  if (earlier && earlier !== entry && earlier.kind === "message") {
    // Aldo keeps one request: this one joins the one kept before (or, too long for that, takes its
    // place), so one message shows what it keeps, with the images that go with it.
    const joined = needs.text.trim() !== words.trim();
    const shownImages =
      images.length > 0
        ? images.map((image) => image.dataUrl)
        : joined
          ? earlier.images
          : undefined;
    const shownFiles = files.length > 0 ? files : joined ? earlier.files : undefined;
    const kept: AldoConversationEntry = {
      kind: "message",
      role: "user",
      text: needs.text || words,
      at: entry.at,
      ...(shownImages ? { images: shownImages } : {}),
      ...(shownFiles ? { files: shownFiles } : {}),
    };
    const uploads = images.length > 0 ? images : joined ? sentImages.get(earlier) : undefined;
    if (uploads) sentImages.set(kept, uploads);
    set({
      entries: get()
        .entries.filter((e) => e !== earlier)
        .map((e) => (e === entry ? kept : e)),
      planPick: pick(needs.requestId, kept, needs, "choose"),
    });
    return;
  }
  set({ planPick: pick(needs.requestId, entry, needs, "choose") });
}

export function setAldoMuted(muted: boolean): void {
  microphone?.getAudioTracks().forEach((track) => {
    track.enabled = !muted;
  });
  set({ muted });
}

let hiddenPromptsChannel: RTCDataChannel | null = null;
let hiddenPromptsNote = "";
let pendingHiddenPrompts: ReadonlyArray<string> | null = null;

/** Quiet context only: dismissing a prompt never sends an answer to its thread. */
export function noteAldoHiddenPrompts(titles: ReadonlyArray<string>): void {
  pendingHiddenPrompts = titles;
  flushAldoHiddenPrompts();
}

function flushAldoHiddenPrompts(): void {
  const titles = pendingHiddenPrompts;
  if (!titles) return;
  if (channel?.readyState !== "open" || (live && !liveStarted)) return;
  const signature = JSON.stringify(titles);
  if (hiddenPromptsChannel === channel && signature === hiddenPromptsNote) return;
  hiddenPromptsChannel = channel;
  hiddenPromptsNote = signature;
  const note = `Current hidden pending prompts (this replaces the earlier hidden list): the user hid these specific pending prompts from Aldo chat: ${titles.join("; ") || "none"}. They are still waiting, unanswered and unapproved. Do not bring them up, remind the user, or ask for a decision unless they explicitly ask about them. A later, different decision should show normally.`;
  if (live) appendLive("session.thinking.append", note);
  else
    send({
      type: "conversation.item.create",
      item: { type: "message", role: "system", content: [{ type: "input_text", text: note }] },
    });
}
