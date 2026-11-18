import { afterEach, expect, it, vi } from "vite-plus/test";
import type { AldoHome } from "./homeApi";

const fetchHome = vi.hoisted(() => vi.fn());
const decide = vi.hoisted(() => vi.fn());
vi.mock("./homeApi", () => ({ fetchAldoHome: fetchHome, decideAldoApproval: decide }));
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
  // A page in use says so, for Aldo to hold back what's on it from the phone.
  expect(fetchHome).toHaveBeenCalledWith({ active: true });
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

it("a dismissal from Needs you takes effect at once, in plans too, and a restore undoes it", async () => {
  const feed = await import("./homeFeed");
  const plan = { id: "p", chatDecision: { id: "plan-decision", dismissed: false } };
  fetchHome.mockImplementation(async () => ({ ...home(), plans: [plan] }));
  await feed.refreshAldoHome();
  feed.setAldoDecisionsCleared(["decision", "plan-decision"], true);
  const read = () => feed.useAldoHomeFeed.getState().home;
  expect(read()?.conversations[0]?.chatDecision).toMatchObject({ dismissed: true, cleared: true });
  const plans = (read()?.plans ?? []) as (typeof plan)[];
  expect(plans[0]?.chatDecision).toMatchObject({ cleared: true });
  // A read begun before can't put it back.
  await feed.refreshAldoHome();
  expect(read()?.conversations[0]?.chatDecision?.cleared).toBe(true);
  feed.setAldoDecisionsCleared(["decision"], false);
  expect(read()?.conversations[0]?.chatDecision).toMatchObject({
    dismissed: false,
    cleared: false,
  });
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

const working = (): AldoHome => ({
  ...home(),
  conversations: home().conversations.map((c) => ({ ...c, state: "working" })),
});

it("a refusal saying the thread moved on waits for the read in flight, and the one queued behind it", async () => {
  const feed = await import("./homeFeed");
  const { AldoApiError } = await import("./api");
  fetchHome.mockImplementation(async () => asking());
  await feed.refreshAldoHome();
  // A poll is on its way when the refusal comes back; it will still say the thread asks.
  let finish!: (read: AldoHome) => void;
  fetchHome.mockImplementationOnce(() => new Promise<AldoHome>((resolve) => (finish = resolve)));
  void feed.refreshAldoHome();
  fetchHome.mockImplementation(async () => working());
  const sending = feed.sendAldoAnswer(shownConversation(feed), async () => {
    throw new AldoApiError(409, "That question has already been answered.");
  });
  const seen: Array<string | undefined> = [];
  const stop = feed.useAldoHomeFeed.subscribe(() =>
    seen.push(shownConversation(feed).pending?.kind),
  );
  await Promise.resolve();
  finish(asking());
  await expect(sending).rejects.toThrow("already been answered");
  stop();
  expect(seen.every((kind) => kind === undefined)).toBe(true);
  expect(shownConversation(feed).state).toBe("working");
});

it("a late result for an earlier question cannot keep or release the hold of the one asked since", async () => {
  const feed = await import("./homeFeed");
  fetchHome.mockImplementation(async () => asking("r1"));
  await feed.refreshAldoHome();
  let refuseFirst!: (cause: Error) => void;
  const first = feed.sendAldoAnswer(
    shownConversation(feed),
    () => new Promise<string>((_, reject) => (refuseFirst = reject)),
  );
  // The thread asks something else, and the user answers that too.
  fetchHome.mockImplementation(async () => asking("r2"));
  await feed.refreshAldoHome();
  expect(shownConversation(feed).pending).toMatchObject({ requestId: "r2" });
  void feed.sendAldoAnswer(shownConversation(feed), () => new Promise<string>(() => {}));
  expect(shownConversation(feed).pending).toBeUndefined();
  refuseFirst(new Error("late"));
  await expect(first).rejects.toThrow("late");
  expect(shownConversation(feed).pending).toBeUndefined();
});

const approvalOf = (status: string, result: string | null = null) => ({
  id: "ap_1",
  kind: "confirm",
  title: "Submit",
  summary: "",
  fields: [],
  body: "",
  approveLabel: "Submit",
  discardLabel: "Don't",
  status,
  result,
  failed: false,
  thread: { environmentId: "aldo-t", threadId: "c" },
  threadTitle: "Work",
  createdAt: "2026-10-21T10:00:00Z",
  decidedAt: null,
});

it("an approval decided from one place is decided in every place at the tap, and comes back only if Aldo refuses", async () => {
  const feed = await import("./homeFeed");
  fetchHome.mockImplementation(async () => ({ ...home(), approvals: [approvalOf("pending")] }));
  await feed.refreshAldoHome();
  const status = () => feed.useAldoHomeFeed.getState().home?.approvals?.[0]?.status;
  expect(status()).toBe("pending");

  let answer: (value: unknown) => void = () => {};
  decide.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
  const sent = feed.sendAldoApproval({ id: "ap_1", kind: "confirm" }, "approve");
  expect(status()).toBe("approved");
  // A read that still has it waiting (Aldo's machine is slow) doesn't bring the card back.
  await feed.refreshAldoHome();
  expect(status()).toBe("approved");
  answer({ approval: approvalOf("approved", "Approved: the agent goes ahead."), message: "ok" });
  await sent;
  await feed.refreshAldoHome();
  expect(status()).toBe("approved");

  // Refused: the card is back.
  decide.mockRejectedValueOnce(new Error("Aldo is doing that right now."));
  const refused = feed.sendAldoApproval({ id: "ap_1", kind: "email" }, "discard");
  await expect(refused).rejects.toThrow("right now");
  expect(status()).toBe("pending");
});

const ME = "a".repeat(32);
const SOMEONE = "b".repeat(32);

/** A browser with storage, signed in as `who` by Aldo's cookie (none: an Aldo that doesn't set it). */
function device(who: string | null) {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  const page = { cookie: who ? `theme=dark; aldo-who=${who}` : "theme=dark" };
  vi.stubGlobal("document", page);
  return {
    stored,
    signIn: (next: string | null) => (page.cookie = next ? `aldo-who=${next}` : ""),
  };
}

it("the last read shows at the next open, before its own read, only to whoever it was kept for", async () => {
  const { stored, signIn } = device(ME);
  try {
    const feed = await import("./homeFeed");
    expect(feed.useAldoHomeFeed.getState()).toMatchObject({ home: null, saved: false });
    fetchHome.mockImplementation(async () => home());
    await feed.refreshAldoHome();
    expect(JSON.parse(stored.get("aldo-home-copy")!)).toMatchObject({ who: ME, home: home() });

    // The next open: the copy at once, then the read in its place.
    vi.resetModules();
    let answer: (value: AldoHome) => void = () => {};
    fetchHome.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const reopened = await import("./homeFeed");
    expect(reopened.useAldoHomeFeed.getState()).toMatchObject({
      home: home(),
      supported: true,
      saved: true,
    });
    expect(fetchHome).toHaveBeenCalledTimes(1);
    const read = reopened.refreshAldoHome();
    answer({ ...home(), conversations: [] });
    await read;
    expect(reopened.useAldoHomeFeed.getState()).toMatchObject({ saved: false, supported: true });
    expect(reopened.useAldoHomeFeed.getState().home?.conversations).toEqual([]);
    expect(JSON.parse(stored.get("aldo-home-copy")!).home.conversations).toEqual([]);

    // Someone else signed in here, or an Aldo that doesn't say who: nothing kept shows.
    for (const who of [SOMEONE, null]) {
      signIn(who);
      vi.resetModules();
      expect((await import("./homeFeed")).useAldoHomeFeed.getState()).toMatchObject({
        home: null,
        saved: false,
      });
    }
    // Kept over a day ago: not shown either.
    signIn(ME);
    vi.useFakeTimers({ now: Date.now() + 25 * 60 * 60_000, toFake: ["Date"] });
    vi.resetModules();
    expect((await import("./homeFeed")).useAldoHomeFeed.getState().home).toBeNull();
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("signing out, or an Aldo without the read, leaves nothing kept, and the copy goes from the page", async () => {
  const { stored } = device(ME);
  try {
    const feed = await import("./homeFeed");
    const { AldoApiError } = await import("./api");
    fetchHome.mockImplementation(async () => home());
    await feed.refreshAldoHome();
    expect(stored.has("aldo-home-copy")).toBe(true);
    fetchHome.mockRejectedValueOnce(
      new AldoApiError(401, "Your Aldo session ended. Sign in again."),
    );
    await feed.refreshAldoHome();
    expect(stored.has("aldo-home-copy")).toBe(false);

    await feed.refreshAldoHome();
    vi.resetModules();
    const reopened = await import("./homeFeed");
    expect(reopened.useAldoHomeFeed.getState().saved).toBe(true);
    fetchHome.mockResolvedValueOnce(null);
    await reopened.refreshAldoHome();
    expect(reopened.useAldoHomeFeed.getState()).toMatchObject({
      home: null,
      supported: false,
      saved: false,
    });
    expect(stored.has("aldo-home-copy")).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("a read that never reached Aldo goes again at the next look; one Aldo refused waits its turn", async () => {
  const feed = await import("./homeFeed");
  const { AldoApiError } = await import("./api");
  fetchHome.mockRejectedValueOnce(new AldoApiError(503, "Unavailable"));
  await feed.refreshAldoHome();
  await feed.refreshAldoHome(false);
  expect(fetchHome).toHaveBeenCalledTimes(1);

  fetchHome.mockRejectedValueOnce(new TypeError("Aldo didn't answer in time."));
  await feed.refreshAldoHome();
  fetchHome.mockResolvedValueOnce(home());
  await feed.refreshAldoHome(false);
  expect(fetchHome).toHaveBeenCalledTimes(3);
  expect(feed.useAldoHomeFeed.getState()).toMatchObject({ home: home(), error: null });
});
