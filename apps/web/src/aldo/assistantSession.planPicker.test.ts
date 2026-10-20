// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const backend = vi.hoisted(() => ({
  history: vi.fn(async (_limit?: number): Promise<unknown[]> => []),
  chat: vi.fn(),
  kept: vi.fn(),
  resume: vi.fn(),
}));
const aldoApiMock = vi.hoisted(() => ({
  AldoApiError: class AldoApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
      readonly body?: unknown,
    ) {
      super(message);
    }
  },
  aldoAssistant: {
    history: backend.history,
    chat: backend.chat,
    kept: backend.kept,
    resume: backend.resume,
    followups: async () => null,
  },
  getAldoEnvironments: () => [],
  requestAldoDirectoryRefresh: vi.fn(),
  subscribeAldoEnvironments: () => () => {},
}));
vi.mock("./api", () => aldoApiMock);
vi.mock("./assistantApi", () => aldoApiMock);
vi.mock("./directory", () => aldoApiMock);
vi.mock("../components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));
vi.mock("./screen", () => ({ aldoOnScreen: () => null, subscribeAldoOnScreen: () => () => {} }));

const REFUSAL = "Choose a plan on the Usage page to start.";
const needsPlan = {
  requestId: "pr_abc123def456",
  text: "Make a deck from my notes",
  reason: "none",
  say: "I’ll start as soon as you choose a plan. Your request is saved, so you won’t need to type it again.",
  plans: [
    { id: "starter", name: "Starter", priceCents: 2000, credits: 2000, concurrent: 3, lines: [] },
  ],
  note: "Renews monthly. Change or cancel any time on the Usage page.",
};
const pending = {
  id: "pr_abc123def456",
  text: "Make a deck from my notes",
  at: "2026-10-20T10:00:00.000Z",
  images: 0,
};
const sent = {
  kind: "sent",
  turn: { sessionId: "as_1", reply: "On it. I’ve started a thread for your deck.", calls: [] },
  text: "Make a deck from my notes",
  plan: "Starter",
} as const;

/** A fresh page: the session's module state starts over. */
async function page(search = "") {
  window.history.replaceState(null, "", `/${search}`);
  vi.resetModules();
  return import("./assistantSession");
}

const said = (s: { entries: ReadonlyArray<{ kind: string; role?: string; text?: string }> }) =>
  s.entries.flatMap((e) => (e.kind === "message" ? [`${e.role}: ${e.text}`] : []));

beforeEach(() => {
  backend.history.mockResolvedValue([]);
  backend.kept.mockResolvedValue({ pending: null, needsPlan: null });
  backend.chat.mockReset();
  backend.resume.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

it("keeps a request refused for no plan on screen, with the picker under it", async () => {
  const { loadAldoConversation, sendText, useAldoAssistant } = await page();
  await loadAldoConversation();
  backend.chat.mockRejectedValue(
    new aldoApiMock.AldoApiError(402, REFUSAL, { error: REFUSAL, needsPlan }),
  );
  sendText("Make a deck from my notes");
  await vi.waitFor(() => expect(useAldoAssistant.getState().replying).toBe(false));
  const state = useAldoAssistant.getState();
  expect(said(state)).toEqual(["user: Make a deck from my notes"]);
  expect(state.error).toBeNull();
  expect(state.unsent).toBeNull();
  expect(state.planPick?.stage).toBe("choose");
  expect(state.planPick?.requestId).toBe("pr_abc123def456");
  expect(state.planPick?.entry).toBe(state.entries[0]);
});

it("gives the words back with the refusal from an Aldo that doesn't keep them, as before", async () => {
  const { loadAldoConversation, sendText, useAldoAssistant } = await page();
  backend.kept.mockResolvedValue(null);
  await loadAldoConversation();
  backend.chat.mockRejectedValue(new aldoApiMock.AldoApiError(402, REFUSAL, { error: REFUSAL }));
  sendText("Make a deck from my notes");
  await vi.waitFor(() => expect(useAldoAssistant.getState().replying).toBe(false));
  const state = useAldoAssistant.getState();
  expect(state.entries).toEqual([]);
  expect(state.error).toBe(REFUSAL);
  expect(state.unsent).toBe("Make a deck from my notes");
  expect(state.planPick).toBeNull();
});

it("back from Checkout, sends the kept request on its own once Stripe confirms, and clears the address", async () => {
  vi.useFakeTimers();
  const { loadAldoConversation, useAldoAssistant } = await page(
    "?resume=pr_abc123def456&session_id=cs_test_a1",
  );
  backend.kept.mockResolvedValue({ pending, needsPlan });
  // Stripe's confirmation is a moment behind the first ask.
  backend.resume
    .mockResolvedValueOnce({ kind: "needsPlan", needs: { ...needsPlan, reason: "none" } })
    .mockResolvedValueOnce(sent);
  await loadAldoConversation();
  await vi.advanceTimersByTimeAsync(0);
  expect(window.location.search).toBe("");
  expect(useAldoAssistant.getState().planPick?.stage).toBe("confirming");
  await vi.advanceTimersByTimeAsync(1_500);
  expect(backend.resume).toHaveBeenCalledTimes(2);
  expect(backend.resume).toHaveBeenLastCalledWith("pr_abc123def456", null, "cs_test_a1");
  const state = useAldoAssistant.getState();
  expect(said(state)).toEqual([
    "user: Make a deck from my notes",
    "assistant: On it. I’ve started a thread for your deck.",
  ]);
  expect(state.planPick?.stage).toBe("on");
  expect(state.planPick?.plan).toBe("Starter");
  expect(state.error).toBeNull();
});

it("sends a kept request on a later load once a plan's on (the tab was closed)", async () => {
  const { loadAldoConversation, useAldoAssistant } = await page();
  backend.kept.mockResolvedValue({ pending, needsPlan: null });
  backend.resume.mockResolvedValue(sent);
  await loadAldoConversation();
  await vi.waitFor(() => expect(useAldoAssistant.getState().planPick?.stage).toBe("on"));
  expect(backend.resume).toHaveBeenCalledTimes(1);
  expect(backend.resume).toHaveBeenCalledWith("pr_abc123def456", null, null);
  expect(said(useAldoAssistant.getState())).toHaveLength(2);
});

it("shows a kept request again with the picker while there's still no plan", async () => {
  const { loadAldoConversation, useAldoAssistant } = await page();
  backend.kept.mockResolvedValue({ pending, needsPlan });
  await loadAldoConversation();
  await vi.waitFor(() => expect(useAldoAssistant.getState().planPick?.stage).toBe("choose"));
  expect(backend.resume).not.toHaveBeenCalled();
  expect(said(useAldoAssistant.getState())).toEqual(["user: Make a deck from my notes"]);
});

it("doesn't ask to send one Aldo no longer keeps (sent from another tab)", async () => {
  const { loadAldoConversation, useAldoAssistant } = await page(
    "?resume=pr_abc123def456&session_id=cs_test_a1",
  );
  await loadAldoConversation();
  await vi.waitFor(() => expect(window.location.search).toBe(""));
  await vi.waitFor(() => expect(backend.kept).toHaveBeenCalled());
  expect(backend.resume).not.toHaveBeenCalled();
  expect(useAldoAssistant.getState().planPick).toBeNull();
});

it("waits with the request saved when Stripe takes longer, and goes on Check again", async () => {
  vi.useFakeTimers();
  const { loadAldoConversation, resumeAldoKept, useAldoAssistant } = await page(
    "?resume=pr_abc123def456&session_id=cs_test_a1",
  );
  backend.kept.mockResolvedValue({ pending, needsPlan });
  backend.resume.mockResolvedValue({ kind: "needsPlan", needs: needsPlan });
  await loadAldoConversation();
  await vi.advanceTimersByTimeAsync(30_000);
  let state = useAldoAssistant.getState();
  expect(state.planPick?.stage).toBe("waiting");
  expect(state.planPick?.note).toContain("Your request is saved");
  expect(state.error).toBeNull();
  expect(said(state)).toEqual(["user: Make a deck from my notes"]);
  const asked = backend.resume.mock.calls.length;
  backend.resume.mockResolvedValue(sent);
  await resumeAldoKept();
  expect(backend.resume).toHaveBeenCalledTimes(asked + 1);
  state = useAldoAssistant.getState();
  expect(state.planPick?.stage).toBe("on");
  expect(said(state)).toHaveLength(2);
});

it("gives the words back when what stops them isn't a plan", async () => {
  const { loadAldoConversation, useAldoAssistant } = await page();
  backend.kept.mockResolvedValue({ pending, needsPlan: null });
  backend.resume.mockResolvedValue({
    kind: "refused",
    message: "Your last payment didn’t go through.",
  });
  await loadAldoConversation();
  await vi.waitFor(() =>
    expect(useAldoAssistant.getState().error).toBe("Your last payment didn’t go through."),
  );
  const state = useAldoAssistant.getState();
  expect(state.entries).toEqual([]);
  expect(state.unsent).toBe("Make a deck from my notes");
  expect(state.planPick).toBeNull();
});

it("keeps the picker when “What can you do?” is answered without a plan", async () => {
  const { loadAldoConversation, sendText, useAldoAssistant } = await page();
  backend.kept.mockResolvedValue({ pending, needsPlan });
  await loadAldoConversation();
  await vi.waitFor(() => expect(useAldoAssistant.getState().planPick?.stage).toBe("choose"));
  backend.chat.mockResolvedValue({
    sessionId: "as_1",
    reply: "I hand your work to an agent with a computer of its own.",
    calls: [],
  });
  sendText("What can you do?");
  await vi.waitFor(() => expect(backend.kept).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(useAldoAssistant.getState().replying).toBe(false));
  const state = useAldoAssistant.getState();
  expect(backend.resume).not.toHaveBeenCalled();
  expect(state.planPick?.stage).toBe("choose");
  expect(state.error).toBeNull();
  expect(said(state)).toEqual([
    "user: Make a deck from my notes",
    "user: What can you do?",
    "assistant: I hand your work to an agent with a computer of its own.",
  ]);
});

it("sends the kept request after a turn that went once a plan's on (chosen elsewhere)", async () => {
  const { loadAldoConversation, sendText, useAldoAssistant } = await page();
  backend.kept.mockResolvedValue({ pending, needsPlan });
  await loadAldoConversation();
  await vi.waitFor(() => expect(useAldoAssistant.getState().planPick?.stage).toBe("choose"));
  backend.kept.mockResolvedValue({ pending, needsPlan: null });
  backend.chat.mockResolvedValue({ sessionId: "as_1", reply: "Hello.", calls: [] });
  backend.resume.mockResolvedValue(sent);
  sendText("Hi");
  await vi.waitFor(() => expect(useAldoAssistant.getState().planPick?.stage).toBe("on"));
  expect(backend.resume).toHaveBeenCalledTimes(1);
});

it("shows one message for a second request sent before a plan, as Aldo keeps them together", async () => {
  const { loadAldoConversation, sendText, useAldoAssistant } = await page();
  backend.kept.mockResolvedValue({ pending, needsPlan });
  await loadAldoConversation();
  await vi.waitFor(() => expect(useAldoAssistant.getState().planPick?.stage).toBe("choose"));
  const joined = {
    ...needsPlan,
    requestId: "pr_zzz999yyy888",
    text: "Make a deck from my notes\n\nAnd a one-page summary",
  };
  backend.chat.mockRejectedValue(
    new aldoApiMock.AldoApiError(402, REFUSAL, { error: REFUSAL, needsPlan: joined }),
  );
  sendText("And a one-page summary");
  await vi.waitFor(() =>
    expect(useAldoAssistant.getState().planPick?.requestId).toBe("pr_zzz999yyy888"),
  );
  const state = useAldoAssistant.getState();
  expect(said(state)).toEqual(["user: Make a deck from my notes\n\nAnd a one-page summary"]);
  expect(state.planPick?.entry).toBe(state.entries[0]);
});

it("drops the earlier request from the page when Aldo keeps only the new one", async () => {
  const { loadAldoConversation, sendText, useAldoAssistant } = await page();
  backend.kept.mockResolvedValue({ pending, needsPlan });
  await loadAldoConversation();
  await vi.waitFor(() => expect(useAldoAssistant.getState().planPick?.stage).toBe("choose"));
  const replaced = { ...needsPlan, requestId: "pr_zzz999yyy888", text: "Price my services" };
  backend.chat.mockRejectedValue(
    new aldoApiMock.AldoApiError(402, REFUSAL, { error: REFUSAL, needsPlan: replaced }),
  );
  sendText("Price my services");
  await vi.waitFor(() =>
    expect(useAldoAssistant.getState().planPick?.requestId).toBe("pr_zzz999yyy888"),
  );
  expect(said(useAldoAssistant.getState())).toEqual(["user: Price my services"]);
});

it("gives the images back with the words when a kept request is refused", async () => {
  const { loadAldoConversation, sendText, useAldoAssistant } = await page();
  await loadAldoConversation();
  const image = { name: "notes.png", dataUrl: "data:image/png;base64,AAAA" };
  backend.chat.mockRejectedValueOnce(
    new aldoApiMock.AldoApiError(402, REFUSAL, { error: REFUSAL, needsPlan }),
  );
  sendText("Make a deck from my notes", [image]);
  await vi.waitFor(() => expect(useAldoAssistant.getState().planPick?.stage).toBe("choose"));
  // A plan's chosen elsewhere, but the request is refused for what a plan doesn't fix.
  backend.kept.mockResolvedValue({ pending: { ...pending, images: 1 }, needsPlan: null });
  backend.chat.mockResolvedValue({ sessionId: "as_1", reply: "Hello.", calls: [] });
  backend.resume.mockResolvedValue({
    kind: "refused",
    message: "Your last payment didn’t go through.",
  });
  sendText("Hi");
  await vi.waitFor(() =>
    expect(useAldoAssistant.getState().error).toBe("Your last payment didn’t go through."),
  );
  const state = useAldoAssistant.getState();
  expect(state.unsent).toBe("Make a deck from my notes");
  expect(state.unsentImages).toEqual([image]);
});

it("sends a kept request found while a reply is on its way once that reply is in", async () => {
  let history!: (messages: unknown[]) => void;
  backend.history.mockReturnValueOnce(new Promise((resolve) => (history = resolve)));
  let reply!: (turn: unknown) => void;
  backend.chat.mockReturnValueOnce(new Promise((resolve) => (reply = resolve)));
  backend.kept.mockResolvedValue({ pending, needsPlan: null });
  backend.resume.mockResolvedValue(sent);
  const { loadAldoConversation, sendText, useAldoAssistant } = await page();
  const loading = loadAldoConversation();
  sendText("Hi");
  history([]);
  await loading;
  await vi.waitFor(() => expect(useAldoAssistant.getState().planPick?.stage).toBe("waiting"));
  expect(backend.resume).not.toHaveBeenCalled();
  reply({ sessionId: "as_1", reply: "Hello.", calls: [] });
  await vi.waitFor(() => expect(useAldoAssistant.getState().planPick?.stage).toBe("on"));
  expect(backend.resume).toHaveBeenCalledTimes(1);
});

it("asks again what Aldo keeps when it can't be reached on load", async () => {
  vi.useFakeTimers();
  backend.kept.mockRejectedValueOnce(new Error("Failed to fetch"));
  backend.kept.mockResolvedValue({ pending, needsPlan });
  const { loadAldoConversation, useAldoAssistant } = await page();
  await loadAldoConversation();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(backend.kept).toHaveBeenCalledTimes(2);
  expect(useAldoAssistant.getState().planPick?.stage).toBe("choose");
});
