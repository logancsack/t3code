// @vitest-environment jsdom
// The Home composer's send (assistantSession.ts chatText): the message shows and the box clears at
// once, more can be sent while Aldo answers, and a request that dies on the way (a phone putting the
// page to sleep: "Failed to fetch") is checked against what Aldo has before any error is shown.
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

type Said = { role: "user" | "assistant"; text: string; at: string; clientId?: string };
const backend = vi.hoisted(() => ({
  history: vi.fn(async (_limit?: number): Promise<unknown[]> => []),
  conversation: vi.fn(async (_limit?: number) => ({ messages: [] as unknown[], replying: false })),
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
    conversation: backend.conversation,
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

async function page() {
  vi.resetModules();
  const session = await import("./assistantSession");
  await session.loadAldoConversation();
  return session;
}
const said = (s: { entries: ReadonlyArray<{ kind: string; role?: string; text?: string }> }) =>
  s.entries.flatMap((e) => (e.kind === "message" ? [`${e.role}: ${e.text}`] : []));
const turn = (reply: string) => ({ sessionId: "as_server", reply, calls: [] });
const queued = { sessionId: "as_server", reply: "", calls: [], queued: true };
const at = (n: number) => new Date(Date.UTC(2026, 9, 20, 10, 0, n)).toISOString();
const failedToFetch = () => new TypeError("Failed to fetch");
/** The id the page gave the nth message it sent. */
const idOf = (call: number) => backend.chat.mock.calls[call]?.[4] as string;

beforeEach(() => {
  vi.useFakeTimers();
  backend.history.mockReset().mockResolvedValue([]);
  backend.conversation.mockReset().mockResolvedValue({ messages: [], replying: false });
  backend.chat.mockReset();
  backend.kept.mockResolvedValue({ pending: null, needsPlan: null });
});
afterEach(() => {
  vi.useRealTimers();
});

it("shows the message the moment it's sent, then Aldo's reply, with nothing left to restore", async () => {
  const { sendText, useAldoAssistant } = await page();
  let answer!: (value: unknown) => void;
  backend.chat.mockReturnValue(new Promise((resolve) => (answer = resolve)));
  sendText("Check the deploy");
  expect(said(useAldoAssistant.getState())).toEqual(["user: Check the deploy"]);
  expect(useAldoAssistant.getState().replying).toBe(true);
  expect(backend.chat.mock.calls[0]?.[0]).toMatch(/^as_[0-9a-z]{12}$/);
  expect(idOf(0)).toMatch(/^[0-9a-f-]{36}$/);
  answer(turn("The deploy is green."));
  await vi.advanceTimersByTimeAsync(0);
  const state = useAldoAssistant.getState();
  expect(said(state)).toEqual(["user: Check the deploy", "assistant: The deploy is green."]);
  expect([state.replying, state.error, state.unsent]).toEqual([false, null, null]);
});

it("takes messages sent back to back while Aldo is replying, in order, none twice", async () => {
  const { sendText, useAldoAssistant } = await page();
  let first!: (value: unknown) => void;
  backend.chat
    .mockReturnValueOnce(new Promise((resolve) => (first = resolve)))
    .mockResolvedValue(queued);
  sendText("Start the deck");
  sendText("Make it blue");
  sendText("And ten slides");
  expect(said(useAldoAssistant.getState())).toEqual([
    "user: Start the deck",
    "user: Make it blue",
    "user: And ten slides",
  ]);
  await vi.advanceTimersByTimeAsync(0);
  // One session and its own id for each, so nothing is dropped or doubled on a retry.
  const sessions = new Set(backend.chat.mock.calls.map((c) => c[0]));
  expect(sessions.size).toBe(1);
  expect(new Set([0, 1, 2].map(idOf)).size).toBe(3);
  // Aldo answers the first; the other two are answered together, and arrive in the conversation.
  first(turn("On it."));
  backend.conversation.mockResolvedValueOnce({
    messages: [],
    replying: true,
  });
  backend.conversation.mockResolvedValue({
    messages: [
      { role: "user", text: "Start the deck", at: at(1), clientId: idOf(0) },
      { role: "user", text: "Make it blue", at: at(2), clientId: idOf(1) },
      { role: "user", text: "And ten slides", at: at(3), clientId: idOf(2) },
      { role: "assistant", text: "On it.", at: at(4) },
      { role: "assistant", text: "Blue, ten slides.", at: at(5) },
    ],
    replying: false,
  });
  await vi.advanceTimersByTimeAsync(7_000);
  const state = useAldoAssistant.getState();
  expect(said(state)).toEqual([
    "user: Start the deck",
    "user: Make it blue",
    "user: And ten slides",
    "assistant: On it.",
    "assistant: Blue, ten slides.",
  ]);
  expect([state.replying, state.error, state.unsent]).toEqual([false, null, null]);
});

it("doesn't fail a send that went through when the request dies on the way", async () => {
  const { sendText, useAldoAssistant } = await page();
  backend.chat.mockRejectedValue(failedToFetch());
  sendText("Check the deploy");
  // Back from the background: Aldo has the message, and is still answering it.
  let polls = 0;
  backend.conversation.mockImplementation(async () => {
    const mine = { role: "user", text: "Check the deploy", at: at(1), clientId: idOf(0) };
    return ++polls <= 2
      ? { messages: [mine], replying: true }
      : {
          messages: [mine, { role: "assistant", text: "The deploy is green.", at: at(2) }],
          replying: false,
        };
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(useAldoAssistant.getState().error).toBeNull();
  await vi.advanceTimersByTimeAsync(7_000);
  const state = useAldoAssistant.getState();
  expect(said(state)).toEqual(["user: Check the deploy", "assistant: The deploy is green."]);
  expect([state.replying, state.error, state.unsent]).toEqual([false, null, null]);
  // It was never sent a second time.
  expect(backend.chat).toHaveBeenCalledTimes(1);
});

it("sends it again with the same id when it never got there, and only then gives up, once", async () => {
  const { sendText, useAldoAssistant } = await page();
  backend.chat.mockRejectedValue(failedToFetch());
  sendText("Check the deploy");
  await vi.advanceTimersByTimeAsync(10_000);
  // Every try had the same id, so Aldo couldn't take it twice.
  expect(backend.chat).toHaveBeenCalledTimes(3);
  expect(new Set([0, 1, 2].map(idOf)).size).toBe(1);
  const state = useAldoAssistant.getState();
  expect(said(state)).toEqual([]);
  expect(state.error).toBe("Couldn't reach Aldo. Your message is back in the box: send it again.");
  expect(state.unsent).toBe("Check the deploy");
  expect(state.replying).toBe(false);
  // Sent again unchanged, it's the same message.
  backend.chat.mockResolvedValue(turn("Green."));
  sendText("Check the deploy");
  await vi.advanceTimersByTimeAsync(0);
  expect(idOf(3)).toBe(idOf(0));
  expect(said(useAldoAssistant.getState())).toEqual([
    "user: Check the deploy",
    "assistant: Green.",
  ]);
});

it("is told when Aldo refuses it, without calling that a lost send", async () => {
  const { sendText, useAldoAssistant } = await page();
  backend.chat.mockRejectedValue(new aldoApiMock.AldoApiError(429, "That's enough for now."));
  sendText("Check the deploy");
  await vi.advanceTimersByTimeAsync(0);
  expect(backend.chat).toHaveBeenCalledTimes(1);
  const state = useAldoAssistant.getState();
  expect([state.error, state.unsent, said(state)]).toEqual([
    "That's enough for now.",
    "Check the deploy",
    [],
  ]);
});

it("resumes a page that was away mid-send: the sent message stays sent and the reply arrives", async () => {
  // The app was closed (or the phone reclaimed it) while Aldo answered; nothing in the box to restore.
  backend.history.mockResolvedValue([
    { role: "user", text: "Check the deploy", at: new Date().toISOString(), clientId: "m-1" },
  ]);
  const { useAldoAssistant } = await page();
  expect(said(useAldoAssistant.getState())).toEqual(["user: Check the deploy"]);
  expect(useAldoAssistant.getState().replying).toBe(true);
  backend.conversation.mockResolvedValue({
    messages: [
      { role: "user", text: "Check the deploy", at: new Date().toISOString(), clientId: "m-1" },
      {
        role: "assistant",
        text: "The deploy is green.",
        at: new Date(Date.now() + 1_000).toISOString(),
      },
    ] satisfies Said[],
    replying: false,
  });
  await vi.advanceTimersByTimeAsync(4_000);
  const state = useAldoAssistant.getState();
  expect(said(state)).toEqual(["user: Check the deploy", "assistant: The deploy is green."]);
  expect([state.replying, state.error, state.unsent]).toEqual([false, null, null]);
});
