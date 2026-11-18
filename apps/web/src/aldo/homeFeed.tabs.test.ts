// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vite-plus/test";
import type { AldoHome } from "./homeApi";

const fetchHome = vi.hoisted(() => vi.fn());
vi.mock("./homeApi", () => ({ fetchAldoHome: fetchHome }));
vi.mock("./assistantSession", () => ({
  noteAldoHiddenPrompts: vi.fn(),
  pullAldoConversation: vi.fn(),
  useAldoAssistant: {},
}));
vi.mock("./directory", () => ({
  requestAldoDirectoryRefresh: vi.fn(),
  subscribeAldoEnvironments: vi.fn(),
}));
vi.mock("./walkthrough", () => ({ reconcileAldoWalkthrough: vi.fn() }));
vi.mock("./pageUse", () => ({ aldoPageInUseNow: () => true }));
afterEach(() => {
  localStorage.clear();
  vi.resetModules();
  vi.clearAllMocks();
});

// What an answer sent from another tab of this account leaves in storage (homeFeed.ts).
function asking(): AldoHome {
  return {
    at: "2026-10-16T00:00:00Z",
    conversations: [
      {
        ref: "t",
        thread: { environmentId: "aldo-t", threadId: "c" },
        title: "Work",
        repos: [],
        branch: "aldo/t",
        state: "waiting",
        machine: "asleep",
        at: "2026-10-16T00:00:00Z",
        pending: {
          kind: "approval",
          requestId: "r1",
          summary: "Run the migration?",
          options: [{ decision: "accept", label: "Yes" }],
        },
      },
    ],
    pullRequests: [],
    upcoming: [],
    actions: [],
  } as unknown as AldoHome;
}
const otherTab = (hold: object | null) => {
  if (hold) localStorage.setItem("aldo-answered", JSON.stringify({ t: hold }));
  else localStorage.removeItem("aldo-answered");
  window.dispatchEvent(new StorageEvent("storage", { key: "aldo-answered" }));
};
const card = (feed: typeof import("./homeFeed")) =>
  feed.useAldoHomeFeed.getState().home!.conversations[0]!.pending;

it("an answer another tab got Aldo to take takes the card away here too, and its release brings it back", async () => {
  const feed = await import("./homeFeed");
  fetchHome.mockImplementation(async () => asking());
  await feed.refreshAldoHome();
  expect(card(feed)).toMatchObject({ requestId: "r1" });
  otherTab({ ask: "r1", at: "2026-10-16T00:00:10Z", until: Date.now() + 60_000 });
  expect(card(feed)).toBeUndefined();
  otherTab(null);
  expect(card(feed)).toMatchObject({ requestId: "r1" });
});

it("an answer on its way from this tab stays held when another tab's storage changes", async () => {
  const feed = await import("./homeFeed");
  fetchHome.mockImplementation(async () => asking());
  await feed.refreshAldoHome();
  void feed.sendAldoAnswer(
    feed.useAldoHomeFeed.getState().home!.conversations[0]!,
    () => new Promise<string>(() => {}),
  );
  expect(card(feed)).toBeUndefined();
  otherTab(null);
  expect(card(feed)).toBeUndefined();
});
