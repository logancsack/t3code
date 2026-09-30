// Talking to Aldo. The browser connects straight to the realtime model over
// WebRTC with a short-lived key Aldo mints (the model, Aldo's instructions and
// its tools are in it): the microphone goes up, Aldo's voice comes down, and
// the model's events arrive on a data channel. When the model calls a tool,
// the call goes to Aldo with what the user said lately (an action runs only
// if the user asked for it) and the result goes back to the model. What's
// said on either side is kept by Aldo, so the next conversation picks up
// from this one. The session lives here, not in a screen: Aldo opening a
// thread moves the page, and the conversation carries on (the dock shows it).

import { create } from "zustand";

import {
  actionFor,
  functionCallsIn,
  openTargetOf,
  phaseAfter,
  rememberHeard,
  type AldoAssistantAction,
  type AldoAssistantMessage,
  type AldoAssistantPhase,
  type AldoFunctionCall,
  type AldoOpenTarget,
} from "./assistant.logic";
import { AldoApiError, aldoAssistant } from "./cloud";

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

/** How the conversation opens a thread on the page (the router, from the dock). */
export function setAldoAssistantNavigator(
  navigate: ((target: AldoOpenTarget) => void) | null,
): void {
  openThread = navigate;
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

/** The conversation so far, from Aldo (once per page). */
export async function loadAldoConversation(): Promise<void> {
  if (get().historyLoaded) return;
  const messages = await aldoAssistant.history().catch(() => []);
  set({
    historyLoaded: true,
    // Anything said since the page opened stays after what came before.
    entries: [...messages.map((m) => ({ kind: "message" as const, ...m })), ...get().entries],
  });
}

async function transcriptsSettled(): Promise<void> {
  const deadline = Date.now() + TRANSCRIPT_WAIT_MS;
  while (transcribing.size > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function runCalls(calls: ReadonlyArray<AldoFunctionCall>): Promise<void> {
  set({ phase: "thinking" });
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
    if (open) openThread?.(open);
    const action = actionFor(call, outcome);
    if (action) addEntry({ kind: "action", ...action });
    send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: call.callId, output: JSON.stringify(outcome) },
    });
  }
  send({ type: "response.create" });
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
      set({ said: "" });
      break;
    case "response.output_audio_transcript.delta":
      if (typeof event.delta === "string") set({ said: get().said + event.delta });
      break;
    case "response.output_audio_transcript.done":
      if (typeof event.transcript === "string") say("assistant", event.transcript);
      break;
    case "response.done": {
      const calls = functionCallsIn(event);
      if (calls.length > 0) void runCalls(calls);
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
  channel?.close();
  peer?.close();
  microphone?.getTracks().forEach((track) => track.stop());
  if (speaker) speaker.srcObject = null;
  channel = null;
  peer = null;
  microphone = null;
  sessionId = null;
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
      const text = queuedText;
      queuedText = null;
      if (text) sendText(text);
      else send({ type: "response.create", response: { instructions: GREETING } });
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

/** Typed words: into the conversation, which starts (typed only) if it isn't on. */
export function sendText(text: string): void {
  const words = text.trim();
  if (!words) return;
  if (!aldoAssistantLive() || channel?.readyState !== "open") {
    queuedText = words;
    if (!aldoAssistantLive()) void connectAldo({ mic: false });
    return;
  }
  heard = rememberHeard(heard, words);
  say("user", words);
  send({
    type: "conversation.item.create",
    item: { type: "message", role: "user", content: [{ type: "input_text", text: words }] },
  });
  send({ type: "response.create" });
}

export function setAldoMuted(muted: boolean): void {
  microphone?.getAudioTracks().forEach((track) => {
    track.enabled = !muted;
  });
  set({ muted });
}
