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
  home: null as import("./homeApi").AldoHome | null,
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
vi.mock("./AldoLiveCard", () => ({
  AldoOpenContext: createContext(null),
  AldoThreadCard: ({ target }: { target: { environmentId: string; threadId: string } }) => (
    <div data-test-live={`${target.environmentId}/${target.threadId}`}>Live work</div>
  ),
}));
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
  useAldoHomeFeed: (select: (s: { home: AldoHome | null }) => unknown) =>
    select({ home: backend.home }),
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
    upcoming: [],
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
  backend.home = null;
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
    // Start/confirm controls load on demand; the timeline's card stays put
    // while that chunk arrives and then shows the latest revision.
    await vi.waitFor(() => expect(card.textContent).toContain("Monday"));
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
    startedAt: at(1),
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
  expect(container.querySelectorAll("[data-aldo-live-card]")).toHaveLength(0);
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
  await act(async () => {
    root.render(<Page home={home()} />);
    await import("./AldoArtifacts");
  });
  const card = container.querySelector("[data-aldo-update]")!;
  const row = card.querySelector<HTMLAnchorElement>("details a")!;
  expect(row.href).toBe("https://github.com/acme/shop/pull/7");
  expect(card.querySelector("details")?.open).toBe(false);
  expect(card.querySelector("p")?.textContent).toBe("The checkout fix is live.");
  expect(container.textContent).not.toContain("Pull request: https://");
  expect(container.querySelector("p a[href='https://acme.example/docs']")?.textContent).toBe(
    "acme.example",
  );
  expect(container.querySelectorAll("[data-aldo-artifacts]")).toHaveLength(0);
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

