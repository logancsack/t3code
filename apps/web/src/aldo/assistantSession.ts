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
// lives here, not in a screen: Aldo opening a thread moves the page (or, on
// the home screen, peeks at it), and the conversation carries on (the dock
// shows it). Aldo hears which thread is on screen (screen.ts): with each
// written turn, and on a call as it changes. A call can open with words of
// its own instead of the greeting, and the page can tell a call what it shows
// (going through decisions, walkthrough.ts). A thread Aldo starts shows in the
// sidebar at once, and is followed until its first turn is under way: if it
// has to wait, runs into trouble, can't start or stops at once (an agent
// signed out), Aldo says so (or, once the conversation has ended, a toast
// does).

import { create } from "zustand";

import { toastManager } from "../components/ui/toast";
import {
  actionFor,
  functionCallsIn,
  openTargetOf,
  previewOf,
  phaseAfter,
  rememberHeard,
  screenNote,
  startNews,
  startWatchFor,
  unseenMessages,
  type AldoAssistantAction,
  type AldoAssistantMessage,
  type AldoAssistantPhase,
  type AldoFunctionCall,
  type AldoOnScreen,
  type AldoOpenTarget,
  type AldoStartNews,
  type AldoStartWatch,
} from "./assistant.logic";
import {
  AldoApiError,
  aldoAssistant,
  getAldoEnvironments,
  requestAldoDirectoryRefresh,
  subscribeAldoEnvironments,
  type AldoChatTurn,
  type AldoImageUpload,
} from "./cloud";
import {
  AldoLiveTranscript,
  cutForLive,
  idleCall,
  livePhase,
  splitForLive,
  type AldoLiveTurn,
} from "./liveTranscript.logic";
import { aldoOnScreen, subscribeAldoOnScreen } from "./screen";

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
/** How long a tool call waits for the transcript of what the user just said. */
const TRANSCRIPT_WAIT_MS = 8_000;
const LEVELS_EVERY_MS = 120;
const GREETING =
  "Pick up the call: greet the user in a few words, warmly, like a colleague. If something needs them, say so in the same breath. Don't list anything.";
/** GPT-Live's greeting (it waits for the user unless told to say something, plainly). */
const LIVE_GREETING =
  "Say hello to the user now: tell them it's Aldo, mention anything that needs them in a few words, and ask what you can do for them.";
/** A request still being worked on after this long gets a word that it is, so the line isn't silent. */
const STILL_WORKING_MS = 6_000;
const STILL_WORKING = "Still working on that; it'll be a few more seconds.";
/** A delegation waits this long (the call's time) for the user to stop talking, so it has their whole request. */
const SETTLE_MS = 700;
const SETTLE_MAX_MS = 2_500;
/** A delegation's request is the user's words transcribed up to about where it was made (its offset on the call's timeline). */
const HEARD_SLACK_MS = 1_500;
/** What the voice says when a result it was sent was refused (OpenAI rejects an update it can't take): it's on screen instead. */
const UNSAID = "I couldn't say that result out loud, so it's on the user's screen now.";
/** GPT-Live bills every connected second: a call nobody's used for this long is hung up. */
const IDLE_MS = 90_000;
/** How long a GPT-Live call has to start once OpenAI has answered. */
const START_MS = 20_000;
/** How long hanging up waits for GPT-Live to confirm the call is closed (and billing stopped) before letting go. */
const CLOSE_WAIT_MS = 3_000;
/** What one update to the voice takes (500 tokens), with room to spare. */
const APPEND_TOKENS = 450;
/** Aldo's voice louder than this is Aldo speaking (GPT-Live streams silence between words). */
const SPEAKING_LEVEL = 0.01;

export type AldoConversationEntry =
  | ({ readonly kind: "message" } & AldoAssistantMessage)
  | ({ readonly kind: "action" } & AldoAssistantAction);

interface AldoAssistantState {
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
  /** A written reply is on its way (typed without a call on). */
  readonly replying: boolean;
  /** When the call connected (ms), for how long it's been on; null without one. */
  readonly connectedAt: number | null;
  /** Where the call's own entries start in `entries`: what was said and done on it. */
  readonly callFrom: number;
  /** Aldo's voice is off on this device: its words still show. */
  readonly voiceOff: boolean;
}

