// @vitest-environment jsdom
vi.mock("./AldoFrame", () => ({ AldoFrame: () => null }));

import { act, createContext, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { AldoConversationPage } from "./AldoConversationPage";
import { useAldoAssistant } from "./assistantSession";
import type { AldoApproval, AldoHome } from "./homeApi";
import { parseAldoPlan } from "./plans.logic";
import { useAldoReceipts } from "./receipts";
import { toastManager } from "../components/ui/toast";

const backend = vi.hoisted(() => ({
  tap: vi.fn(),
  decide: vi.fn(),
  computer: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: vi.fn,
  useRouter: vi.fn,
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../components/ui/sidebar", () => ({
  SidebarInset: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("./assistantSession", async () => {
  const { create } = await import("zustand");
  return {
    useAldoAssistant: create(() => ({ entries: [], historyLoaded: true, replying: false })),
    pullAldoConversation: vi.fn(),
    seedAldoComposer: vi.fn(),
  };
});
vi.mock("./AldoAssistant", async (original) => ({
  ...(await original<typeof import("./AldoAssistant")>()),
  AldoComposer: () => <textarea aria-label="Message Aldo" />,
  AldoCaption: () => null,
}));
vi.mock("./AldoHomeBoard", () => ({ HealthStrip: () => null }));
vi.mock("./AldoLiveCard", () => ({ AldoOpenContext: createContext(null) }));
vi.mock("./AldoPresence", () => ({ AldoPresence: () => null }));
vi.mock("./AldoHomeInbox", () => ({
  ThreadLink: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  PendingForm: () => null,
}));
vi.mock("./AldoBrief", () => ({ DecisionIcon: () => null, confirmQuickChoice: async () => true }));
vi.mock("./presenceReactions", () => ({
  acknowledgeAldo: vi.fn(),
  completeAldo: vi.fn(),
  setAldoReading: vi.fn(),
}));
vi.mock("./morph", () => ({
  aldoGlide: vi.fn(),
  aldoMorphSource: vi.fn(),
  morphIntoThread: vi.fn(),
  aldoCanMorph: () => false,
  aldoMorph: (update: () => void) => update(),
}));
vi.mock("./homeFeed", () => ({
  refreshAldoHome: backend.refresh,
  useAldoHomeFeed: (select: (s: { home: null }) => unknown) => select({ home: null }),
  useAldoHomeReadAt: (select: (s: { at: number }) => unknown) => select({ at: 0 }),
}));
vi.mock("./briefFeed", () => ({
  useAldoBrief: (select: (s: { brief: null }) => unknown) => select({ brief: null }),
}));
vi.mock("./firstView", () => ({ useAldoFirstViewHold: vi.fn() }));
vi.mock("./workspaceApi", async (original) => ({
  ...(await original<typeof import("./workspaceApi")>()),
  answerAldoComputer: backend.computer,
}));
vi.mock("./directory", async (original) => ({
  ...(await original<typeof import("./directory")>()),
  requestAldoDirectoryRefresh: vi.fn(),
}));
vi.mock("./planApi", () => ({ tapAldoPlan: backend.tap }));
vi.mock("./decide", () => ({ decideAldoOutcome: backend.decide }));

const at = (minute: number) => new Date(Date.UTC(2026, 9, 23, 12, minute)).toISOString();
const plan = parseAldoPlan({
  id: "plan-1",
  goal: "Prepare the launch",
  steps: ["Review the site", "Write the launch post"],
  cost: "Nothing",
  minutes: 30,
  status: "proposed",
  proposedAt: at(2),
  questions: [
    { id: "scope", question: "Which pages?", options: ["Home", "All pages"], recommended: "Home" },
  ],
})!;
const approval = (kind: AldoApproval["kind"] = "email"): AldoApproval => ({
  id: "draft-1",
  kind,
  provider: "google",
  title: "Launch update",
  summary: "To Alex",
  fields: [],
  body: "The launch is ready.",
  approveLabel: "Send",
  discardLabel: "Discard",
  status: "pending",
  result: null,
  failed: false,
  thread: null,
  threadTitle: null,
  createdAt: at(3),
  decidedAt: null,
});
const home = (overrides: Partial<AldoHome> = {}) =>
  ({
    conversations: [],
    pullRequests: [],
    actions: [],
    approvals: [],
    plans: [],
    ...overrides,
  }) as unknown as AldoHome;
let root: Root;
let container: HTMLDivElement;
function Page({ home }: { home: AldoHome }) {
  return (
    <AldoConversationPage
      home={home}
      supported
      error={null}
      now={Date.parse(at(20))}
      tabs={null}
      actions={null}
      welcome={null}
      issues={[]}
      chips={[]}
      onChip={vi.fn()}
    />
  );
}
function message(text: string, minute: number, role: "user" | "assistant" = "user") {
  useAldoAssistant.setState((s) => ({
    entries: [...s.entries, { kind: "message", text, at: at(minute), role }],
  }));
}
function textElement(text: string) {
  return [...container.querySelectorAll("p")].find((p) => p.textContent === text)!;
}
function before(first: Element, second: Element) {
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}
async function remount(read: AldoHome) {
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<Page home={read} />));
}
beforeEach(async () => {
  await import("../components/ChatMarkdown");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  Element.prototype.scrollIntoView = vi.fn();
  useAldoAssistant.setState({ entries: [], historyLoaded: true, replying: false });
  useAldoReceipts.setState({ receipts: [] });
  backend.tap.mockReset();
  backend.computer.mockReset().mockResolvedValue({});
  backend.refresh.mockReset().mockResolvedValue(undefined);
  backend.decide.mockReset().mockResolvedValue({ outcome: "done", said: "Sent" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("renders later user and Aldo messages below a plan, preserving its answers through Start and reload", async () => {
  message("Help me launch", 1);
  const read = home({ plans: [plan] });
  await act(async () => root.render(<Page home={read} />));
  const card = container.querySelector('[data-aldo-plan="plan-1"]')!;
  const option = [...card.querySelectorAll("button")].find((b) => b.textContent === "All pages")!;
  await act(async () => option.click());
  await act(async () => {
    message("Please include the pricing page", 4);
    message("I’ll include it", 5, "assistant");
  });
  expect(container.querySelector('[data-aldo-plan="plan-1"]')).toBe(card);
  expect(option.getAttribute("aria-pressed")).toBe("true");
  before(textElement("Help me launch"), card);
  before(card, textElement("Please include the pricing page"));
  before(textElement("Please include the pricing page"), textElement("I’ll include it"));
  const started = {
    ...plan,
    status: "started" as const,
    startedAt: at(6),
    startedBy: "user" as const,
    answers: { scope: "All pages" },
  };
  backend.tap.mockResolvedValue(started);
  const start = [...card.querySelectorAll("button")].find((b) =>
    b.textContent?.startsWith("Start ·"),
  )!;
  await act(async () => start.click());
  expect(backend.tap).toHaveBeenLastCalledWith("plan-1", {
    action: "start",
    answers: { scope: "All pages" },
  });
  await act(async () => root.render(<Page home={home({ plans: [started] })} />));
  expect(container.querySelector('[data-aldo-plan="plan-1"]')).toBe(card);
  before(card, textElement("Please include the pricing page"));
  await remount(home({ plans: [started] }));
  before(
    container.querySelector('[data-aldo-plan="plan-1"]')!,
    textElement("Please include the pricing page"),
  );
});

it.each(["email", "event", "start", "confirm"] as const)(
  "keeps a %s approval before later messages through revision and persisted outcome",
  async (kind) => {
    message("Prepare the update", 1);
    const a = approval(kind);
    await act(async () => root.render(<Page home={home({ approvals: [a] })} />));
    const card = container.querySelector('[data-aldo-decision="aldo:draft-1"]')!;
    await act(async () => {
      message("One more detail", 4);
      message("Got it", 5, "assistant");
    });
    before(card, textElement("One more detail"));
    const revised = {
      ...a,
      body: "The launch is ready for Monday.",
      revisedAt: at(6),
      previous: { title: a.title, body: a.body },
    };
    await act(async () => root.render(<Page home={home({ approvals: [revised] })} />));
    expect(container.querySelector('[data-aldo-decision="aldo:draft-1"]')).toBe(card);
    expect(card.textContent).toContain("Monday");
    before(card, textElement("One more detail"));
    const decided = { ...revised, status: "approved" as const, decidedAt: at(7), result: "Sent" };
    await act(async () => root.render(<Page home={home({ approvals: [decided] })} />));
    before(textElement("Launch update"), textElement("One more detail"));
    await remount(home({ approvals: [decided] }));
    before(textElement("Launch update"), textElement("One more detail"));
  },
);

it.each(["Send", "Discard"])("keeps an approval's %s receipt where its card was", async (label) => {
  message("Prepare the update", 1);
  message("Another thought", 4);
  await act(async () => root.render(<Page home={home({ approvals: [approval()] })} />));
  const card = container.querySelector('[data-aldo-decision="aldo:draft-1"]')!;
  const button = [...card.querySelectorAll("button")].find((b) => b.textContent === label)!;
  await act(async () => button.click());
  expect(backend.decide).toHaveBeenCalledWith(
    expect.objectContaining({ key: "aldo:draft-1" }),
    { kind: "aldo", decision: label === "Send" ? "approve" : "discard" },
    { quiet: true },
  );
  before(
    container.querySelector('[data-aldo-receipt="aldo:draft-1"]')!,
    textElement("Another thought"),
  );
});

it("answers a question in scrollback and leaves its receipt before later messages", async () => {
  message("Check the launch", 1);
  const thread = {
    ref: "launch",
    thread: { environmentId: "aldo-launch", threadId: "launch" },
    title: "Launch review",
    repos: [],
    branch: "",
    state: "waiting",
    machine: "running",
    at: at(2),
    stateAt: at(2),
    pending: {
      kind: "question" as const,
      requestId: "scope",
      questions: [
        {
          id: "scope",
          header: "Scope",
          question: "Include pricing?",
          multiSelect: false,
          options: [{ label: "Include pricing", description: "Review pricing too" }],
        },
      ],
    },
  };
  await act(async () => root.render(<Page home={home({ conversations: [thread] })} />));
  await act(async () => {
    message("How long will it take?", 3);
  });
  const card = container.querySelector('[data-aldo-decision="question:launch:scope"]')!;
  before(card, textElement("How long will it take?"));
  await act(async () =>
    [...card.querySelectorAll("button")]
      .find((b) => b.textContent?.startsWith("Include pricing"))!
      .click(),
  );
  expect(backend.decide).toHaveBeenCalledWith(
    expect.objectContaining({ key: "question:launch:scope" }),
    { kind: "answer", answers: { scope: "Include pricing" } },
    { quiet: true },
  );
  before(
    container.querySelector('[data-aldo-receipt="question:launch:scope"]')!,
    textElement("How long will it take?"),
  );
});

it("adds a newly arrived card after existing messages, including a card-only conversation", async () => {
  message("Check the launch", 1);
  message("I’ll make a plan", 2, "assistant");
  await act(async () => root.render(<Page home={home()} />));
  const latest = { ...plan, proposedAt: at(3) };
  await act(async () => root.render(<Page home={home({ plans: [latest] })} />));
  before(textElement("I’ll make a plan"), container.querySelector('[data-aldo-plan="plan-1"]')!);
  await act(async () => useAldoAssistant.setState({ entries: [] }));
  expect(container.querySelector('[data-aldo-plan="plan-1"]')).not.toBeNull();
});

it("lists the links a thread's result ends with under its words, and leaves Aldo's own replies as they are", async () => {
  const result = [
    "The checkout fix is live.",
    "",
    "Pull request: https://github.com/acme/shop/pull/7",
    "Thread: https://aldo.example/aldo-1/t1",
  ].join("\n");
  message(result, 1, "assistant");
  message("Docs: https://acme.example/docs", 2, "assistant");
  await act(async () => root.render(<Page home={home()} />));
  await vi.waitFor(() => expect(container.querySelector("[data-aldo-artifacts]")).not.toBeNull());
  const row = container.querySelector<HTMLAnchorElement>("[data-aldo-artifacts] a")!;
  expect(row.href).toBe("https://github.com/acme/shop/pull/7");
  expect(row.textContent).toBe("acme/shop #7Pull request");
  expect(textElement("The checkout fix is live.\nOpen the thread")).toBeDefined();
  expect(container.textContent).not.toContain("Pull request: https://");
  expect(textElement("Docs: https://acme.example/docs")).toBeDefined();
  expect(container.querySelectorAll("[data-aldo-artifacts]")).toHaveLength(1);
});

it("shows a saved approval outcome even when no messages are loaded", async () => {
  await act(async () =>
    root.render(
      <Page
        home={home({ approvals: [{ ...approval(), status: "approved", decidedAt: at(4) }] })}
      />,
    ),
  );
  expect(container.textContent).toContain("Sent");
  expect(container.textContent).toContain("Launch update");
  expect(container.textContent).not.toContain("What should we get done?");
});

const pill = () => container.querySelector<HTMLButtonElement>("[data-aldo-needs-you]")!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
async function frames() {
  await act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
  await frames();
}
it("shows no chip when everything was decided, hid, started, is counting down or is put off", async () => {
  const decided = ["one", "two", "three", "four", "five"].map((id) => ({
    ...approval(),
    id,
    status: "approved" as const,
    decidedAt: at(4),
  }));
  const hidden = { ...approval(), id: "hidden", chatDecision: { id: "hidden", dismissed: true } };
  const read = home({
    approvals: [...decided, hidden],
    plans: [
      { ...plan, id: "started", status: "started", startedAt: at(6), startedBy: "user" },
      { ...plan, id: "countdown", autoStartAt: at(25) },
      { ...plan, id: "later", deferredUntil: at(59) },
      { ...plan, id: "failed", error: "There's no Claude provider." },
    ],
    conversations: [
      {
        ref: "snoozed",
        thread: { environmentId: "aldo-thread", threadId: "snoozed" },
        title: "Snoozed",
        repos: [],
        branch: "",
        at: at(1),
        state: "waiting",
        machine: "running",
        snoozedUntil: at(59),
      },
    ],
  } as unknown as Partial<AldoHome>);
  // The countdown's clock is the browser's, not the test's: its card asks the server to start it.
  backend.tap.mockResolvedValue(null);
  await act(async () => root.render(<Page home={read} />));
  expect(pill()).toBeNull();
});
it("jumps to a single older plan in a partial timeline, including on a phone with tabs", async () => {
  message("A recent message", 15);
  await act(async () =>
    root.render(
      <AldoConversationPage
        home={home({ plans: [{ ...plan, proposedAt: "2026-10-01T12:00:00Z" }] })}
        supported
        error={null}
        now={Date.parse(at(20))}
        tabs={<nav>Home · Needs you</nav>}
        actions={null}
        welcome={null}
        issues={[]}
        chips={[]}
        onChip={vi.fn()}
      />,
    ),
  );
  expect(pill().textContent).toBe("One needs you");
  const card = container.querySelector<HTMLElement>('[data-aldo-plan="plan-1"]')!;
  before(card, textElement("A recent message"));
  const scroll = vi.spyOn(card, "scrollIntoView");
  await click(pill());
  expect(dialog()).toBeNull();
  expect(scroll).toHaveBeenLastCalledWith({ behavior: "auto", block: "center", inline: "nearest" });
  await vi.waitFor(() => expect(card.hasAttribute("data-aldo-attention")).toBe(true));
  expect(document.activeElement).toBe(card);
});
it("lists pending kinds and times, then closes and reveals the selected inline card", async () => {
  message("An unrelated later message", 15);
  await act(async () =>
    root.render(<Page home={home({ plans: [plan], approvals: [approval()] })} />),
  );
  expect(pill().textContent).toBe("Two need you");
  const card = container.querySelector<HTMLElement>('[data-aldo-decision="aldo:draft-1"]')!;
  const scroll = vi.spyOn(card, "scrollIntoView");
  await click(pill());
  expect(dialog()?.textContent).toContain("Prepare the launch");
  expect(dialog()?.textContent).toContain("Email draft");
  expect(dialog()?.querySelectorAll("time")).toHaveLength(2);
  await click(
    [...dialog()!.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Launch update"),
    )!,
  );
  await vi.waitFor(() => expect(dialog()).toBeNull());
  await frames();
  expect(scroll).toHaveBeenCalled();
  await vi.waitFor(() => expect(card.hasAttribute("data-aldo-attention")).toBe(true));
  expect(document.activeElement).toBe(card);
});
it("closes the picker with its X or Escape without moving the conversation", async () => {
  await act(async () =>
    root.render(<Page home={home({ approvals: [approval(), { ...approval(), id: "second" }] })} />),
  );
  await click(pill());
  await click(dialog()!.querySelector<HTMLButtonElement>('[aria-label="Close needs you"]')!);
  await vi.waitFor(() => expect(dialog()).toBeNull());
  await click(pill());
  await act(async () =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await vi.waitFor(() => expect(dialog()).toBeNull());
});
it("updates the open list live and returns to single-item behavior when only one remains", async () => {
  const a = approval();
  const b = { ...approval(), id: "second", title: "Calendar review", kind: "event" as const };
  await act(async () => root.render(<Page home={home({ plans: [plan], approvals: [a, b] })} />));
  await click(pill());
  expect(dialog()!.querySelectorAll("li")).toHaveLength(3);
  await act(async () =>
    root.render(
      <Page home={home({ plans: [plan], approvals: [{ ...a, status: "approved" }, b] })} />,
    ),
  );
  expect(pill().textContent).toBe("Two need you");
  expect(dialog()!.querySelectorAll("li")).toHaveLength(2);
  expect(dialog()!.textContent).not.toContain("Launch update");
  await act(async () =>
    root.render(
      <Page
        home={home({
          plans: [plan],
          approvals: [
            { ...a, status: "approved" },
            { ...b, status: "discarded" },
          ],
        })}
      />,
    ),
  );
  await vi.waitFor(() => expect(dialog()).toBeNull());
  expect(pill().textContent).toBe("One needs you");
  await click(pill());
  expect(dialog()).toBeNull();
  await act(async () => root.render(<Page home={home()} />));
  expect(pill()).toBeNull();
});

it("keeps a missing target in place and gives feedback instead of scrolling to the end", async () => {
  message("A recent message", 15);
  await act(async () => root.render(<Page home={home({ plans: [plan] })} />));
  const card = container.querySelector<HTMLElement>('[data-aldo-plan="plan-1"]')!;
  card.removeAttribute("data-aldo-plan");
  vi.mocked(Element.prototype.scrollIntoView).mockClear();
  const notice = vi.spyOn(toastManager, "add").mockReturnValue("missing");
  const scroll = vi.spyOn(card, "scrollIntoView");
  await click(pill());
  await act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await vi.waitFor(() =>
    expect(notice).toHaveBeenCalledWith(
      expect.objectContaining({ title: "That request is no longer in this conversation" }),
    ),
  );
  expect(backend.refresh).toHaveBeenCalled();
  expect(scroll).not.toHaveBeenCalled();
});

it("uses smooth navigation when reduced motion is off", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  message("A recent message", 15);
  await act(async () => root.render(<Page home={home({ plans: [plan] })} />));
  const card = container.querySelector<HTMLElement>('[data-aldo-plan="plan-1"]')!;
  const scroll = vi.spyOn(card, "scrollIntoView");
  await click(pill());
  expect(scroll).toHaveBeenLastCalledWith({
    behavior: "smooth",
    block: "center",
    inline: "nearest",
  });
});

it.each(["Start it", "Not now"])(
  "shows a computer request once and removes it after %s while Home catches up",
  async (label) => {
    const read = home({
      conversations: [
        {
          ref: "render",
          thread: { environmentId: "aldo-render", threadId: "render" },
          title: "Launch video",
          repos: [],
          branch: "",
          state: "waiting",
          machine: "running",
          at: at(2),
          computers: [
            {
              computer: "gpu",
              status: "asked",
              creditsPerHour: 310,
              askedAt: at(2),
              why: "Render the video",
            },
          ],
        },
      ],
    });
    message("Please keep the captions readable", 3);
    await act(async () => root.render(<Page home={read} />));
    expect(pill().textContent).toBe("One needs you");
    const card = container.querySelector<HTMLElement>("[data-aldo-computer-request]")!;
    before(card, textElement("Please keep the captions readable"));
    expect(card.textContent).toContain("310 credits an hour");
    expect(container.querySelector('[data-aldo-decision^="waiting:"]')).toBeNull();
    await click([...card.querySelectorAll("button")].find((b) => b.textContent === label)!);
    expect(backend.computer).toHaveBeenCalledWith("aldo-render", label === "Start it", "gpu");
    expect(pill()).toBeNull();
    expect(container.querySelector("[data-aldo-computer-request]")).toBeNull();
  },
);

it("shows a call as its card where it began, and keeps its lines and actions off the conversation", async () => {
  message("Morning", 1);
  await act(async () => {
    useAldoAssistant.setState((s) => ({
      entries: [
        ...s.entries,
        {
          kind: "call",
          id: "as_1",
          at: at(2),
          state: "summarizing",
          seconds: 190,
          summary: null,
          links: [],
        },
        { kind: "message", role: "user", text: "Move the dentist", at: at(2), call: "as_1" },
        { kind: "message", role: "assistant", text: "Checking.", at: at(3), call: "as_1" },
        {
          kind: "action",
          id: "a1",
          tool: "start_thread",
          label: "Started a thread",
          failed: false,
          call: "as_1",
        },
      ],
    }));
  });
  message("Thanks, and remind me Wednesday", 9);
  await act(async () => root.render(<Page home={home()} />));
  const card = container.querySelector('[data-aldo-call="as_1"]')!;
  expect(card.textContent).toContain("Summarizing…");
  expect(container.textContent).not.toContain("Move the dentist");
  expect(container.textContent).not.toContain("Checking.");
  expect(container.textContent).not.toContain("Started a thread");
  before(textElement("Morning"), card);
  before(card, textElement("Thanks, and remind me Wednesday"));
});
