// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

// A voice call while Home is open: the call's lines and actions stay on the call screen, the conversation gets
// one card that goes from on, to "Summarizing…", to what was decided; Aldo is told the call ended once its last
// words are through. Against an Aldo that doesn't draw calls, nothing is hidden and nothing is asked of it.

const backend = vi.hoisted(() => ({
  start: vi.fn(async () => ({ sessionId: "as_call0000001", sdp: "answer" })),
  history: vi.fn(async (_limit?: number): Promise<unknown[]> => []),
  record: vi.fn(async (..._args: unknown[]) => ({})),
}));
const aldoApiMock = vi.hoisted(() => ({
  AldoApiError: class extends Error {},
  aldoAssistant: {
    startLive: backend.start,
    history: backend.history,
    record: backend.record,
    kept: async () => ({ pending: null, needsPlan: null }),
    followups: async () => null,
  },
  requestAldoProfile: async () => ({ id: "u1" }),
  getAldoEnvironments: () => [],
  requestAldoDirectoryRefresh: vi.fn(),
  subscribeAldoEnvironments: () => () => {},
}));
vi.mock("./homeOutbox", () => ({
  keepHomeMessage: async () => {},
  dropHomeMessage: async () => {},
  homeMessages: async () => [],
}));
vi.mock("./api", () => aldoApiMock);
vi.mock("./assistantApi", () => aldoApiMock);
vi.mock("./directory", () => aldoApiMock);
vi.mock("../components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));
vi.mock("./screen", () => ({ aldoOnScreen: () => null, subscribeAldoOnScreen: () => () => {} }));

class Channel extends EventTarget {
  readyState = "connecting";
  send(raw: string) {
    if (JSON.parse(raw).type === "session.close")
      queueMicrotask(() => this.emit({ type: "session.closed" }));
  }
  close() {
    this.readyState = "closed";
  }
  emit(event: Record<string, unknown>) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) }));
  }
  open() {
    this.readyState = "open";
    this.dispatchEvent(new Event("open"));
  }
}
let channel: Channel;
class Peer {
  iceGatheringState = "complete";
  createDataChannel() {
    channel = new Channel();
    return channel;
  }
  addTransceiver() {}
  async createOffer() {
    return { type: "offer", sdp: "offer" };
  }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  async getStats() {
    return new Map();
  }
  close() {}
}

async function page(history: unknown[]) {
  backend.history.mockResolvedValue(history);
  window.history.replaceState(null, "", "/");
  vi.resetModules();
  const session = await import("./assistantSession");
  await session.loadAldoConversation();
  return session;
}
const drawing = (items: unknown[] = []) => Object.assign(items, { calls: true });
const say = (role: "user" | "assistant", text: string, start: number) =>
  channel.emit({
    type: role === "user" ? "session.input_transcript.delta" : "session.output_transcript.delta",
    delta: text,
    start_ms: start,
    end_ms: start + 500,
  });
const kinds = (s: { entries: ReadonlyArray<{ kind: string; call?: string }> }) =>
  s.entries.map((e) => (e.kind === "call" ? "card" : e.call ? `${e.kind}*` : e.kind));

beforeEach(() => {
  vi.stubGlobal("RTCPeerConnection", Peer);
  backend.record.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function talk({ connectAldo }: typeof import("./assistantSession")) {
  await connectAldo({ mic: false });
  channel.open();
  channel.emit({ type: "session.started" });
  say("user", "Move my dentist appointment.", 1000);
  say("assistant", "Checking.", 4000);
  say("user", "Thanks.", 9000);
}

it("keeps the call's lines off the conversation, behind one card that is summarized after the hangup", async () => {
  vi.useFakeTimers();
  const session = await page(drawing());
  await talk(session);
  const { useAldoAssistant } = session;
  expect(kinds(useAldoAssistant.getState())).toEqual(["card", "message*", "message*"]);
  expect(useAldoAssistant.getState().entries[0]).toMatchObject({
    kind: "call",
    id: "as_call0000001",
    state: "live",
  });
  // The call screen still has them: they follow where the call began.
  expect(useAldoAssistant.getState().callFrom).toBe(1);

  session.disconnectAldo();
  await vi.advanceTimersByTimeAsync(0);
  expect(useAldoAssistant.getState().entries[0]).toMatchObject({
    kind: "call",
    state: "summarizing",
  });
  // The end is told after every line of the call is through.
  const told = backend.record.mock.calls;
  expect(told.at(-1)).toEqual(["as_call0000001", [], true]);
  expect(told.slice(0, -1).map((call) => (call[1] as { text: string }[])[0]?.text)).toEqual([
    "Move my dentist appointment.",
    "Checking.",
    "Thanks.",
  ]);

  // Aldo writes it: the page reads it back and the card says what was decided.
  backend.history.mockResolvedValue(
    drawing([
      {
        kind: "call",
        id: "as_call0000001",
        at: "2026-10-25T18:00:00.000Z",
        state: "done",
        seconds: 12,
        summary: "You moved the dentist to Thursday.",
        links: [],
      },
    ]),
  );
  await vi.advanceTimersByTimeAsync(2_600);
  expect(useAldoAssistant.getState().entries[0]).toMatchObject({
    kind: "call",
    state: "done",
    summary: "You moved the dentist to Thursday.",
  });
  const reads = backend.history.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(backend.history.mock.calls.length).toBe(reads);
});

it("shows the call as it always did when Aldo doesn't draw calls, and doesn't tell it the call ended", async () => {
  vi.useFakeTimers();
  const session = await page([]);
  await talk(session);
  expect(kinds(session.useAldoAssistant.getState())).toEqual(["message", "message"]);
  session.disconnectAldo();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(backend.record.mock.calls).toHaveLength(3);
  expect(backend.record.mock.calls.every((call) => call[2] === undefined)).toBe(true);
  expect(kinds(session.useAldoAssistant.getState())).toEqual(["message", "message", "message"]);
});
