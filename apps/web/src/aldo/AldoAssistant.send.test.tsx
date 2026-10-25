// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const backend = vi.hoisted(() => ({ send: vi.fn(), turn: vi.fn() }));
vi.mock("./homeOutbox", () => ({
  keepHomeMessage: async () => {},
  dropHomeMessage: async () => {},
  homeMessages: async () => [],
}));
vi.mock("./assistantApi", () => ({
  aldoAssistant: { send: backend.send, turn: backend.turn },
  requestAldoProfile: async () => ({ id: "u1" }),
  aldoAssistantInfo: async () => ({ available: true, images: null }),
}));
vi.mock("./directory", () => ({
  getAldoEnvironments: () => [],
  requestAldoDirectoryRefresh: vi.fn(),
  subscribeAldoEnvironments: () => () => {},
}));
vi.mock("./screen", () => ({ aldoOnScreen: () => null, subscribeAldoOnScreen: () => () => {} }));
vi.mock("../components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));
vi.mock("./AldoBrief", () => ({ AldoBriefEntry: () => null }));
vi.mock("./AldoLiveCard", () => ({ AldoThreadCard: () => null }));
vi.mock("./AldoFrame", () => ({ AldoFrame: () => null }));
vi.mock("./AldoPlanPicker", () => ({ AldoPlanPicker: () => null }));
vi.mock("./homeFeed", () => ({
  noteAldoAnswered: vi.fn(),
  useAldoHomeFeed: (select: (state: { home: null }) => unknown) => select({ home: null }),
}));
vi.mock("./presenceReactions", () => ({ acknowledgeAldo: vi.fn(), setAldoReading: vi.fn() }));
vi.mock("./firstView", () => ({ useAldoFirstViewHold: vi.fn() }));
vi.mock("./arrive", () => ({ useAldoArrive: () => ({}), useAldoArrived: () => true }));

import { AldoComposer, AldoConversation } from "./AldoAssistant";
import { useAldoAssistant } from "./assistantSession";

let root: Root;
let container: HTMLDivElement;
let touch = false;
beforeEach(() => {
  touch = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: touch && query === "(pointer: coarse)",
    addEventListener() {},
    removeEventListener() {},
  }));
  Element.prototype.scrollIntoView = vi.fn();
  useAldoAssistant.setState({ entries: [], historyLoaded: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function type(text: string) {
  await act(async () => {
    const input = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function send(text: string) {
  await type(text);
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(container.querySelector("textarea")!.value).toBe("");
}

const taken = { kind: "taken", sessionId: "as_dom000000000" };

it("keeps Send enabled for three taps, sends each at once, and accepts another send while a reply arrives", async () => {
  type Turn = { sessionId: string; reply: string; calls: [] };
  const completions: ((turn: Turn) => void)[] = [];
  backend.send.mockResolvedValue(taken);
  backend.turn.mockImplementation(() => new Promise<Turn>((resolve) => completions.push(resolve)));
  await act(async () =>
    root.render(
      <>
        <AldoConversation feed={[]} />
        <AldoComposer chips={[]} onChip={vi.fn()} />
      </>,
    ),
  );
  await send("Plan dinner");
  await send("For four people");
  await send("Make it vegetarian");
  expect(container.textContent).toContain("Plan dinner");
  expect(container.textContent).toContain("For four people");
  expect(container.textContent).toContain("Make it vegetarian");
  // Nothing waits behind another message's reply, and nothing says "queued" or "sending" for a message that went.
  expect(backend.send).toHaveBeenCalledTimes(3);
  expect(container.textContent).not.toMatch(/Queued|Sending/);
  await act(async () =>
    completions[0]!({
      sessionId: "as_dom000000000",
      reply: "First paragraph.\n\nAnother paragraph still arriving.",
      calls: [],
    }),
  );
  expect(container.textContent).toContain("First paragraph.");
  expect(container.textContent).not.toContain("Another paragraph still arriving.");
  await send("Include a shopping list");
  expect(backend.send).toHaveBeenCalledTimes(4);
  for (let i = 1; i < 4; i++) {
    await act(async () =>
      completions[i]!({ sessionId: "as_dom000000000", reply: `Reply ${i}`, calls: [] }),
    );
  }
  expect(backend.send.mock.calls.map((call) => call[2])).toEqual([
    "Plan dinner",
    "For four people",
    "Make it vegetarian",
    "Include a shopping list",
  ]);
  expect(useAldoAssistant.getState().replying).toBe(false);
});

it("says a message isn't sent yet when Aldo can't be reached, and sends it on Try again", async () => {
  vi.useFakeTimers();
  backend.send.mockRejectedValue(new TypeError("Failed to fetch"));
  backend.turn.mockResolvedValue("unknown");
  await act(async () =>
    root.render(
      <>
        <AldoConversation feed={[]} />
        <AldoComposer chips={[]} onChip={vi.fn()} />
      </>,
    ),
  );
  await send("Hi");
  await act(async () => vi.advanceTimersByTimeAsync(3_000));
  expect(container.textContent).toContain("Sending…");
  await act(async () => vi.advanceTimersByTimeAsync(4_000));
  expect(container.textContent).toContain("Can't reach Aldo yet. Still trying.");
  // The browser's own words never show.
  expect(container.textContent).not.toContain("Failed to fetch");
  backend.send.mockResolvedValue(taken);
  backend.turn.mockResolvedValue({ sessionId: "as_dom000000000", reply: "Hello.", calls: [] });
  const retry = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "Try again",
  )!;
  await act(async () => retry.click());
  expect(container.textContent).toContain("Hello.");
  expect(container.textContent).not.toMatch(/Sending|Try again/);
  vi.useRealTimers();
});

it.each([
  ["touch", true, false],
  ["mouse", false, true],
])(
  "with %s input, focus stays in the field after sending: %s",
  async (_input, isTouch, keepsFocus) => {
    touch = isTouch;
    backend.send.mockImplementation(() => new Promise(() => {}));
    await act(async () => root.render(<AldoComposer chips={[]} onChip={vi.fn()} />));
    const field = container.querySelector("textarea")!;
    field.focus();
    await send("Hello");
    expect(document.activeElement === field).toBe(keepsFocus);
  },
);
