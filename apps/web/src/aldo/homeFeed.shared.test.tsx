// @vitest-environment jsdom
// Tabs on screen share their home reads (homeFeed.ts sharedReads): one
// tab's read counts as the others' too, so windows side by side read it once
// each 30 seconds, not once each per window. A hidden tab takes none, and
// none takes a read begun before a card was hidden there.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { AldoHome } from "./homeApi";

const fetchHome = vi.hoisted(() => vi.fn());
vi.mock("./homeApi", () => ({ fetchAldoHome: fetchHome }));
vi.mock("./assistantSession", () => ({
  noteAldoHiddenPrompts: vi.fn(),
  pullAldoConversation: vi.fn(),
  useAldoAssistant: { subscribe: () => () => undefined },
}));
vi.mock("./directory", () => ({
  requestAldoDirectoryRefresh: vi.fn(),
  subscribeAldoEnvironments: () => () => undefined,
}));
vi.mock("./walkthrough", () => ({ reconcileAldoWalkthrough: vi.fn() }));
vi.mock("./pageUse", () => ({ aldoPageInUseNow: () => true }));

/** This browser's other tabs, as the page's channel sees them: what it posted, and a way to send it theirs. */
class OtherTabs {
  static channels: OtherTabs[] = [];
  readonly posted: unknown[] = [];
  private readonly listeners = new Set<(event: { data: unknown }) => void>();
  constructor(readonly name: string) {
    OtherTabs.channels.push(this);
  }
  addEventListener(_type: "message", listener: (event: { data: unknown }) => void): void {
    this.listeners.add(listener);
  }
  postMessage(data: unknown): void {
    this.posted.push(structuredClone(data));
  }
  send(data: unknown): void {
    for (const listener of this.listeners) listener({ data });
  }
  close(): void {}
}

function home(title: string, dismissed = false): AldoHome {
  return {
    at: "2026-10-16T00:00:00Z",
    conversations: [
      {
        ref: "t",
        thread: { environmentId: "aldo-t", threadId: "c" },
        title,
        repos: [],
        branch: "aldo/t",
        state: "waiting",
        machine: "asleep",
        at: "2026-10-16T00:00:00Z",
        chatDecision: { id: "decision", dismissed },
      },
    ],
    pullRequests: [],
    upcoming: [],
    actions: [],
    usage: {
      configured: true,
      metered: false,
      plan: null,
      period: null,
      credits: null,
      bill: null,
      alert: "none",
      agents: { running: 0, limit: null },
    },
    spends: { once: 0, monthly: 0, recent: [] },
    health: { providers: [], connected: [], environments: [] },
    policy: { everywhere: {}, workspaces: [] },
  };
}

let visibility: DocumentVisibilityState = "visible";
let root: Root | null = null;
let feed: typeof import("./homeFeed");

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("BroadcastChannel", OtherTabs);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  fetchHome.mockImplementation(async () => home("Mine"));
  feed = await import("./homeFeed");
  // Something on the page shows the home.
  const Shows = () => {
    feed.useAldoHomeRead();
    return null;
  };
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(<Shows />));
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  OtherTabs.channels = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.clearAllMocks();
});

const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const tabs = () => OtherTabs.channels[0]!;
const shown = () => feed.useAldoHomeFeed.getState().home?.conversations[0]?.title;

it("shares each read with the other tabs, with when it began", () => {
  expect(fetchHome).toHaveBeenCalledTimes(1);
  expect(tabs().name).toBe("aldo-home");
  expect(tabs().posted).toEqual([{ startedAt: expect.any(Number), home: home("Mine") }]);
});

it("a page on screen takes another tab's read as its own, and reads only once that tab stops", async () => {
  // Another tab reads every 30 seconds for two minutes: this one reads none of its own.
  for (let read = 1; read <= 4; read++) {
    await wait(29_000);
    tabs().send({ startedAt: Date.now(), home: home(`Theirs ${read}`) });
    await wait(1_000);
  }
  expect(fetchHome).toHaveBeenCalledTimes(1);
  expect(shown()).toBe("Theirs 4");
  // That tab goes: this one reads once its own clock says so.
  await wait(30_000);
  expect(fetchHome).toHaveBeenCalledTimes(1);
  await wait(5_000);
  expect(fetchHome).toHaveBeenCalledTimes(2);
  expect(shown()).toBe("Mine");
});

it("a hidden page takes no one's read", async () => {
  visibility = "hidden";
  tabs().send({ startedAt: Date.now() + 1, home: home("Theirs") });
  expect(shown()).toBe("Mine");
});

it("a read begun before this page's own, or before a card was hidden here, isn't taken", async () => {
  const ours = (tabs().posted[0] as { startedAt: number }).startedAt;
  tabs().send({ startedAt: ours - 1, home: home("Older") });
  expect(shown()).toBe("Mine");

  await wait(1_000);
  const begun = Date.now();
  await wait(1_000);
  feed.setAldoChatDecisionDismissed("decision", true);
  tabs().send({ startedAt: begun, home: home("Before the hide") });
  expect(feed.useAldoHomeFeed.getState().home?.conversations[0]?.chatDecision?.dismissed).toBe(
    true,
  );
  await wait(1_000);
  tabs().send({ startedAt: Date.now(), home: home("After the hide", true) });
  expect(shown()).toBe("After the hide");
});

it("pages whose reads overlap fall out of step: one begun after this one's puts its next back", async () => {
  await wait(30_000);
  expect(fetchHome).toHaveBeenCalledTimes(2);
  let answer!: (next: AldoHome) => void;
  fetchHome.mockImplementationOnce(() => new Promise<AldoHome>((resolve) => (answer = resolve)));
  await wait(30_000);
  expect(fetchHome).toHaveBeenCalledTimes(3);
  // The other tab began its read a moment after this one's, and answered first.
  await wait(5);
  tabs().send({ startedAt: Date.now(), home: home("Theirs") });
  await act(async () => answer(home("Mine again")));
  expect(shown()).toBe("Mine again");
  // Not on its own 30 seconds, but the look after.
  await wait(30_000);
  expect(fetchHome).toHaveBeenCalledTimes(3);
  await wait(5_000);
  expect(fetchHome).toHaveBeenCalledTimes(4);
});
