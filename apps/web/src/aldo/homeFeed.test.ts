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
afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

function home(): AldoHome {
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
        chatDecision: { id: "decision", dismissed: false },
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

it("unchanged server bodies keep Home identity, while recovery clears errors and changed data replaces it", async () => {
  const feed = await import("./homeFeed");
  fetchHome.mockImplementation(async () => home());
  await feed.refreshAldoHome();
  const original = feed.useAldoHomeFeed.getState().home;
  const changed = vi.fn();
  const stop = feed.useAldoHomeFeed.subscribe(changed);
  await feed.refreshAldoHome();
  expect(changed).not.toHaveBeenCalled();
  expect(feed.useAldoHomeFeed.getState().home).toBe(original);
  fetchHome.mockRejectedValueOnce(new Error("offline"));
  await feed.refreshAldoHome();
  expect(feed.useAldoHomeFeed.getState().error).toBe("offline");
  await feed.refreshAldoHome();
  expect(feed.useAldoHomeFeed.getState()).toMatchObject({ error: null, supported: true });
  expect(feed.useAldoHomeFeed.getState().home).toBe(original);
  fetchHome.mockResolvedValueOnce({ ...home(), conversations: [] });
  await feed.refreshAldoHome();
  expect(feed.useAldoHomeFeed.getState().home?.conversations).toEqual([]);
  stop();
});

it("a cached server body cannot undo a successful local dismissal before the server copy catches up", async () => {
  const feed = await import("./homeFeed");
  fetchHome.mockImplementation(async () => home());
  await feed.refreshAldoHome();
  feed.setAldoChatDecisionDismissed("decision", true);
  const dismissed = feed.useAldoHomeFeed.getState().home;
  await feed.refreshAldoHome();
  expect(feed.useAldoHomeFeed.getState().home).toBe(dismissed);
  expect(dismissed?.conversations[0]?.chatDecision?.dismissed).toBe(true);
  const acknowledged = home();
  fetchHome.mockResolvedValueOnce({
    ...acknowledged,
    conversations: acknowledged.conversations.map((c) => ({
      ...c,
      chatDecision: { id: "decision", dismissed: true },
    })),
  });
  await feed.refreshAldoHome();
  expect(feed.useAldoHomeFeed.getState().home?.conversations[0]?.chatDecision?.dismissed).toBe(
    true,
  );
});
