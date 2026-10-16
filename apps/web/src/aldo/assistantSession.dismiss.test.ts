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
import {
  connectAldo,
  disconnectAldo,
  noteAldoHiddenPrompts,
  tellAldoCall,
} from "./assistantSession";
import { walkthroughOpening, walkthroughNext } from "./walkthrough";
import type { AldoDecision } from "./decisions.logic";
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

it("keeps the walkthrough protocol when its prompt changes while connecting", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("RTCPeerConnection", Peer);
  const decision = (title: string): AldoDecision => ({
    kind: "plan",
    key: title,
    plan: { id: title, text: `Plan for ${title}` },
    conversation: {
      ref: title,
      title,
      repos: [],
      branch: "test",
      state: "waiting",
      machine: "asleep",
      at: new Date().toISOString(),
      thread: { environmentId: title, threadId: title },
    },
  });
  await connectAldo({ mic: false, opening: walkthroughOpening(decision("Hidden plan"), 2) });
  tellAldoCall(
    walkthroughNext(
      "The user hid that prompt. It stays unanswered; stop discussing or acting on it.",
      decision("Remaining plan"),
      1,
      1,
    ),
    { respond: true },
  );
  expect(channel!.sent).toHaveLength(0);
  channel!.open();
  channel!.started();
  const opening = channel!.sent
    .filter((e) => e.type === "session.instructions.append")
    .map((e) => e.content)
    .join("\n");
  expect(opening).toContain("Then stop and let them answer.");
  expect(opening).toContain("When they answer out loud, act on it right away");
  expect(opening).toContain("Never bring up the next one yourself");
  expect(opening).toContain("use this instead of the earlier prompt");
  expect(opening).toContain("It stays unanswered; stop discussing or acting on it.");
  expect(opening).toContain("Remaining plan");
  expect(opening.indexOf("Never bring up the next one yourself")).toBeLessThan(
    opening.indexOf("Update while connecting"),
  );
});