it("keeps structured HTTPS, HTTP and relative deliverables without repeating a shown file", async () => {
  const share = "/s/abcdefghijklmnop";
  useAldoAssistant.setState({
    entries: [
      {
        kind: "message",
        role: "assistant",
        at: at(1),
        text: "I’ve prepared the draft.",
        update: {
          id: "draft",
          title: "Launch",
          thread: { environmentId: "aldo-1", threadId: "t1" },
          state: "update",
          summary: "I’ve prepared the draft.",
          checked: [],
          notChecked: [],
          links: [
            { label: "Website", url: "https://example.com/result" },
            { label: "Local preview", url: "http://localhost:3000" },
            { label: "Review evidence", url: "/admin/reliability" },
            { label: "Shared file", url: share },
          ],
        },
        artifacts: [
          { kind: "file", url: share, title: "Saved draft", contentType: "application/pdf" },
        ],
      },
    ],
  });
  await act(async () => {
    root.render(<Page home={home()} />);
    await import("./AldoArtifacts");
  });
  for (const [label, href] of [
    ["Website", "https://example.com/result"],
    ["Local preview", "http://localhost:3000"],
    ["Review evidence", "/admin/reliability"],
  ]) {
    expect(
      [...container.querySelectorAll("a")]
        .find((a) => a.textContent?.includes(label!))
        ?.getAttribute("href"),
    ).toBe(href);
  }
  expect(container.textContent).toContain("Saved draft");
  expect(container.textContent).not.toContain("Shared file");
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
  expect(pill().textContent).toBe("Review 1 request");
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
  expect(pill().textContent).toBe("Review 2 requests");
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
  expect(pill().textContent).toBe("Review 2 requests");
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
  expect(pill().textContent).toBe("Review 1 request");
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

it.each(["Start · 310 credits/hour", "Decline"])(
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
    expect(pill().textContent).toBe("Review 1 request");
    const card = container.querySelector<HTMLElement>("[data-aldo-computer-request]")!;
    before(card, textElement("Please keep the captions readable"));
    expect(card.textContent).toContain("310 credits an hour");
    expect(container.querySelector('[data-aldo-decision^="waiting:"]')).toBeNull();
    await click([...card.querySelectorAll("button")].find((b) => b.textContent === label)!);
    expect(backend.computer).toHaveBeenCalledWith(
      "aldo-render",
      label === "Start · 310 credits/hour",
      "gpu",
    );
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

it("offers the request shortcut only while the actionable card is outside the conversation viewport", async () => {
  let report: IntersectionObserverCallback | undefined;
  let observed: Element | undefined;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        report = callback;
      }
      observe(node: Element) {
        observed = node;
      }
      disconnect() {}
    },
  );
  message("A later message", 15);
  await act(async () => root.render(<Page home={home({ plans: [plan] })} />));
  expect(pill().textContent).toBe("Review 1 request");
  expect(observed).toBe(container.querySelector('[data-aldo-plan="plan-1"]'));
  await act(async () =>
    report!(
      [{ target: observed!, intersectionRatio: 1 } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  expect(container.querySelector("[data-aldo-needs-you]")).toBeNull();
  await act(async () =>
    report!(
      [{ target: observed!, intersectionRatio: 0 } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  expect(pill().textContent).toBe("Review 1 request");
});

it("keeps an automated ask from duplicating its action card or reviving it after an answer", async () => {
  const read = home();
  backend.home = {
    ...read,
    conversations: [
      {
        ref: "ask",
        thread: { environmentId: "aldo-1", threadId: "t1" },
        title: "Choose the layout",
        repos: [],
        branch: "",
        machine: "asleep",
        state: "waiting",
        at: at(1),
      },
    ],
  };
  useAldoAssistant.setState({
    entries: [
      {
        kind: "message",
        role: "assistant",
        at: at(2),
        text: "I need your answer before I can continue.\n\nThread: https://aldo.example/aldo-1/t1",
        update: {
          id: "ask",
          thread: { environmentId: "aldo-1", threadId: "t1" },
          title: "Choose the layout",
          state: "needs-you",
          summary: "I need your answer before I can continue.",
          checked: [],
          notChecked: [],
          links: [],
        },
      },
    ],
  });
  await act(async () => root.render(<Page home={read} />));
  expect(container.querySelector("[data-aldo-update]")).toBeNull();
  backend.home = {
    ...backend.home,
    conversations: backend.home!.conversations.map((c) => ({ ...c, state: "working" })),
  };
  await act(async () => root.render(<Page home={read} />));
  expect(container.querySelector("[data-aldo-update]")).toBeNull();
});
it("shows a multi-paragraph Home answer as one reply", async () => {
  const text = "I’ve prepared the draft.\n\nYour source notes are included.";
  message(text, 1, "assistant");
  await act(async () => root.render(<Page home={home()} />));
  expect([...container.querySelectorAll("p")].filter((p) => p.textContent === text)).toHaveLength(
    1,
  );
  expect(container.textContent).not.toContain("Checks reported");
});

it("keeps the live work card after an ordinary reply links to work started elsewhere", async () => {
  const read = home({
    conversations: [
      {
        ref: "work",
        thread: { environmentId: "aldo-demo", threadId: "work" },
        title: "Prepare the guide",
        repos: [],
        branch: "",
        state: "working",
        machine: "running",
        startedAt: at(2),
        stateAt: at(3),
        at: at(3),
      },
    ],
  });
  backend.home = read;
  message("Prepare the guide", 1);
  await act(async () => root.render(<Page home={read} />));
  expect(container.querySelectorAll('[data-test-live="aldo-demo/work"]')).toHaveLength(1);
  await act(async () => {
    message("Here is the thread: https://aldo.computer/aldo-demo/work", 4, "assistant");
  });
  expect(container.querySelector("[data-aldo-update]")).toBeNull();
  expect(container.querySelectorAll('[data-test-live="aldo-demo/work"]')).toHaveLength(1);
});

it.each(["checks-running", "deploying"] as const)(
  "keeps %s progress when an ordinary reply only links to the completed thread",
  async (stage) => {
    const target = { environmentId: "aldo-demo", threadId: "work" };
    const read = home({
      conversations: [
        {
          ref: "work",
          thread: target,
          title: "Prepare the guide",
          repos: [],
          branch: "",
          state: "done",
          machine: "asleep",
          at: at(2),
        },
      ],
      pullRequests: [
        {
          environmentId: target.environmentId,
          thread: target,
          threadTitle: "Prepare the guide",
          repo: "acme/guide",
          number: 7,
          url: "https://github.com/acme/guide/pull/7",
          title: "Prepare the guide",
          status: "watching",
          stage,
          checks: { passed: 1, failed: 0, running: 1 },
          deploy: null,
          followups: 0,
          reviewsExhausted: false,
          greenSince: null,
          mergesAt: null,
          mergedAt: null,
          updatedAt: at(3),
        },
      ],
    });
    backend.home = read;
    message("Prepare the guide", 1);
    message("Here is the thread: https://aldo.computer/aldo-demo/work", 3, "assistant");
    await act(async () => root.render(<Page home={read} />));
    expect(container.querySelector("[data-aldo-update]")).toBeNull();
    expect(container.querySelector("[data-aldo-finished]")?.textContent).toContain(
      "I’m checking the update before it goes live.",
    );

    // A structured result needs no raw thread URL. It owns the replacement status.
    await act(async () => {
      useAldoAssistant.setState((s) => ({
        entries: [
          s.entries[0]!,
          {
            kind: "message",
            role: "assistant",
            at: at(3),
            text: "I’ve prepared the guide.",
            update: {
              id: "guide-result",
              title: "Prepare the guide",
              thread: target,
              state: "done",
              summary: "I’ve prepared the guide.",
              checked: [],
              notChecked: [],
              links: [],
            },
          },
        ],
      }));
    });
    expect(container.querySelector("[data-aldo-finished]")).toBeNull();
    const details = container.querySelector('[data-aldo-update="guide-result"] details')!;
    expect(container.textContent).not.toContain("Checks 1 of 2");
    expect(details.textContent).toContain("Current status");
    expect(details.textContent).toContain("I’m checking the update before it goes live.");

    // The explicit older result envelope supplies the same replacement, without metadata.
    await act(async () => {
      useAldoAssistant.setState((s) => ({ entries: [s.entries[0]!] }));
      message(
        "I’ve prepared the guide.\n\nThread: https://aldo.computer/aldo-demo/work",
        3,
        "assistant",
      );
    });
    expect(container.querySelector("[data-aldo-finished]")).toBeNull();
    expect(container.querySelector("[data-aldo-update] details")?.textContent).toContain(
      "I’m checking the update before it goes live.",
    );
  },
);

it("retains a snoozed failure report when no replacement decision card is rendered", async () => {
  const target = { environmentId: "aldo-1", threadId: "t1" };
  const failed = {
    ref: "failed",
    title: "Prepare the guide",
    repos: [],
    branch: "",
    machine: "asleep",
    state: "failed",
    at: at(1),
    thread: target,
    snoozedUntil: new Date(Date.now() + 3600000).toISOString(),
  } as const;
  const read = home({ conversations: [failed] });
  backend.home = read;
  useAldoAssistant.setState({
    entries: [
      {
        kind: "message",
        role: "assistant",
        at: at(2),
        text: "I couldn’t finish this attempt.",
        update: {
          id: "failure",
          thread: target,
          title: failed.title,
          state: "failed",
          summary: "I couldn’t finish this attempt.",
          checked: [],
          notChecked: [],
          links: [],
        },
      },
    ],
  });
  await act(async () => root.render(<Page home={read} />));
  expect(container.querySelector('[data-aldo-decision^="failed:"]')).toBeNull();
  expect(container.querySelector('[data-aldo-update="failure"]')).not.toBeNull();
});

it("keeps inline legacy report destinations clickable inside Details", async () => {
  message(
    "Read the guide at https://example.com/guide.\n\nThread: https://aldo.computer/aldo-demo/work",
    1,
    "assistant",
  );
  await act(async () => root.render(<Page home={home()} />));
  const details = container.querySelector("details")!;
  expect(details.open).toBe(false);
  expect(details.querySelector("a")?.getAttribute("href")).toBe("https://example.com/guide");
  expect(details.querySelector("a")?.textContent).toBe("example.com");
});

it("keeps earlier failure attempts while the current report is represented by Retry", async () => {
  const target = { environmentId: "aldo-1", threadId: "t1" };
  const failed = {
    ref: "failed",
    title: "Prepare the guide",
    repos: [],
    branch: "",
    machine: "asleep",
    state: "failed",
    at: at(1),
    stateAt: at(4),
    thread: target,
  } as const;
  const read = home({ conversations: [failed] });
  backend.home = read;
  useAldoAssistant.setState({
    entries: [1, 5].map((minute) => ({
      kind: "message" as const,
      role: "assistant" as const,
      at: at(minute),
      text: `Attempt ${minute} could not finish.`,
      update: {
        id: `failure-${minute}`,
        thread: target,
        title: failed.title,
        state: "failed" as const,
        summary: `I couldn’t finish attempt ${minute}.`,
        checked: [],
        notChecked: [],
        links: [],
      },
    })),
  });
  await act(async () => root.render(<Page home={read} />));
  expect(container.querySelector('[data-aldo-decision^="failed:"]')).not.toBeNull();
  expect(container.querySelector('[data-aldo-update="failure-1"]')).not.toBeNull();
  expect(container.querySelector('[data-aldo-update="failure-5"]')).toBeNull();
  expect(container.textContent).toContain("I couldn’t finish attempt 1.");
  expect(container.textContent).toContain("I couldn’t finish attempt 5.");
});

it("keeps needs-you update evidence under the question instead of duplicating its summary", async () => {
  const target = { environmentId: "aldo-1", threadId: "t1" };
  const c = {
    ref: "ask",
    title: "Prepare the guide",
    repos: [],
    branch: "",
    machine: "asleep",
    state: "waiting",
    at: at(1),
    thread: target,
    pending: {
      kind: "question",
      requestId: "ask:turn",
      questions: [
        {
          id: "scope",
          header: "",
          question: "Which pages should I include?",
          options: [
            { label: "Home (Recommended)", description: "" },
            { label: "All pages", description: "" },
          ],
          multiSelect: false,
        },
      ],
    },
  } as const;
  const read = home({ conversations: [c] });
  backend.home = read;
  useAldoAssistant.setState({
    entries: [
      {
        kind: "message",
        role: "assistant",
        at: at(2),
        text: "I need your answer.",
        update: {
          id: "asked-report",
          thread: target,
          title: c.title,
          state: "needs-you",
          summary: "I need your answer.",
          checked: ["Saved the source notes."],
          notChecked: ["The full comparison."],
          notes: ["The internal comparison is incomplete."],
          links: [{ label: "Change evidence", url: "https://github.com/acme/guide/pull/7" }],
        },
      },
    ],
  });
  await act(async () => root.render(<Page home={read} />));
  expect(container.querySelector('[data-aldo-update="asked-report"]')).toBeNull();
  const card = container.querySelector('[data-aldo-decision^="question:"]')!;
  expect(card.textContent).toContain("Which pages should I include?");
  expect(card.textContent).not.toContain("I need your answer.");
  const details = card.querySelector("details")!;
  expect(details.open).toBe(false);
  expect(details.textContent).toContain("Saved the source notes.");
  expect(details.textContent).toContain("The internal comparison is incomplete.");
  expect(details.querySelector("a")?.getAttribute("href")).toBe(
    "https://github.com/acme/guide/pull/7",
  );
  expect(card.textContent).toContain("Open the thread");
});

it("keeps a legacy failure's original notes and links in its single Retry card", async () => {
  const target = { environmentId: "aldo-1", threadId: "t1" };
  const c = {
    ref: "failed",
    title: "Prepare the guide",
    repos: [],
    branch: "",
    machine: "asleep",
    state: "failed",
    at: at(1),
    thread: target,
  } as const;
  const read = home({ conversations: [c] });
  backend.home = read;
  message(
    "I ran into trouble with the guide. CI failed.\n\n[Change evidence](https://github.com/acme/guide/pull/7)\n\nChecks reported with the task:\n\nChecked:\nSaved the source notes.\n\nNot checked:\nThe full comparison.\nThread: https://aldo.example/aldo-1/t1",
    2,
    "assistant",
  );
  await act(async () => root.render(<Page home={read} />));
  expect(container.querySelector("[data-aldo-update]")).toBeNull();
  const card = container.querySelector('[data-aldo-decision^="failed:"]')!;
  const details = card.querySelector("details")!;
  expect(details.textContent).toContain("CI failed.");
  expect(details.textContent).toContain("Saved the source notes.");
  expect(details.textContent).toContain("The full comparison.");
  expect(details.querySelector("a")?.getAttribute("href")).toBe(
    "https://github.com/acme/guide/pull/7",
  );
});

it.each(["native", "turn-ask", "fallback"] as const)(
  "dedupes %s by conversation, restores snoozed waits and shows the new working turn",
  async (kind) => {
    const target = { environmentId: "aldo-1", threadId: "t1" };
    const pending =
      kind === "fallback"
        ? undefined
        : {
            kind: "question" as const,
            requestId: kind === "turn-ask" ? "ask:turn-1" : "native-question",
            questions: [
              {
                id: "scope",
                header: "",
                question: "Which pages?",
                multiSelect: false,
                options: [
                  { label: "Home", description: "" },
                  { label: "All pages", description: "" },
                ],
              },
            ],
          };
    const c = {
      ref: "work",
      title: "Prepare the guide",
      repos: [],
      branch: "",
      machine: "asleep",
      state: "waiting" as const,
      at: at(2),
      thread: target,
      ...(pending ? { pending } : {}),
    };
    const render = async (conversation: typeof c) => {
      const read = home({ conversations: [conversation] });
      backend.home = read;
      await act(async () => root.render(<Page home={read} />));
    };
    useAldoAssistant.setState({
      entries: [
        {
          kind: "action",
          id: "start-work",
          tool: "start_thread",
          label: "Started work",
          failed: false,
          open: target,
        },
      ],
    });
    await render(c);
    expect(container.querySelectorAll("[data-aldo-decision]")).toHaveLength(1);
    expect(container.querySelector("[data-test-live]")).toBeNull();
    await render({ ...c, snoozedUntil: at(50) } as typeof c);
    expect(container.querySelectorAll("[data-aldo-decision]")).toHaveLength(
      kind === "native" ? 1 : 0,
    );
    expect(container.querySelectorAll("[data-test-live]")).toHaveLength(kind === "native" ? 0 : 1);
    await render({
      ...c,
      state: "working",
      machine: "running",
      pending: undefined,
    } as unknown as typeof c);
    expect(container.querySelector("[data-aldo-decision]")).toBeNull();
    expect(container.querySelectorAll("[data-test-live]")).toHaveLength(1);
  },
);

it("restores the live card once an answer receipt replaces the decision, before Home refreshes", async () => {
  const target = { environmentId: "aldo-1", threadId: "t1" };
  const c = {
    ref: "work",
    title: "Prepare the guide",
    repos: [],
    branch: "",
    machine: "asleep",
    state: "waiting",
    at: at(2),
    thread: target,
  };
  const read = home({ conversations: [c] });
  backend.home = read;
  useAldoAssistant.setState({
    entries: [
      {
        kind: "action",
        id: "start-work",
        tool: "start_thread",
        label: "Started work",
        failed: false,
        open: target,
      },
    ],
  });
  await act(async () => root.render(<Page home={read} />));
  const key = container.querySelector("[data-aldo-decision]")!.getAttribute("data-aldo-decision")!;
  await act(async () =>
    useAldoReceipts.setState({
      receipts: [{ key, at: at(3), text: "You answered", thread: target }],
    }),
  );
  expect(container.querySelector("[data-aldo-decision]")).toBeNull();
  expect(container.querySelectorAll("[data-test-live]")).toHaveLength(1);
});
