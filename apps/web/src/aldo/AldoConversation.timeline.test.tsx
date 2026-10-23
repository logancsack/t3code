// @vitest-environment jsdom

import { act, createContext, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { AldoConversationPage } from "./AldoConversationPage";
import { useAldoAssistant } from "./assistantSession";
import type { AldoApproval, AldoHome } from "./homeApi";
import { parseAldoPlan } from "./plans.logic";
import { useAldoReceipts } from "./receipts";

const backend = vi.hoisted(() => ({ tap: vi.fn(), decide: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: vi.fn, useRouter: vi.fn }));
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
vi.mock("./AldoPresence", () => ({ AldoPresence: () => null, AldoAvatar: () => null }));
vi.mock("./AldoHomeInbox", () => ({
  ThreadLink: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  PendingForm: () => null,
}));
vi.mock("./AldoBrief", () => ({ DecisionIcon: () => null, confirmQuickChoice: async () => true }));
vi.mock("./face", () => ({ blinkAldo: vi.fn(), pleaseAldo: vi.fn(), setAldoReading: vi.fn() }));
vi.mock("./morph", () => ({
  aldoGlide: vi.fn(),
  aldoMorphSource: vi.fn(),
  morphIntoThread: vi.fn(),
  aldoCanMorph: () => false,
  aldoMorph: (update: () => void) => update(),
}));
vi.mock("./homeFeed", () => ({
  refreshAldoHome: async () => {},
  useAldoHomeFeed: (select: (s: { home: null }) => unknown) => select({ home: null }),
}));
vi.mock("./briefFeed", () => ({
  useAldoBrief: (select: (s: { brief: null }) => unknown) => select({ brief: null }),
}));
vi.mock("./firstView", () => ({ useAldoFirstViewHold: vi.fn() }));
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
