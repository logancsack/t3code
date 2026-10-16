// @vitest-environment jsdom

import { act, createContext, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { type AldoHome } from "./homeApi";

const backend = vi.hoisted(() => ({
  home: null as AldoHome | null,
  fail: false,
  readFail: false,
  dismiss: vi.fn(),
  decide: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("./homeApi", () => ({
  fetchAldoHome: async () => {
    if (backend.readFail) throw new Error("Read failed");
    return structuredClone(backend.home);
  },
  dismissAldoChatDecision: async (id: string, dismissed = true) => {
    backend.dismiss(id, dismissed);
    if (backend.fail) throw new Error("Connection lost");
    backend.home = {
      ...backend.home!,
      conversations: backend.home!.conversations.map((c) =>
        c.chatDecision?.id === id ? { ...c, chatDecision: { id, dismissed } } : c,
      ),
    };
  },
}));
vi.mock("./assistantSession", () => ({ noteAldoHiddenPrompts: vi.fn() }));
vi.mock("../components/ui/toast", () => ({ toastManager: { add: backend.toast, close: vi.fn() } }));
vi.mock("./AldoApprovals", () => ({ ApprovalCard: () => null }));
vi.mock("./AldoBrief", () => ({ DecisionIcon: () => null, confirmQuickChoice: vi.fn() }));
vi.mock("./AldoHandoffCard", () => ({ AldoHandoffActions: () => null }));
vi.mock("./AldoHomeInbox", () => ({
  askAldoAbout: backend.decide,
  PendingForm: () => null,
  ThreadLink: ({ children }: { children: ReactNode }) => <a href="#thread">{children}</a>,
}));
vi.mock("./AldoLiveCard", () => ({ AldoOpenContext: createContext(null) }));
vi.mock("./AldoPresence", () => ({ AldoAvatar: () => null }));
vi.mock("./briefFeed", () => ({
  useAldoBrief: (select: (s: { brief: null }) => unknown) => select({ brief: null }),
}));
vi.mock("./decide", () => ({ decideAldoOutcome: backend.decide }));
vi.mock("./receipts", () => ({
  addAldoReceipt: backend.decide,
  useAldoReceipts: (select: (s: { receipts: never[] }) => unknown) => select({ receipts: [] }),
}));
vi.mock("./walkthrough", () => ({
  startAldoWalkthrough: backend.decide,
  reconcileAldoWalkthrough: vi.fn(),
}));

let AldoUpNext: typeof import("./AldoUpNext").AldoUpNext;
let refreshAldoHome: typeof import("./homeFeed").refreshAldoHome;
let useAldoHomeFeed: typeof import("./homeFeed").useAldoHomeFeed;

let root: Root;
let container: HTMLDivElement;
const now = Date.now();
function Page() {
  const home = useAldoHomeFeed((s) => s.home);
  return (
    <>
      <p>The rest of Aldo's conversation</p>
      {home ? <AldoUpNext home={home} now={now} /> : null}
    </>
  );
}
async function mount() {
  root = createRoot(container);
  await act(async () => {
    await refreshAldoHome();
    root.render(<Page />);
  });
}
beforeEach(async () => {
  vi.resetModules();
  ({ AldoUpNext } = await import("./AldoUpNext"));
  ({ refreshAldoHome, useAldoHomeFeed } = await import("./homeFeed"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  backend.fail = false;
  backend.readFail = false;
  backend.dismiss.mockClear();
  backend.decide.mockClear();
  backend.toast.mockClear();
  const conversations = ["plan", "question"].map((kind, i) => ({
    ref: `thread-${i}`,
    title: `Thread ${i}`,
    repos: [],
    branch: "aldo/test",
    state: "waiting",
    machine: "asleep",
    at: new Date(now).toISOString(),
    thread: { environmentId: `aldo-${i}`, threadId: `${i}` },
    chatDecision: { id: `item-${i}`, dismissed: false },
    ...(kind === "plan"
      ? { plan: { id: "plan", text: "Build the project" } }
      : {
          pending: {
            kind: "question",
            requestId: "q",
            questions: [
              {
                id: "q",
                header: "Colour",
                question: "Which colour?",
                options: [{ label: "Blue", description: "Blue" }],
                multiSelect: false,
              },
            ],
          },
        }),
  }));
  backend.home = {
    at: new Date(now).toISOString(),
    conversations,
    approvals: [],
    pullRequests: [],
  } as unknown as AldoHome;
  container = document.createElement("div");
  document.body.append(container);
  await mount();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const hide = async (index = 0) => {
  const button = container.querySelectorAll<HTMLButtonElement>(
    'button[aria-label^="Not now: hide"]',
  )[index]!;
  await act(async () => button.click());
};

it("hides an expanded card without answering and retains it after reload and remount", async () => {
  expect(container.querySelectorAll("[data-aldo-decision]")).toHaveLength(2);
  await hide();
  expect(container.querySelectorAll("[data-aldo-decision]")).toHaveLength(1);
  expect(container.textContent).toContain("Which colour?");
  expect(container.textContent).toContain("The rest of Aldo's conversation");
  expect(backend.dismiss).toHaveBeenCalledExactlyOnceWith("item-0", true);
  expect(backend.decide).not.toHaveBeenCalled();
  expect(backend.home!.conversations[0]!.state).toBe("waiting");
  expect(backend.home!.conversations[0]!.plan).toEqual({ id: "plan", text: "Build the project" });
  await act(async () => root.unmount());
  await mount();
  expect(container.querySelectorAll("[data-aldo-decision]")).toHaveLength(1);
});

it("can hide a folded card without opening it, and a new prompt in that thread appears", async () => {
  await hide(1);
  expect(container.querySelectorAll("[data-aldo-decision]")).toHaveLength(1);
  const c = backend.home!.conversations[1]!;
  backend.home = {
    ...backend.home!,
    conversations: [
      backend.home!.conversations[0]!,
      {
        ...c,
        chatDecision: { id: "new-item", dismissed: false },
        pending: { ...c.pending!, requestId: "new-question" },
      },
    ],
  };
  await act(async () => refreshAldoHome());
  expect(container.querySelectorAll("[data-aldo-decision]")).toHaveLength(2);
  expect(backend.decide).not.toHaveBeenCalled();
});

it("leaves the card visible when persistence fails", async () => {
  backend.fail = true;
  await hide();
  expect(container.querySelectorAll("[data-aldo-decision]")).toHaveLength(2);
  expect(backend.toast).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Couldn't hide the prompt" }),
  );
});

it("Undo restores a hidden prompt without making a decision", async () => {
  await hide();
  const toast = backend.toast.mock.calls.at(-1)![0] as { actionProps: { onClick: () => void } };
  await act(async () => toast.actionProps.onClick());
  expect(container.querySelectorAll("[data-aldo-decision]")).toHaveLength(2);
  expect(backend.decide).not.toHaveBeenCalled();
});

it("hides a saved dismissal even if refreshing the home read fails", async () => {
  backend.readFail = true;
  await hide();
  expect(container.querySelectorAll("[data-aldo-decision]")).toHaveLength(1);
  expect(backend.home!.conversations[0]!.state).toBe("waiting");
  expect(backend.decide).not.toHaveBeenCalled();
});

it("can restore a persisted hidden prompt after remount without answering", async () => {
  await hide();
  await act(async () => root.unmount());
  await mount();
  const summary = container.querySelector("summary")!;
  expect(summary.textContent).toContain("Hidden from chat (1)");
  await act(async () => summary.click());
  const show = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Show Thread 0 in Aldo chat again"]',
  )!;
  await act(async () => show.click());
  expect(container.querySelectorAll("[data-aldo-decision]")).toHaveLength(2);
  expect(backend.dismiss).toHaveBeenLastCalledWith("item-0", false);
  expect(backend.decide).not.toHaveBeenCalled();
});
