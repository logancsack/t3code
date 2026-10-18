// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vite-plus/test";
const backend = vi.hoisted(() => ({
  start: vi.fn(async (): Promise<{ sessionId: string; sdp: string; secondsLeft?: number }> => ({
    sessionId: "test",
    sdp: "answer",
  })),
}));
const aldoApiMock = vi.hoisted(() => ({
  AldoApiError: class extends Error {},
  aldoAssistant: { startLive: backend.start, followups: async () => null },
  getAldoEnvironments: () => [],
  requestAldoDirectoryRefresh: vi.fn(),
  subscribeAldoEnvironments: () => () => {},
}));
vi.mock("./api", () => aldoApiMock);
vi.mock("./assistantApi", () => aldoApiMock);
vi.mock("./directory", () => aldoApiMock);
vi.mock("../components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));
vi.mock("./screen", () => ({ aldoOnScreen: () => null, subscribeAldoOnScreen: () => () => {} }));
import { connectAldo, disconnectAldo, useAldoAssistant } from "./assistantSession";
class Channel extends EventTarget {
  readyState = "connecting";
  sent: Array<{ type: string; content?: string; item?: { content: Array<{ text: string }> } }> = [];
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }
  close() {
    this.readyState = "closed";
  }
  open() {
    this.readyState = "open";
    this.dispatchEvent(new Event("open"));
  }
  started() {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify({ type: "session.started" }) }),
    );
  }
}
let channel: Channel;
class Peer {
  iceGatheringState = "complete";
  localDescription: unknown;
  createDataChannel() {
    channel = new Channel();
    return channel;
  }
  addTransceiver() {}
  async createOffer() {
    return { type: "offer", sdp: "offer" };
  }
  async setLocalDescription(description: unknown) {
    this.localDescription = description;
  }
  async setRemoteDescription() {}
  async getStats() {
    return new Map();
  }
  close() {}
}
afterEach(() => {
  disconnectAldo();
  channel?.dispatchEvent(
    new MessageEvent("message", { data: JSON.stringify({ type: "session.closed" }) }),
  );
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("ends the call when the voice minutes Aldo said were left run out, and says so", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("RTCPeerConnection", Peer);
  backend.start.mockResolvedValueOnce({ sessionId: "test", sdp: "answer", secondsLeft: 30 });
  await connectAldo({ mic: false });
  channel!.open();
  channel!.started();
  vi.advanceTimersByTime(29_000);
  expect(useAldoAssistant.getState().phase).not.toBe("error");
  vi.advanceTimersByTime(1_000);
  expect(useAldoAssistant.getState()).toMatchObject({
    phase: "error",
    error: "This month's voice minutes are used up. Type to Aldo until they renew.",
    connectedAt: null,
  });
  // Closed with OpenAI, so its billing stops too.
  expect(channel!.sent.some((event) => event.type === "session.close")).toBe(true);
});

it("goes on as before when Aldo doesn't say how long the call may last", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("RTCPeerConnection", Peer);
  await connectAldo({ mic: false });
  channel!.open();
  channel!.started();
  vi.advanceTimersByTime(60_000);
  expect(useAldoAssistant.getState().phase).not.toBe("error");
});
