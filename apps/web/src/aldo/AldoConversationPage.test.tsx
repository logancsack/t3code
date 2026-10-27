// @vitest-environment jsdom
vi.mock("./AldoFrame", () => ({ AldoFrame: () => null }));

import { act, createContext, useLayoutEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { AldoConversationPage } from "./AldoConversationPage";
import { useAldoAssistant } from "./assistantSession";
import type { AldoFeedEvent } from "./feed.logic";
import type { AldoApproval, AldoHome } from "./homeApi";

vi.mock("@tanstack/react-router", () => ({ useNavigate: vi.fn, useRouter: vi.fn }));
vi.mock("../components/ui/sidebar", () => ({
  SidebarInset: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("./assistantSession", async () => {
  const { create } = await import("zustand");
  return {
    useAldoAssistant: create(() => ({ entries: [], historyLoaded: false, replying: false })),
    loadAldoConversation: vi.fn(async () => {}),
    seedAldoComposer: vi.fn(),
  };
});
vi.mock("./AldoAssistant", () => ({
  AldoAtAGlance: () => null,
  AldoCaption: () => null,
  AldoComposer: () => <textarea aria-label="Message Aldo" />,
  AldoConversation: ({
    feed,
    tail,
    renderDecisions,
  }: {
    feed: ReadonlyArray<AldoFeedEvent>;
    tail?: ReactNode;
    renderDecisions?: (keys: null, placedAt: ReadonlyMap<string, string>) => ReactNode;
  }) => {
    const entries = useAldoAssistant((s) => s.entries);
    return (
      <div>
        {feed.map((event) => (
          <p key={event.key}>Activity: {event.kind}</p>
        ))}
        {entries.map((e) => (
          <p key={e.kind === "message" ? e.at : e.id}>
            {e.kind === "message" ? e.text : e.kind === "action" ? e.label : "Call"}
          </p>
        ))}
        {tail}
        {renderDecisions?.(null, new Map())}
      </div>
    );
  },
}));
vi.mock("./AldoHomeBoard", () => ({ HealthStrip: () => <div>Setup failed to build</div> }));
vi.mock("./AldoLiveCard", () => ({ AldoOpenContext: createContext(null) }));
vi.mock("./AldoPresence", () => ({ AldoPresence: () => null }));
vi.mock("./AldoUpNext", () => ({ AldoUpNext: () => <div>Working thread</div> }));
vi.mock("./arrive", () => ({ settleAldoConversation: vi.fn(), unsettleAldoConversation: vi.fn() }));
vi.mock("./presenceReactions", () => ({ acknowledgeAldo: vi.fn() }));
vi.mock("./morph", () => ({
  aldoGlide: vi.fn(),
  aldoMorphSource: vi.fn(),
  morphIntoThread: vi.fn(),
}));
vi.mock("./homeFeed", () => ({
  refreshAldoHome: vi.fn(),
  useAldoHomeReadAt: (select: (s: { at: number }) => unknown) => select({ at: 0 }),
}));
vi.mock("./firstView", () => ({ useAldoFirstViewHold: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
let resized: () => void;
let beforePaint: number[];

function Page({ home = null, error = null }: { home?: AldoHome | null; error?: string | null }) {
  // Parent layout effects run after the child's, before passive effects and paint.
  useLayoutEffect(() => {
    beforePaint.push(container.querySelector<HTMLDivElement>(".overflow-y-auto")!.scrollTop);
  });
  return (
    <AldoConversationPage
      home={home}
      supported={true}
      error={error}
      now={Date.parse("2026-10-19T12:00:00Z")}
      tabs={null}
      actions={null}
      welcome={null}
      issues={[]}
      chips={[]}
      onChip={vi.fn()}
    />
  );
}

function history() {
  useAldoAssistant.setState({
    historyLoaded: true,
    entries: [
      { kind: "message", role: "user", text: "Older message", at: "2026-10-17T12:00:00Z" },
      { kind: "message", role: "assistant", text: "Latest reply", at: "2026-10-19T12:00:00Z" },
    ],
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  // jsdom has no layout. An overflowing conversation models the phone viewport;
  // the observer deliberately does not fire on mount.
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(1800);
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(600);
  useAldoAssistant.setState({ entries: [], historyLoaded: false, replying: false });
  beforePaint = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps setup and activity out of the loading viewport, with the composer ready", async () => {
  await act(async () => root.render(<Page />));
  expect(container.textContent).toContain("Loading conversation");
  expect(container.textContent).not.toContain("Setup failed");
  expect(container.textContent).not.toContain("Working thread");
  const composer = container.querySelector("textarea")!;
  composer.focus();
  composer.value = "A draft while history loads";

  await act(async () => {
    history();
    root.render(<Page />);
  });
  expect(container.textContent).toContain("Latest reply");
  expect(container.textContent).toContain("Setup failed");
  expect(beforePaint.at(-1)).toBe(1800);
  expect(container.querySelector("textarea")).toBe(composer);
  expect(document.activeElement).toBe(composer);
  expect(composer.value).toBe("A draft while history loads");
});

it("positions cached history before paint without waiting for a resize", async () => {
  history();
  await act(async () => root.render(<Page />));
  expect(beforePaint).toEqual([1800]);
  expect(container.textContent).not.toContain("Loading conversation");
});

it("follows resizing at the end and preserves the position after the user scrolls up", async () => {
  history();
  await act(async () => root.render(<Page />));
  const scroller = container.querySelector<HTMLDivElement>(".overflow-y-auto")!;
  scroller.scrollTop = 1200;
  scroller.dispatchEvent(new Event("scroll"));
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(2000);
  await act(async () => resized());
  expect(scroller.scrollTop).toBe(2000);

  scroller.scrollTop = 300;
  scroller.dispatchEvent(new Event("scroll"));
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(2200);
  await act(async () => resized());
  expect(scroller.scrollTop).toBe(300);
  expect(container.textContent).toContain("New from Aldo");
});

it("keeps the draft and reading position as pending actions change beside the latest action", async () => {
  history();
  const home = {
    conversations: [],
    pullRequests: [],
    actions: [],
    approvals: [],
  } as unknown as AldoHome;
  await act(async () => root.render(<Page home={home} />));
  const composer = container.querySelector("textarea")!;
  composer.value = "Keep this draft";
  composer.focus();
  const scroller = container.querySelector<HTMLDivElement>(".overflow-y-auto")!;
  scroller.scrollTop = 300;
  scroller.dispatchEvent(new Event("scroll"));
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(2200);
  await act(async () => resized());

  const approval: AldoApproval = {
    id: "review",
    kind: "confirm",
    status: "pending",
    title: "Review the proposal",
    createdAt: "2026-10-19T12:00:00Z",
    provider: null,
    summary: "Ready for review",
    fields: [],
    body: "The phone layout is ready",
    approveLabel: "Approve",
    discardLabel: "Discard",
    result: null,
    failed: false,
    thread: null,
    threadTitle: null,
    decidedAt: null,
  };
  await act(async () => root.render(<Page home={{ ...home, approvals: [approval] }} />));
  expect(container.querySelector("[data-aldo-needs-you]")?.textContent).toBe("One needs you");
  await act(async () => root.render(<Page home={home} />));
  expect(container.querySelector("[data-aldo-needs-you]")).toBeNull();
  expect(scroller.scrollTop).toBe(300);
  expect(container.querySelector("textarea")).toBe(composer);
  expect(composer.value).toBe("Keep this draft");
  expect(document.activeElement).toBe(composer);

  scroller.scrollTo = vi.fn();
  const latest = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "New from Aldo",
  )!;
  await act(async () => latest.click());
  expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 2200, behavior: "auto" });
});

it("never scrolls sideways: the scroller clips, and the column wraps what has no break in it", async () => {
  history();
  await act(async () => root.render(<Page />));
  const scroller = container.querySelector<HTMLDivElement>(".overflow-y-auto")!;
  expect(scroller.classList).toContain("overflow-x-hidden");
  const column = scroller.firstElementChild!;
  expect(column.classList).toContain("min-w-0");
  expect(column.classList).toContain("wrap-anywhere");

  // The empty page's scroller too.
  await act(async () => root.unmount());
  root = createRoot(container);
  useAldoAssistant.setState({ entries: [], historyLoaded: true });
  await act(async () => root.render(<Page />));
  expect(container.querySelector(".overflow-y-auto")!.classList).toContain("overflow-x-hidden");
});

it("still opens an empty conversation at the welcome", async () => {
  useAldoAssistant.setState({ historyLoaded: true });
  await act(async () => root.render(<Page />));
  expect(beforePaint).toEqual([0]);
  expect(container.textContent).toContain("What should we get done?");
});

it("reveals home content after eight seconds without pretending history is loaded", async () => {
  vi.useFakeTimers();
  const home = {
    conversations: [],
    pullRequests: [],
    actions: [
      {
        id: "start",
        tool: "start_thread",
        title: "Check the fix",
        asked: "Check the fix",
        failed: false,
        error: null,
        thread: null,
        at: "2026-10-19T11:00:00Z",
      },
    ],
  } as unknown as AldoHome;
  await act(async () => root.render(<Page home={home} />));
  const composer = container.querySelector("textarea")!;
  await act(async () => vi.advanceTimersByTime(7_999));
  expect(container.textContent).toContain("Loading conversation");
  expect(container.textContent).not.toContain("Setup failed");

  await act(async () => vi.advanceTimersByTime(1));
  expect(container.textContent).not.toContain("Loading conversation");
  expect(container.textContent).toContain("Earlier messages are taking longer to load");
  expect(container.textContent).toContain("Setup failed");
  expect(container.textContent).toContain("Activity: action");
  expect(container.textContent).toContain("Working thread");
  expect(container.querySelector('[aria-busy="false"]')).not.toBeNull();
  expect(useAldoAssistant.getState().historyLoaded).toBe(false);
  expect(container.querySelector("textarea")).toBe(composer);

  // The original history read can still complete after the fallback is shown.
  await act(async () => history());
  expect(container.textContent).toContain("Latest reply");
  expect(container.textContent).not.toContain("Earlier messages are taking longer");
  expect(container.querySelector("textarea")).toBe(composer);
});

it("keeps a failed home read accessible when history stalls", async () => {
  vi.useFakeTimers();
  await act(async () => root.render(<Page error="Connection unavailable" />));
  await act(async () => vi.advanceTimersByTime(8_000));
  expect(container.textContent).toContain("Couldn't check on your agents");
  expect(container.textContent).toContain("Connection unavailable");
  expect(container.textContent).toContain("Try again");
});

it("shows newly sent messages and replies immediately while history is pending", async () => {
  await act(async () => root.render(<Page />));
  await act(async () =>
    useAldoAssistant.setState({
      entries: [
        {
          kind: "message",
          role: "user",
          text: "Hello Aldo",
          at: "2026-10-19T12:00:00Z",
        },
      ],
      replying: true,
    }),
  );
  expect(container.textContent).toContain("Hello Aldo");
  expect(container.textContent).not.toContain("Loading conversation");
  expect(container.querySelector<HTMLDivElement>(".overflow-y-auto")!.scrollTop).toBe(1800);
  expect(container.querySelector('[aria-busy="false"]')).not.toBeNull();

  await act(async () =>
    useAldoAssistant.setState((s) => ({
      entries: [
        ...s.entries,
        {
          kind: "message",
          role: "assistant",
          text: "I’m here",
          at: "2026-10-19T12:00:01Z",
        },
      ],
      replying: false,
    })),
  );
  expect(container.textContent).toContain("I’m here");
  expect(useAldoAssistant.getState().historyLoaded).toBe(false);
});
