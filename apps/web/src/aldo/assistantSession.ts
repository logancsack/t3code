// Talking to Aldo. The browser connects straight to the realtime model over
// WebRTC with a short-lived key Aldo mints (the model, Aldo's instructions and
// its tools are in it): the microphone goes up, Aldo's voice comes down, and
// the model's events arrive on a data channel. When the model calls a tool,
// the call goes to Aldo with what the user said lately (an action runs only
// if the user asked for it) and the result goes back to the model. What's
// said on either side is kept by Aldo, so the next conversation picks up
// from this one. Typed without a call on, the words go to Aldo in writing
// instead (its text model, with the same tools): each turn comes back with
// Aldo's reply and what it did. The session lives here, not in a screen: Aldo
// opening a thread moves the page (or, on the home screen, peeks at it), and
// the conversation carries on (the dock shows it). Aldo hears which thread is
// on screen (screen.ts): with each written turn, and on a call as it changes.
// A thread Aldo starts shows in the sidebar at once, and is followed until its
// first turn is under way: if it has to wait, runs into trouble, can't start
// or stops at once (an agent signed out), Aldo says so (or, once the
// conversation has ended, a toast does).

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
  type AldoImageUpload,
} from "./cloud";
import { aldoOnScreen, subscribeAldoOnScreen } from "./screen";

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
/** How long a tool call waits for the transcript of what the user just said. */
const TRANSCRIPT_WAIT_MS = 8_000;
const LEVELS_EVERY_MS = 120;
const GREETING =
  "Pick up the call: greet the user in a few words, warmly, like a colleague. If something needs them, say so in the same breath. Don't list anything.";

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
let stopWatchingScreen: (() => void) | null = null;

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

function say(role: "user" | "assistant", text: string): void {
  const words = text.trim();
  if (!words) return;
  addEntry({ kind: "message", role, text: words, at: new Date().toISOString() });
  if (sessionId) void aldoAssistant.record(sessionId, [{ role, text: words }]).catch(() => {});
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
  if (channel?.readyState !== "open") return;
  const onScreen: AldoOnScreen | null = aldoOnScreen();
  const note = screenNote(onScreen);
  if (note === toldScreen || (toldScreen === null && !onScreen)) return;
  toldScreen = note;
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
  if (aldoAssistantLive() && channel?.readyState === "open") tellAldo(news);
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
      else if (newsWaiting.length > 0) requestResponse();
      break;
    }
    case "error": {
      const message = (event.error as { message?: unknown } | undefined)?.message;
      if (typeof message === "string") set({ error: message });
      break;
    }
  }
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

function teardown(): void {
  if (levelsTimer) clearInterval(levelsTimer);
  levelsTimer = null;
  stopWatchingScreen?.();
  stopWatchingScreen = null;
  toldScreen = null;
  channel?.close();
  peer?.close();
  microphone?.getTracks().forEach((track) => track.stop());
  if (speaker) speaker.srcObject = null;
  channel = null;
  peer = null;
  microphone = null;
  sessionId = null;
  responding = false;
  calling = false;
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

/** Starts a conversation, with the microphone (the default) or typed only. */
export async function connectAldo(options: { mic?: boolean } = {}): Promise<void> {
  const { phase } = get();
  if (phase !== "idle" && phase !== "error") return;
  set({ phase: "connecting", error: null, said: "", muted: false, micOn: false });
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
    const session = await aldoAssistant.startSession();
    sessionId = session.sessionId;
    peer = new RTCPeerConnection();
    if (!speaker) {
      speaker = Object.assign(document.createElement("audio"), { autoplay: true, hidden: true });
      document.body.append(speaker);
    }
    peer.ontrack = (event) => {
      if (speaker) speaker.srcObject = event.streams[0] ?? null;
    };
    if (microphone) {
      for (const track of microphone.getTracks()) peer.addTrack(track, microphone);
    } else {
      peer.addTransceiver("audio", { direction: "recvonly" });
    }
    channel = peer.createDataChannel("oai-events");
    channel.addEventListener("message", (message) => {
      try {
        onEvent(JSON.parse(String(message.data)) as { type: string });
      } catch {
        // Not an event.
      }
    });
    channel.addEventListener("open", () => {
      set({ phase: "listening", micOn: microphone !== null });
      // What's on screen first, so the greeting (or what was typed) can mean it.
      tellScreen();
      stopWatchingScreen = subscribeAldoOnScreen(tellScreen);
      const text = queuedText;
      queuedText = null;
      if (text) sendText(text);
      else requestResponse({ instructions: GREETING });
    });
    peer.onconnectionstatechange = () => {
      const state = peer?.connectionState;
      if (state === "failed" || state === "closed") {
        teardown();
        set({ phase: "error", error: "The call with Aldo dropped. Tap to talk again." });
      }
    };
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const answer = await fetch(REALTIME_CALLS_URL, {
      method: "POST",
      body: offer.sdp ?? "",
      headers: { authorization: `Bearer ${session.key}`, "content-type": "application/sdp" },
    });
    if (!answer.ok) throw new Error(`Aldo's voice didn't connect (${answer.status}).`);
    await peer.setRemoteDescription({ type: "answer", sdp: await answer.text() });
    watchLevels();
  } catch (error) {
    teardown();
    set({ phase: "error", error: messageOf(error), unsent: queuedText });
    queuedText = null;
  }
}

/** Ends the conversation. What was said stays. */
export function disconnectAldo(): void {
  teardown();
  queuedText = null;
  set({ phase: "idle", said: "", micOn: false, muted: false, levels: { mic: 0, aldo: 0 } });
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
    if (channel?.readyState !== "open") {
      queuedText = words;
      return;
    }
    heard = rememberHeard(heard, words);
    say("user", words);
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
    for (const call of turn.calls) {
      const made: AldoFunctionCall = {
        callId: call.callId,
        name: call.name,
        arguments: call.arguments,
      };
      const open = openTargetOf(call.outcome);
      if (open) showThread(open);
      openPreview(call.outcome);
      const action = actionFor(made, call.outcome);
      if (action) {
        addEntry({ kind: "action", ...action });
        if (!action.failed) requestAldoDirectoryRefresh();
      }
      const watch = startWatchFor(made, call.outcome, Date.now());
      if (watch) watchStart(watch);
    }
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
