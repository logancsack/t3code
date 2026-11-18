// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
const backend = vi.hoisted(() => ({
  delegate: vi.fn(),
  start: vi.fn(async (): Promise<{ sessionId: string; sdp: string; secondsLeft?: number }> => ({
    sessionId: "test",
    sdp: "answer",
  })),
}));
const aldoApiMock = vi.hoisted(() => ({
  AldoApiError: class extends Error {},
  aldoAssistant: {
    startLive: backend.start,
    delegate: backend.delegate,
    followups: async () => null,
    record: async () => {},
    references: async () => [],
  },
  getAldoEnvironments: () => [],
  requestAldoDirectoryRefresh: vi.fn(),
  subscribeAldoEnvironments: () => () => {},
}));
vi.mock("./api", () => aldoApiMock);
vi.mock("./assistantApi", () => aldoApiMock);
vi.mock("./directory", () => aldoApiMock);
vi.mock("../components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));
vi.mock("../lib/openPullRequestLink", () => ({ useOpenChangeRequestLink: () => () => false }));
vi.mock("./screen", () => ({ aldoOnScreen: () => null, subscribeAldoOnScreen: () => () => {} }));
import {
  connectAldo,
  disconnectAldo,
  useAldoAssistant,
  sendText,
  setAldoAssistantNavigator,
} from "./assistantSession";
import { AldoCallReferences } from "./AldoCallReferences";
import { showAldoCall, useAldoCallView } from "./callView";
import { aldoOpenShareNow, closeAldoShare } from "./shareViewer";

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
  close = vi.fn();
}
afterEach(() => {
  disconnectAldo();
  channel?.dispatchEvent(
    new MessageEvent("message", { data: JSON.stringify({ type: "session.closed" }) }),
  );
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("artifact and thread cards open without closing, muting or restarting the connected call; one tap returns", async () => {
  vi.stubGlobal("RTCPeerConnection", Peer);
  const target = { environmentId: "aldo-enterprise", threadId: "readiness" };
  const file = {
    kind: "file" as const,
    url: "/s/EnterprisePrivate001",
    title: "Enterprise Readiness write-up",
    contentType: "text/html",
  };
  backend.delegate.mockResolvedValue({
    say: "Here's the private write-up.",
    calls: [],
    references: [
      { kind: "artifact", artifact: file },
      { kind: "thread", title: "Enterprise Readiness", target },
    ],
  });
  await connectAldo({ mic: false });
  channel!.open();
  channel!.started();
  const connection = useAldoAssistant.getState().connectedAt;
  const transport = channel!;
  const navigate = vi.fn((t: typeof target) =>
    window.history.pushState(null, "", `/${t.environmentId}/${t.threadId}`),
  );
  setAldoAssistantNavigator(navigate);
  sendText("Show me the private write-up");
  await vi.waitFor(() => expect(useAldoAssistant.getState().references).toHaveLength(2));
  const transcript = useAldoAssistant.getState().entries;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(AldoCallReferences)));
  const buttons = container.querySelectorAll("button");
  expect(buttons).toHaveLength(2);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Open file: Enterprise Readiness write-up"]')!
      .click(),
  );
  expect(aldoOpenShareNow()).toMatchObject({ url: file.url, title: file.title });
  expect(useAldoCallView.getState().minimized).toBe(true);
  showAldoCall();
  expect(aldoOpenShareNow()).toBeNull();
  expect(useAldoCallView.getState().minimized).toBe(false);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Open thread: Enterprise Readiness"]')!
      .click(),
  );
  expect(navigate).toHaveBeenCalledWith(target);
  expect(window.location.pathname).toBe("/aldo-enterprise/readiness");
  // A page changing its mounted content leaves the session and transport intact.
  await act(async () => root.render(createElement("main", null, "Enterprise Readiness")));
  expect(useAldoAssistant.getState()).toMatchObject({
    connectedAt: connection,
    muted: false,
    voiceOff: false,
    entries: transcript,
  });
  expect(useAldoAssistant.getState().phase).not.toBe("idle");
  expect(channel).toBe(transport);
  expect(transport.readyState).toBe("open");
  expect(transport.sent.some((event) => event.type === "session.close")).toBe(false);
  expect(backend.start).toHaveBeenCalledTimes(1);
  showAldoCall();
  expect(useAldoCallView.getState().minimized).toBe(false);
  expect(useAldoAssistant.getState().references).toHaveLength(2);
  await act(async () => root.unmount());
  container.remove();
  closeAldoShare();
  setAldoAssistantNavigator(null);
});