export const useAldoAssistant = create<AldoAssistantState>(() => ({
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
  replying: false,
  connectedAt: null,
  callFrom: 0,
  voiceOff: false,
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
let openThread: ((target: AldoOpenTarget) => void) | null = null;
/** The written conversation's session with Aldo, continued turn after turn. */
let chatSessionId: string | null = null;
/** Whether this Aldo can chat in writing; null until tried. An older one takes typing on a call instead. */
let chatSupported: boolean | null = null;
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
const delegating = new Set<string>();
/** Results sent to the voice (what they said), by the event id OpenAI names if it refuses one. */
const results = new Map<string, string>();
let eventNumber = 0;
/** When anyone last said anything on the call (wall clock), for hanging up one nobody's using. */
let lastSpokeAt = 0;
let liveTimer: ReturnType<typeof setInterval> | null = null;
/** The connection a GPT-Live session is being made for: one hung up meanwhile is closed with OpenAI, not just dropped. */
let startingLive: RTCPeerConnection | null = null;
let startTimer: ReturnType<typeof setTimeout> | null = null;

/** How the conversation opens a thread on the page (the router, from the dock). */
export function setAldoAssistantNavigator(
  navigate: ((target: AldoOpenTarget) => void) | null,
): void {
  openThread = navigate;
}

/** Where a thread Aldo shows goes instead of the page: the home screen's peek, while it's there. */
let peekThread: ((target: AldoOpenTarget) => void) | null = null;

export function setAldoThreadPeeker(peek: ((target: AldoOpenTarget) => void) | null): void {
  peekThread = peek;
}

function showThread(target: AldoOpenTarget): void {
  (peekThread ?? openThread)?.(target);
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
  set({ entries: [...get().entries, entry] });
}

/** What was said shows, and Aldo keeps it in the conversation's session (`session`: a call's, even as it closes). */
function say(role: "user" | "assistant", text: string, session: string | null = sessionId): void {
  const words = text.trim();
  if (!words) return;
  addEntry({ kind: "message", role, text: words, at: new Date().toISOString() });
  if (session) void aldoAssistant.record(session, [{ role, text: words }]).catch(() => {});
}

function send(event: Record<string, unknown>): void {
  if (channel?.readyState === "open") channel.send(JSON.stringify(event));
}

/** The newest message read from Aldo, so a later read adds only what came after it. */
let historyUntil: string | null = null;
/** Messages that came from Aldo's record, or were found in it: the rest were said on this page and not read back yet. */
const recorded = new WeakSet<AldoConversationEntry>();

function fromRecord(messages: ReadonlyArray<AldoAssistantMessage>): AldoConversationEntry[] {
  const entries = messages.map((m) => ({ kind: "message" as const, ...m }));
  for (const entry of entries) recorded.add(entry);
  return entries;
}

/** The conversation so far, from Aldo (once per page). */
export async function loadAldoConversation(): Promise<void> {
  if (get().historyLoaded) return;
  const messages = await aldoAssistant.history().catch(() => []);
  historyUntil = messages.at(-1)?.at ?? historyUntil;
  set({
    historyLoaded: true,
    // Anything said since the page opened stays after what came before.
    entries: [...fromRecord(messages), ...get().entries],
  });
}

/**
 * What was said since the conversation loaded that the page doesn't show: a
 * heads-up Aldo gave, or a turn on another device, added at its end. Run on
 * the home screen's refresh, and when a push arrives.
 */
export async function pullAldoConversation(): Promise<void> {
  if (!get().historyLoaded) return;
  const messages = await aldoAssistant.history(20).catch(() => null);
  if (!messages?.length) return;
  const said = get().entries.flatMap((e) => (e.kind === "message" && !recorded.has(e) ? [e] : []));
  const { fresh, matched } = unseenMessages(said, messages, historyUntil);
  historyUntil = messages.at(-1)?.at ?? historyUntil;
  for (const entry of matched) recorded.add(entry);
  if (fresh.length > 0) set({ entries: [...get().entries, ...fromRecord(fresh)] });
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
    type: failed ? "error" : "warning",
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
  addEntry({
    kind: "action",
    id: `start-${watch.threadId}-${news.state}`,
    tool: "start_thread",
    label: news.label,
    failed: news.state !== "queued",
    open: { environmentId: watch.environmentId, threadId: watch.threadId },
  });
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

/**
 * What a tool call did, on the page: the thread it opened or the app it
 * previewed, a line in the conversation, and a thread it started followed
 * until it's under way.
 */
function showCall(call: AldoFunctionCall, outcome: unknown): void {
  const open = openTargetOf(outcome);
  if (open) showThread(open);
  openPreview(outcome);
  const action = actionFor(call, outcome);
  if (action) {
    addEntry({ kind: "action", ...action });
    // What it changed shows in the sidebar now (a new thread at once), not on the next refresh.
    if (!action.failed) requestAldoDirectoryRefresh();
  }
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
  result = false,
): void {
  const parts =
    type === "session.commentary.append"
      ? [cutForLive(content, APPEND_TOKENS)]
      : splitForLive(content, APPEND_TOKENS);
  for (const part of parts) {
    const eventId = `aldo_${++eventNumber}`;
    if (result) results.set(eventId, content);
    send({ type, event_id: eventId, delegation_id: delegationId, content: part });
  }
}

/**
 * Asks Aldo for what was handed over (`id`, or what was typed), telling the
 * voice once if it takes a while; resolves to what the voice should say.
 */
async function worked(id: string | null, ask: () => Promise<string>): Promise<string> {
  const call = transcript;
  const timer = setTimeout(() => {
    if (transcript !== call) return;
    appendLive("session.commentary.append", STILL_WORKING, id);
    lastSpokeAt = Date.now();
  }, STILL_WORKING_MS);
  try {
    return await ask();
  } finally {
    clearTimeout(timer);
  }
}

/** The call started: it greets the user (or says what it was opened with, or takes what was typed). */
function onLiveStarted(): void {
  if (liveStarted) return;
  liveStarted = true;
  if (startTimer) clearTimeout(startTimer);
  startTimer = null;
  lastSpokeAt = Date.now();
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
}

/** The orb follows who's speaking; a call nobody's used for a while is hung up. */
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
  if (idleCall({ lastSpokeAt, delegating: delegating.size, now: Date.now(), idleMs: IDLE_MS })) {
    toastManager.add({
      type: "info",
      title: "Aldo hung up after a quiet minute and a half",
      description: "Tap the mic to pick up where you left off.",
    });
    disconnectAldo();
  }
}

/** A turn of the call (`session`) ended: it shows, and Aldo keeps it. */
function onLiveTurn(turn: AldoLiveTurn, session: string): void {
  say(turn.role, turn.text, session);
  if (turn.role === "user") heard = rememberHeard(heard, turn.text);
  else set({ said: "" });
}

/** What Aldo did with what was handed over shows on the page; what the voice should say comes back. */
async function delegateToAldo(
  session: string,
  turns: ReadonlyArray<AldoLiveTurn>,
  typed: string | null,
): Promise<string> {
  const onScreen = aldoOnScreen();
  const viewing = onScreen
    ? { environmentId: onScreen.environmentId, threadId: onScreen.threadId }
    : null;
  try {
    const result = await aldoAssistant.delegate(session, turns, typed, viewing);
    showCalls(result.calls);
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
  delegating.add(id);
  tickLive();
  const call = transcript;
  const until = Date.now() + SETTLE_MAX_MS;
  // The voice can delegate as the user says their last word, or before it's transcribed: wait for it.
  const talking = () => {
    if (call === null || transcript !== call || Date.now() >= until) return false;
    const heard = call.heardUntil("user");
    return heard === 0 || heard < offset - HEARD_SLACK_MS || call.quietFor("user") < SETTLE_MS;
  };
  while (talking()) await new Promise((resolve) => setTimeout(resolve, 100));
  const session = sessionId;
  if (!call || transcript !== call || !session) {
    delegating.delete(id);
    return;
  }
  call.settle();
  call.flush("user");
  const turns = call.all();
  const answer = await worked(id, () => delegateToAldo(session, turns, null));
  // A call that ended meanwhile has no one to tell. One about to be told isn't quiet.
  if (transcript === call) appendLive("session.commentary.append", answer, id, true);
  lastSpokeAt = Date.now();
  delegating.delete(id);
}

/** Words typed on the call: they go to Aldo as the user's (the voice hears them too), and the voice says what came of it. */
async function typeToLive(words: string): Promise<void> {
  const call = transcript;
  const session = sessionId;
  if (!call || !session) return;
  const id = `typed-${Date.now()}`;
  delegating.add(id);
  lastSpokeAt = Date.now();
  tickLive();
  appendLive("session.thinking.append", `The user typed: ${words}`);
  const before = call.all();
  call.note({ role: "user", text: words });
  const answer = await worked(null, () => delegateToAldo(session, before, words));
  if (transcript === call) appendLive("session.commentary.append", answer, null, true);
  lastSpokeAt = Date.now();
  delegating.delete(id);
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
  stopWatchingScreen?.();
  stopWatchingScreen = null;
  toldScreen = null;
  const closing = { channel, peer, microphone, transcript, live: live && liveStarted };
  transcript = null;
  // What was said up to the end is kept: the last words still on their way too, when the call closes with OpenAI.
  const release = () => {
    closing.transcript?.flush();
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
  delegating.clear();
  results.clear();
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
  set({
    phase: "connecting",
    error: null,
    said: "",
    muted: false,
    micOn: false,
    connectedAt: null,
  });
  let connection: RTCPeerConnection | null = null;
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
      else requestResponse({ instructions: options.opening ?? GREETING });
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
      liveOpening = options.opening;
      sessionId = voice.sessionId;
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
 * (or, on an older Aldo, into a call that starts typed only). Images go in
 * writing only: the composer offers them when no call is on.
 */
export function sendText(text: string, images: ReadonlyArray<AldoImageUpload> = []): void {
  const words = text.trim();
  if (images.length > 0 && !aldoAssistantLive()) {
    void chatText(words, images);
    return;
  }
  if (!words) return;
  if (aldoAssistantLive()) {
    if (channel?.readyState !== "open" || (live && !liveStarted)) {
      queuedText = words;
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

/** A written turn: the words (and images) go to Aldo, and its reply comes back with what it did. */
async function chatText(words: string, images: ReadonlyArray<AldoImageUpload> = []): Promise<void> {
  if (get().replying) {
    // One turn at a time; the words come back to the composer.
    set({ unsent: words, ...(images.length > 0 ? { unsentImages: images } : {}) });
    return;
  }
  heard = rememberHeard(heard, words);
  const entry: AldoConversationEntry = {
    kind: "message",
    role: "user",
    text: words,
    at: new Date().toISOString(),
    ...(images.length > 0 ? { images: images.map((image) => image.dataUrl) } : {}),
  };
  addEntry(entry);
  set({ replying: true, error: null });
  try {
    const onScreen = aldoOnScreen();
    const viewing = onScreen
      ? { environmentId: onScreen.environmentId, threadId: onScreen.threadId }
      : null;
    const turn = await aldoAssistant
      .chat(chatSessionId, words, images, viewing)
      .catch((error: unknown) => {
        if (error instanceof AldoApiError && error.status === 404) return null;
        throw error;
      });
    if (!turn) {
      // An older Aldo: the words go into a call instead, which shows them itself.
      chatSupported = false;
      set({ entries: get().entries.filter((e) => e !== entry) });
      queuedText = words;
      void connectAldo({ mic: false });
      return;
    }
    chatSupported = true;
    chatSessionId = turn.sessionId;
    showCalls(turn.calls);
    addEntry({
      kind: "message",
      role: "assistant",
      text: turn.reply,
      at: new Date().toISOString(),
    });
  } catch (error) {
    set({
      entries: get().entries.filter((e) => e !== entry),
      error: messageOf(error),
      unsent: words,
      ...(images.length > 0 ? { unsentImages: images } : {}),
    });
  } finally {
    set({ replying: false });
  }
}

export function setAldoMuted(muted: boolean): void {
  microphone?.getAudioTracks().forEach((track) => {
    track.enabled = !muted;
  });
  set({ muted });
}
