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

// A thread whose machine is asleep keeps saying it waits on the question for a
// minute or more after the answer was sent: the card must not wait for it.
function asking(requestId = "r1"): AldoHome {
  const h = home();
  return {
    ...h,
    conversations: h.conversations.map((c) => ({
      ...c,
      pending: {
        kind: "question" as const,
        requestId,
        questions: [
          {
            id: "q",
            header: "Sites",
            question: "Which sites?",
            multiSelect: false,
            options: [{ label: "Every site", description: "" }],
          },
        ],
      },
      summary: "Which sites?",
    })),
  };
}
const shownConversation = (feed: typeof import("./homeFeed")) =>
  feed.useAldoHomeFeed.getState().home!.conversations[0]!;

it("an answer takes its card away at once, not when the server has answered or Aldo's read says so", async () => {
  const feed = await import("./homeFeed");
  fetchHome.mockImplementation(async () => asking());
  await feed.refreshAldoHome();
  expect(shownConversation(feed).pending?.kind).toBe("question");
  let taken!: () => void;
  const sending = feed.sendAldoAnswer(
    shownConversation(feed),
    () => new Promise<string>((resolve) => (taken = () => resolve("sent"))),
  );
  // Still on its way: the card is already gone, and the thread carries on.
  expect(shownConversation(feed)).toMatchObject({ state: "starting" });
  expect(shownConversation(feed).pending).toBeUndefined();
  expect(shownConversation(feed).summary).toBeUndefined();
  taken();
  await expect(sending).resolves.toBe("sent");
  expect(shownConversation(feed).pending).toBeUndefined();
});

it("a stale read cannot bring an answered card back while its answer is pending or taken", async () => {
  const feed = await import("./homeFeed");
  fetchHome.mockImplementation(async () => asking());
  await feed.refreshAldoHome();
  let taken!: () => void;
  const sending = feed.sendAldoAnswer(
    shownConversation(feed),
    () => new Promise<string>((resolve) => (taken = () => resolve("sent"))),
  );
  // Reads in flight when it was sent, and later ones from a thread that hasn't woken: all say it asks.
  fetchHome.mockImplementation(async () => ({ ...asking(), at: "2026-10-16T00:00:30Z" }));
  await feed.refreshAldoHome();
  expect(shownConversation(feed).pending).toBeUndefined();
  taken();
  await sending;
  fetchHome.mockImplementation(async () => ({ ...asking(), at: "2026-10-16T00:01:00Z" }));
  await feed.refreshAldoHome();
  expect(shownConversation(feed)).toMatchObject({ state: "starting" });
  expect(shownConversation(feed).pending).toBeUndefined();
  // Once the thread reports it has moved on, what it says is shown as it says it.
  fetchHome.mockImplementation(async () => ({
    ...home(),
    conversations: home().conversations.map((c) => ({ ...c, state: "working" })),
  }));
  await feed.refreshAldoHome();
  expect(shownConversation(feed).state).toBe("working");
  // And a new question after is a new card, not the old one held.
  fetchHome.mockImplementation(async () => asking("r2"));
  await feed.refreshAldoHome();
  expect(shownConversation(feed).pending).toMatchObject({ kind: "question", requestId: "r2" });
});

it("an answer Aldo refuses brings its card back, with why, even after reads that said it asked", async () => {
  const feed = await import("./homeFeed");
  fetchHome.mockImplementation(async () => asking());
  await feed.refreshAldoHome();
  const refused = new Error("Thread not found.");
  const sending = feed.sendAldoAnswer(shownConversation(feed), async () => {
    throw refused;
  });
  expect(shownConversation(feed).pending).toBeUndefined();
  await expect(sending).rejects.toBe(refused);
  expect(shownConversation(feed)).toMatchObject({ state: "waiting" });
  expect(shownConversation(feed).pending).toMatchObject({ kind: "question", requestId: "r1" });
  // A refusal isn't remembered: the next answer is held out the same way.
  await feed.sendAldoAnswer(shownConversation(feed), async () => "sent");
  expect(shownConversation(feed).pending).toBeUndefined();
});

it("an answer taken is still held out after the page reloads, until the thread has moved on or ten minutes pass", async () => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  try {
    const feed = await import("./homeFeed");
    fetchHome.mockImplementation(async () => asking());
    await feed.refreshAldoHome();
    await feed.sendAldoAnswer(shownConversation(feed), async () => "sent");
    expect(stored.get("aldo-answered")).toContain("r1");
    vi.resetModules();
    const reloaded = await import("./homeFeed");
    await reloaded.refreshAldoHome();
    expect(reloaded.useAldoHomeFeed.getState().home!.conversations[0]!.pending).toBeUndefined();
    vi.useFakeTimers({ now: Date.now() + 11 * 60_000, toFake: ["Date"] });
    await reloaded.refreshAldoHome();
    expect(reloaded.useAldoHomeFeed.getState().home!.conversations[0]!.pending).toMatchObject({
      requestId: "r1",
    });
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("an answer that was never taken is not held out after a reload", async () => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  try {
    const feed = await import("./homeFeed");
    fetchHome.mockImplementation(async () => asking());
    await feed.refreshAldoHome();
    void feed.sendAldoAnswer(shownConversation(feed), () => new Promise<string>(() => {}));
    expect(shownConversation(feed).pending).toBeUndefined();
    vi.resetModules();
    const reloaded = await import("./homeFeed");
    await reloaded.refreshAldoHome();
    expect(reloaded.useAldoHomeFeed.getState().home!.conversations[0]!.pending).toMatchObject({
      requestId: "r1",
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

it("an answer refused because the thread had moved on leaves no card behind", async () => {
  const feed = await import("./homeFeed");
  const { AldoApiError } = await import("./api");
  fetchHome.mockImplementation(async () => asking());
  await feed.refreshAldoHome();
  // Answered elsewhere: Aldo says 409, and its next read has the thread working.
  fetchHome.mockImplementation(async () => ({
    ...home(),
    conversations: home().conversations.map((c) => ({ ...c, state: "working" })),
  }));
  const moved = new AldoApiError(409, "That question has already been answered.");
  await expect(
    feed.sendAldoAnswer(shownConversation(feed), async () => {
      throw moved;
    }),
  ).rejects.toBe(moved);
  expect(shownConversation(feed)).toMatchObject({ state: "working" });
  expect(shownConversation(feed).pending).toBeUndefined();
});

it("an answer the assistant sent for the user takes its card away the same way", async () => {
  const feed = await import("./homeFeed");
  fetchHome.mockImplementation(async () => asking());
  await feed.refreshAldoHome();
  feed.noteAldoAnswered(shownConversation(feed).thread);
  expect(shownConversation(feed).pending).toBeUndefined();
  await feed.refreshAldoHome();
  expect(shownConversation(feed)).toMatchObject({ state: "starting" });
});
