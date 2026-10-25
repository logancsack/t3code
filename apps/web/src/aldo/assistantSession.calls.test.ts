// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vite-plus/test";

// A voice call in the conversation Aldo keeps is one card, placed where it began; the page reads its summary
// back as it's written, and shows every turn of a call as it always did when Aldo doesn't draw cards.

const backend = vi.hoisted(() => ({
  history: vi.fn(async (_limit?: number): Promise<unknown[]> => []),
}));
const aldoApiMock = vi.hoisted(() => ({
  AldoApiError: class AldoApiError extends Error {},
  aldoAssistant: {
    history: backend.history,
    kept: async () => ({ pending: null, needsPlan: null }),
    followups: async () => null,
  },
  requestAldoProfile: async () => ({ id: "u1" }),
  getAldoEnvironments: () => [],
  requestAldoDirectoryRefresh: vi.fn(),
  subscribeAldoEnvironments: () => () => {},
}));
vi.mock("./homeOutbox", () => ({
  keepHomeMessage: async () => {},
  dropHomeMessage: async () => {},
  homeMessages: async () => [],
}));
vi.mock("./api", () => aldoApiMock);
vi.mock("./assistantApi", () => aldoApiMock);
vi.mock("./directory", () => aldoApiMock);
vi.mock("../components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));
vi.mock("./screen", () => ({ aldoOnScreen: () => null, subscribeAldoOnScreen: () => () => {} }));

const call = (over: Record<string, unknown> = {}) => ({
  kind: "call",
  id: "as_call0000001",
  at: "2026-10-25T18:00:00.000Z",
  state: "summarizing",
  seconds: 120,
  summary: null,
  links: [],
  ...over,
});
const message = (text: string, at: string, role = "user") => ({ role, text, at });
const drawing = (items: unknown[]) => Object.assign(items, { calls: true });
const kinds = (s: { entries: ReadonlyArray<{ kind: string; text?: string }> }) =>
  s.entries.map((e) => (e.kind === "message" ? (e.text ?? "") : e.kind));

async function page() {
  window.history.replaceState(null, "", "/");
  vi.resetModules();
  return import("./assistantSession");
}

beforeEach(() => backend.history.mockReset());

it("reads a call as one card among the messages, where it began", async () => {
  backend.history.mockResolvedValue(
    drawing([
      message("Morning", "2026-10-25T17:00:00.000Z"),
      call(),
      message("Thanks", "2026-10-25T18:30:00.000Z"),
    ]),
  );
  const { loadAldoConversation, useAldoAssistant } = await page();
  await loadAldoConversation();
  expect(kinds(useAldoAssistant.getState())).toEqual(["Morning", "call", "Thanks"]);
});

it("replaces the card as Aldo writes the summary, and adds a call made elsewhere after what the page has", async () => {
  backend.history.mockResolvedValueOnce(
    drawing([message("Morning", "2026-10-25T17:00:00.000Z"), call()]),
  );
  const { loadAldoConversation, pullAldoConversation, useAldoAssistant } = await page();
  await loadAldoConversation();
  const latest = drawing([
    message("Morning", "2026-10-25T17:00:00.000Z"),
    call({
      state: "done",
      summary: "You moved the dentist to Thursday.",
      links: [{ kind: "page", title: "Note", url: "/s/x" }],
    }),
    call({ id: "as_call0000002", at: "2026-10-25T19:00:00.000Z", state: "live", seconds: 0 }),
  ]);
  backend.history.mockResolvedValueOnce(latest);
  await pullAldoConversation();
  const calls = useAldoAssistant.getState().entries.flatMap((e) => (e.kind === "call" ? [e] : []));
  expect(calls.map((c) => [c.id, c.state, c.summary])).toEqual([
    ["as_call0000001", "done", "You moved the dentist to Thursday."],
    ["as_call0000002", "live", null],
  ]);
  // Read again with nothing new: the entries stay as they were.
  const before = useAldoAssistant.getState().entries;
  backend.history.mockResolvedValueOnce(latest);
  await pullAldoConversation();
  expect(useAldoAssistant.getState().entries).toBe(before);
});

it("keeps every turn as a message when Aldo doesn't draw calls", async () => {
  backend.history.mockResolvedValue([
    message("Move my dentist appointment.", "2026-10-25T18:00:05.000Z"),
    message("Done.", "2026-10-25T18:00:09.000Z", "assistant"),
  ]);
  const { loadAldoConversation, useAldoAssistant } = await page();
  await loadAldoConversation();
  expect(kinds(useAldoAssistant.getState())).toEqual(["Move my dentist appointment.", "Done."]);
});

it("puts what another device said and called in the order Aldo kept it", async () => {
  backend.history.mockResolvedValueOnce(drawing([message("Morning", "2026-10-25T16:00:00.000Z")]));
  const { loadAldoConversation, pullAldoConversation, useAldoAssistant } = await page();
  await loadAldoConversation();
  backend.history.mockResolvedValueOnce(
    drawing([
      message("Morning", "2026-10-25T16:00:00.000Z"),
      message("Later", "2026-10-25T17:00:00.000Z"),
      call({ at: "2026-10-25T18:00:00.000Z" }),
      message("After", "2026-10-25T18:30:00.000Z"),
    ]),
  );
  await pullAldoConversation();
  expect(kinds(useAldoAssistant.getState())).toEqual(["Morning", "Later", "call", "After"]);
});
