// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

// A written message on Home: sent at once by its own id, sent again when the connection breaks,
// kept on the device until Aldo has it, and never shown as failed once Aldo has.

const backend = vi.hoisted(() => ({
  history: vi.fn(async (_limit?: number): Promise<unknown[]> => []),
  send: vi.fn(),
  turn: vi.fn(),
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
    send: backend.send,
    turn: backend.turn,
    kept: async () => ({ pending: null, needsPlan: null }),
    resume: vi.fn(),
    followups: async () => null,
  },
  getAldoEnvironments: () => [],
  requestAldoDirectoryRefresh: vi.fn(),
  subscribeAldoEnvironments: () => () => {},
}));
const outbox = vi.hoisted(() => new Map<string, unknown>());
vi.mock("./homeOutbox", () => ({
  keepHomeMessage: async (message: { id: string }) => void outbox.set(message.id, message),
  dropHomeMessage: async (id: string) => void outbox.delete(id),
  homeMessages: async () => [...outbox.values()],
}));
vi.mock("./api", () => aldoApiMock);
vi.mock("./assistantApi", () => aldoApiMock);
vi.mock("./directory", () => aldoApiMock);
vi.mock("../components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));
vi.mock("./screen", () => ({ aldoOnScreen: () => null, subscribeAldoOnScreen: () => () => {} }));

const taken = { kind: "taken", sessionId: "as_server00000" };
const reply = (text: string) => ({ sessionId: "as_server00000", reply: text, calls: [] });
const offline = () => new TypeError("Failed to fetch");
const said = (s: { entries: ReadonlyArray<{ kind: string; role?: string; text?: string }> }) =>
  s.entries.flatMap((e) => (e.kind === "message" ? [`${e.role}: ${e.text}`] : []));

/** A fresh page: the session's module state starts over (the device's outbox stays). */
async function page() {
  window.history.replaceState(null, "", "/");
  vi.resetModules();
  return import("./assistantSession");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => (resolve = yes));
  return { promise, resolve };
}

