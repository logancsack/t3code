// @vitest-environment jsdom

import { act, createContext, useLayoutEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { AldoConversationPage } from "./AldoConversationPage";
import { useAldoAssistant } from "./assistantSession";

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
  AldoConversation: () => {
    const entries = useAldoAssistant((s) => s.entries);
    return (
      <div>
        {entries.map((e) => (
          <p key={e.kind === "message" ? e.at : e.id}>{e.kind === "message" ? e.text : e.label}</p>
        ))}
      </div>
    );
  },
}));
vi.mock("./AldoHomeBoard", () => ({ HealthStrip: () => <div>Setup failed to build</div> }));
vi.mock("./AldoLiveCard", () => ({ AldoOpenContext: createContext(null) }));
vi.mock("./AldoPresence", () => ({ AldoPresence: () => null, AldoAvatar: () => null }));
vi.mock("./AldoUpNext", () => ({ AldoUpNext: () => <div>Working thread</div> }));
vi.mock("./arrive", () => ({ settleAldoConversation: vi.fn(), unsettleAldoConversation: vi.fn() }));
vi.mock("./face", () => ({ blinkAldo: vi.fn() }));
vi.mock("./morph", () => ({
  aldoGlide: vi.fn(),
  aldoMorphSource: vi.fn(),
  morphIntoThread: vi.fn(),
}));
vi.mock("./homeFeed", () => ({ refreshAldoHome: vi.fn() }));
vi.mock("./firstView", () => ({ useAldoFirstViewHold: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
let resized: () => void;
let beforePaint: number[];

function Page() {
  // Parent layout effects run after the child's, before passive effects and paint.
  useLayoutEffect(() => {
    beforePaint.push(container.querySelector<HTMLDivElement>(".overflow-y-auto")!.scrollTop);
  });
  return (
    <AldoConversationPage
      home={null}
      supported={true}
      error={null}
      now={Date.parse("2026-10-19T12:00:00Z")}
      tabs={null}
      actions={null}
      setup={<div>Set up Aldo</div>}
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
  vi.unstubAllGlobals();
});

it("keeps setup and activity out of the loading viewport, with the composer ready", async () => {
  await act(async () => root.render(<Page />));
  expect(container.textContent).toContain("Loading conversation");
  expect(container.textContent).not.toContain("Setup failed");
  expect(container.textContent).not.toContain("Set up Aldo");
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

it("still opens an empty conversation at the welcome", async () => {
  useAldoAssistant.setState({ historyLoaded: true });
  await act(async () => root.render(<Page />));
  expect(beforePaint).toEqual([0]);
  expect(container.textContent).toContain("What should we get done?");
});
