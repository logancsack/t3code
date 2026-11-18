// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vite-plus/test";

// Startup status through an ordinary written Home turn and directory refreshes.

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
  requestAldoProfile: async () => ({ id: "u1" }),
  getAldoEnvironments: vi.fn((): unknown[] => []),
  requestAldoDirectoryRefresh: vi.fn(),
  subscribeAldoEnvironments: vi.fn((_listener: () => void) => () => {}),
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
const toasts = vi.hoisted(() => ({ add: vi.fn(), close: vi.fn() }));
vi.mock("../components/ui/toast", () => ({ toastManager: toasts }));
vi.mock("./screen", () => ({ aldoOnScreen: () => null, subscribeAldoOnScreen: () => () => {} }));

const reply = (text: string) => ({ sessionId: "as_server00000", reply: text, calls: [] });

/** A fresh page: the session's module state starts over (the device's outbox stays). */
async function page() {
  window.history.replaceState(null, "", "/");
  vi.resetModules();
  return import("./assistantSession");
}

beforeEach(() => {
  backend.history.mockReset();
  backend.history.mockResolvedValue([]);
  backend.send.mockReset();
  backend.turn.mockReset();
  outbox.clear();
  vi.clearAllMocks();
  aldoApiMock.getAldoEnvironments.mockReturnValue([]);
});

const thread = { environmentId: "aldo-machine", threadId: "thread-1" };
const id = "start-aldo-machine-thread-1";
const title = "clipvinci.co registrant email verification";

async function start() {
  const session = await page();
  backend.send.mockResolvedValue({
    kind: "answered",
    turn: {
      ...reply("Starting it."),
      calls: [
        {
          callId: "c1",
          name: "start_thread",
          arguments: { title },
          outcome: { result: { title, thread } },
        },
      ],
    },
  });
  session.sendText("Start the verification");
  await vi.waitFor(() => expect(aldoApiMock.subscribeAldoEnvironments).toHaveBeenCalled());
  const listener = aldoApiMock.subscribeAldoEnvironments.mock.calls[0]![0];
  const update = (
    start?: { state: string; attempts?: number; detail?: string },
    attention?: unknown,
  ) => {
    aldoApiMock.getAldoEnvironments.mockReturnValue([
      {
        environmentId: thread.environmentId,
        starts: start ? { [thread.threadId]: start } : {},
        attention,
      },
    ]);
    listener();
  };
  const notices = () =>
    session.useAldoAssistant.getState().entries.filter((e) => e.kind === "action" && e.id === id);
  return { ...session, update, notices };
}

it("a single failed start then success has no toast or Home notice", async () => {
  const { update, notices } = await start();
  update({ state: "starting", attempts: 1 });
  expect(notices()).toEqual([]);
  expect(toasts.add).not.toHaveBeenCalled();
  update(undefined, { [thread.threadId]: { state: "working" } });
  expect(notices()).toEqual([]);
  expect(toasts.add).not.toHaveBeenCalled();
});

it("two failures show one neutral notice and success retracts both surfaces before attention arrives", async () => {
  const { update, notices } = await start();
  update({ state: "retrying", attempts: 2, detail: "Timed out." });
  expect(notices()).toMatchObject([
    {
      failed: false,
      label: `Starting "${title}" is taking longer than usual (timed out). Retrying.`,
    },
  ]);
  expect(toasts.add).toHaveBeenCalledWith(expect.objectContaining({ id, type: "info" }));
  update({ state: "retrying", attempts: 3, detail: "Timed out." });
  expect(toasts.add).toHaveBeenCalledTimes(1);
  expect(notices()).toHaveLength(1);
  update();
  expect(notices()).toEqual([]);
  expect(toasts.close).toHaveBeenLastCalledWith(id);
});

it("exhausted retries replace the neutral notice with a plain error", async () => {
  const { update, notices } = await start();
  update({ state: "retrying", attempts: 2, detail: "Timed out." });
  update({ state: "failed", attempts: 5, detail: "Timed out." });
  expect(notices()).toMatchObject([
    { failed: true, label: `Couldn't start "${title}": Timed out` },
  ]);
  expect(toasts.add).toHaveBeenLastCalledWith(
    expect.objectContaining({ id, type: "error", timeout: 0 }),
  );
});

it("a client on an older server waits quietly without a failure count", async () => {
  const { update, notices } = await start();
  update({ state: "retrying", detail: "The operation was aborted due to timeout" });
  expect(notices()).toEqual([]);
  expect(toasts.add).not.toHaveBeenCalled();
});