beforeEach(() => {
  backend.history.mockReset();
  backend.history.mockResolvedValue([]);
  backend.send.mockReset();
  backend.turn.mockReset();
  outbox.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

it("sends each message at once by an id of its own, in one session, without waiting for any answer", async () => {
  const { sendText, useAldoAssistant } = await page();
  backend.send.mockResolvedValue(taken);
  backend.turn.mockReturnValue(new Promise(() => {}));
  sendText("Plan dinner");
  sendText("For four people");
  sendText("Make it vegetarian");
  await vi.waitFor(() => expect(backend.send).toHaveBeenCalledTimes(3));
  const calls = backend.send.mock.calls;
  expect(new Set(calls.map((call) => call[0])).size).toBe(3);
  for (const [id, session] of calls) {
    expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(session).toBe(calls[0]?.[1]);
  }
  expect(calls[0]?.[1]).toMatch(/^as_[a-z0-9]{12}$/);
  expect(calls.map((call) => call[2])).toEqual([
    "Plan dinner",
    "For four people",
    "Make it vegetarian",
  ]);
  expect(said(useAldoAssistant.getState())).toEqual([
    "user: Plan dinner",
    "user: For four people",
    "user: Make it vegetarian",
  ]);
  expect(useAldoAssistant.getState().undelivered).toEqual([]);
});

it("shows each answer once, as Aldo gives them, and the typing dots until the last", async () => {
  const { sendText, useAldoAssistant } = await page();
  const answers = new Map<string, ReturnType<typeof deferred<unknown>>>();
  backend.send.mockResolvedValue(taken);
  backend.turn.mockImplementation((id: string) => {
    const answer = deferred<unknown>();
    answers.set(id, answer);
    return answer.promise;
  });
  sendText("First");
  sendText("Second");
  await vi.waitFor(() => expect(answers.size).toBe(2));
  const [first, second] = backend.send.mock.calls.map((call) => call[0] as string);
  answers.get(first!)!.resolve(reply("One."));
  await vi.waitFor(() => expect(said(useAldoAssistant.getState())).toContain("assistant: One."));
  expect(useAldoAssistant.getState().replying).toBe(true);
  answers.get(second!)!.resolve(reply("Two."));
  await vi.waitFor(() => expect(useAldoAssistant.getState().replying).toBe(false));
  expect(said(useAldoAssistant.getState())).toEqual([
    "user: First",
    "user: Second",
    "assistant: One.",
    "assistant: Two.",
  ]);
  expect(outbox.size).toBe(0);
});

it("sends a message again with its id when the connection breaks, without showing an error", async () => {
  vi.useFakeTimers();
  const { sendText, useAldoAssistant } = await page();
  // The request failed on the phone's network, though Aldo may have the message.
  backend.send.mockRejectedValueOnce(offline()).mockResolvedValue(taken);
  backend.turn.mockResolvedValue(reply("Hello."));
  sendText("Hi");
  await vi.advanceTimersByTimeAsync(0);
  expect(backend.send).toHaveBeenCalledTimes(1);
  expect(useAldoAssistant.getState().undelivered).toEqual([]);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(backend.send).toHaveBeenCalledTimes(2);
  expect(backend.send.mock.calls[1]?.[0]).toBe(backend.send.mock.calls[0]?.[0]);
  const state = useAldoAssistant.getState();
  expect(said(state)).toEqual(["user: Hi", "assistant: Hello."]);
  expect(state.undelivered).toEqual([]);
  expect(state.error).toBeNull();
  expect(outbox.size).toBe(0);
});

it("asks again for the answer when asking breaks, and shows nothing wrong", async () => {
  vi.useFakeTimers();
  const { sendText, useAldoAssistant } = await page();
  backend.send.mockResolvedValue(taken);
  backend.turn
    .mockRejectedValueOnce(offline())
    .mockResolvedValueOnce("pending")
    .mockResolvedValue(reply("Hello."));
  sendText("Hi");
  await vi.advanceTimersByTimeAsync(0);
  expect(useAldoAssistant.getState().undelivered).toEqual([]);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(said(useAldoAssistant.getState())).toEqual(["user: Hi", "assistant: Hello."]);
  expect(backend.send).toHaveBeenCalledTimes(1);
  expect(useAldoAssistant.getState().undelivered).toEqual([]);
});

it("says it's sending when Aldo hasn't taken a message in a few seconds, and why not after several tries", async () => {
  vi.useFakeTimers();
  const { sendText, retryAldoMessage, useAldoAssistant } = await page();
  backend.send.mockRejectedValue(offline());
  backend.turn.mockResolvedValue(reply("Hello."));
  sendText("Hi");
  const entry = useAldoAssistant.getState().entries[0]!;
  await vi.advanceTimersByTimeAsync(2_900);
  expect(useAldoAssistant.getState().undelivered).toEqual([]);
  await vi.advanceTimersByTimeAsync(100);
  expect(useAldoAssistant.getState().undelivered).toEqual([{ entry, error: null }]);
  expect(useAldoAssistant.getState().replying).toBe(false);
  await vi.advanceTimersByTimeAsync(4_000);
  expect(useAldoAssistant.getState().undelivered).toEqual([
    { entry, error: expect.stringContaining("Can't reach Aldo") },
  ]);
  // Still trying, and a tap on "Try again" is the next try now.
  backend.send.mockResolvedValue(taken);
  retryAldoMessage(entry);
  await vi.advanceTimersByTimeAsync(0);
  const state = useAldoAssistant.getState();
  expect(state.undelivered).toEqual([]);
  expect(said(state)).toEqual(["user: Hi", "assistant: Hello."]);
});

it("tries again as soon as the connection is back", async () => {
  vi.useFakeTimers();
  const { sendText, useAldoAssistant } = await page();
  backend.send.mockRejectedValueOnce(offline()).mockResolvedValue(taken);
  backend.turn.mockResolvedValue(reply("Hello."));
  sendText("Hi");
  await vi.advanceTimersByTimeAsync(0);
  expect(backend.send).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(0);
  expect(backend.send).toHaveBeenCalledTimes(2);
  expect(said(useAldoAssistant.getState())).toEqual(["user: Hi", "assistant: Hello."]);
});

it("keeps a message on the device until Aldo has it, and sends it when the app is opened again", async () => {
  // The app closes with the request unanswered.
  backend.send.mockReturnValue(new Promise(() => {}));
  const closed = await page();
  closed.sendText("Remember this");
  await vi.waitFor(() => expect(outbox.size).toBe(1));
  const [kept] = [...outbox.values()] as Array<{ id: string; text: string }>;
  expect(kept?.text).toBe("Remember this");

  backend.send.mockReset();
  backend.send.mockResolvedValue(taken);
  backend.turn.mockResolvedValue(reply("Got it."));
  const reopened = await page();
  await reopened.loadAldoConversation();
  await vi.waitFor(() =>
    expect(said(reopened.useAldoAssistant.getState())).toEqual([
      "user: Remember this",
      "assistant: Got it.",
    ]),
  );
  expect(backend.send).toHaveBeenCalledTimes(1);
  expect(backend.send.mock.calls[0]?.[0]).toBe(kept?.id);
  expect(outbox.size).toBe(0);
});

it("doesn't send a message kept on the device that Aldo has already taken in", async () => {
  outbox.set("m_kept000001", {
    id: "m_kept000001",
    sessionId: "as_page0000001",
    text: "Already there",
    images: [],
    viewing: null,
    at: "2026-10-25T18:00:00.000Z",
    keptAt: Date.now(),
  });
  backend.history.mockResolvedValue([
    {
      role: "user",
      text: "Already there",
      at: "2026-10-25T18:00:01.000Z",
      clientId: "m_kept000001",
    },
  ]);
  const { loadAldoConversation, useAldoAssistant } = await page();
  await loadAldoConversation();
  await vi.waitFor(() => expect(outbox.size).toBe(0));
  expect(backend.send).not.toHaveBeenCalled();
  expect(said(useAldoAssistant.getState())).toEqual(["user: Already there"]);
});

it("sends a refused message again, once however often it's tapped, with the same id", async () => {
  const { sendText, retryAldoMessage, useAldoAssistant } = await page();
  const refusal = new aldoApiMock.AldoApiError(429, "You've reached today's limit.", {
    error: "You've reached today's limit.",
  });
  backend.send.mockRejectedValueOnce(refusal).mockResolvedValue(taken);
  const answer = deferred<unknown>();
  backend.turn.mockReturnValue(answer.promise);
  sendText("Hi");
  await vi.waitFor(() =>
    expect(useAldoAssistant.getState().undelivered).toEqual([
      { entry: useAldoAssistant.getState().entries[0], error: "You've reached today's limit." },
    ]),
  );
  expect(outbox.size).toBe(0);
  const entry = useAldoAssistant.getState().entries[0]!;
  retryAldoMessage(entry);
  retryAldoMessage(entry);
  await vi.waitFor(() => expect(backend.turn).toHaveBeenCalled());
  answer.resolve(reply("Hello."));
  await vi.waitFor(() => expect(useAldoAssistant.getState().replying).toBe(false));
  expect(backend.send).toHaveBeenCalledTimes(2);
  expect(backend.send.mock.calls[1]?.[0]).toBe(backend.send.mock.calls[0]?.[0]);
  expect(said(useAldoAssistant.getState())).toEqual(["user: Hi", "assistant: Hello."]);
  expect(useAldoAssistant.getState().undelivered).toEqual([]);
});

it("sends a message Aldo couldn't answer as a new one when the user tries again", async () => {
  const { sendText, retryAldoMessage, useAldoAssistant } = await page();
  backend.send.mockResolvedValue(taken);
  backend.turn
    .mockRejectedValueOnce(
      new aldoApiMock.AldoApiError(500, "Aldo hit a snag.", {
        error: "Aldo hit a snag.",
        failed: true,
      }),
    )
    .mockResolvedValue(reply("Hello."));
  sendText("Hi");
  await vi.waitFor(() =>
    expect(useAldoAssistant.getState().undelivered[0]?.error).toBe("Aldo hit a snag."),
  );
  retryAldoMessage(useAldoAssistant.getState().entries[0]!);
  await vi.waitFor(() => expect(said(useAldoAssistant.getState())).toContain("assistant: Hello."));
  expect(backend.send).toHaveBeenCalledTimes(2);
  expect(backend.send.mock.calls[1]?.[0]).not.toBe(backend.send.mock.calls[0]?.[0]);
});

it("doesn't show an answer twice that the conversation's refresh read from Aldo first", async () => {
  const { loadAldoConversation, pullAldoConversation, sendText, useAldoAssistant } = await page();
  await loadAldoConversation();
  const answer = deferred<unknown>();
  backend.send.mockResolvedValue(taken);
  backend.turn.mockReturnValue(answer.promise);
  sendText("Hi");
  await vi.waitFor(() => expect(backend.turn).toHaveBeenCalled());
  backend.history.mockResolvedValue([
    { role: "user", text: "Hi", at: "2026-10-25T18:00:00.000Z" },
    { role: "assistant", text: "Hello.", at: "2026-10-25T18:00:05.000Z" },
  ]);
  await pullAldoConversation();
  answer.resolve(reply("Hello."));
  await vi.waitFor(() => expect(useAldoAssistant.getState().replying).toBe(false));
  expect(said(useAldoAssistant.getState())).toEqual(["user: Hi", "assistant: Hello."]);
});

it("puts the words into a call on an older Aldo that can't chat in writing", async () => {
  const { sendText, useAldoAssistant } = await page();
  backend.send.mockRejectedValue(new aldoApiMock.AldoApiError(404, "Not found"));
  sendText("Hi");
  await vi.waitFor(() => expect(useAldoAssistant.getState().entries).toEqual([]));
  expect(outbox.size).toBe(0);
});
