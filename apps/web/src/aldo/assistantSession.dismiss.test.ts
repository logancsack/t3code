// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vite-plus/test";
const backend = vi.hoisted(() => ({
  start: vi.fn(async () => ({ sessionId: "test", sdp: "answer" })),
}));
vi.mock("./cloud", () => ({
  AldoApiError: class extends Error {},
  aldoAssistant: { startLive: backend.start, followups: async () => null },
  getAldoEnvironments: () => [],
  requestAldoDirectoryRefresh: vi.fn(),
  subscribeAldoEnvironments: () => () => {},
}));
vi.mock("../components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));
vi.mock("./screen", () => ({ aldoOnScreen: () => null, subscribeAldoOnScreen: () => () => {} }));
import { connectAldo, disconnectAldo, noteAldoHiddenPrompts } from "./assistantSession";
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
it("flushes the latest hidden prompts when a connecting live call becomes ready, before its greeting", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("RTCPeerConnection", Peer);
  await connectAldo({ mic: false });
  noteAldoHiddenPrompts(["The first prompt"]);
  noteAldoHiddenPrompts(["The latest prompt"]);
  expect(channel!.sent).toHaveLength(0);
  channel!.open();
  expect(channel!.sent).toHaveLength(0);
  channel!.started();
  const hidden = channel!.sent.find((e) => e.content?.includes("Current hidden pending prompts"));
  expect(hidden?.type).toBe("session.thinking.append");
  expect(hidden?.content).toContain("The latest prompt");
  expect(hidden?.content).not.toContain("The first prompt");
  expect(hidden?.content).toContain("still waiting, unanswered and unapproved");
  const before = channel!.sent.length;
  noteAldoHiddenPrompts(["The latest prompt"]);
  expect(channel!.sent).toHaveLength(before);
});
