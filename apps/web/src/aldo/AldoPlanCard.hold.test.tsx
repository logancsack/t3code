// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import { parseAldoPlan } from "./plans.logic";

const backend = vi.hoisted(() => ({ holds: 0, fail: true }));
vi.mock("./planApi", () => ({
  tapAldoPlan: async (_id: string, tap: { action: string }) => {
    if (tap.action !== "hold") return null;
    backend.holds += 1;
    if (backend.fail) throw new Error("Connection lost");
    return null;
  },
}));
vi.mock("./AldoHomeInbox", () => ({ ThreadLink: () => null }));
vi.mock("./AldoPresence", () => ({ AldoAvatar: () => null }));
vi.mock("./assistantSession", () => ({
  pullAldoConversation: vi.fn(),
  seedAldoComposer: vi.fn(),
}));
vi.mock("./homeFeed", () => ({ refreshAldoHome: async () => undefined }));

const { AldoPlanCard } = await import("./AldoPlanCard");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const plan = parseAldoPlan({
  id: "plan-1",
  goal: "Launch videos for Driftwood’s new site",
  steps: ["Gather the brand kit", "Cut three short videos"],
  inYourName: null,
  cost: "Nothing",
  leftForYou: null,
  questions: [
    {
      id: "q1",
      question: "Which videos?",
      options: ["Logo reveals", "One long film"],
      recommended: "Logo reveals",
    },
  ],
  minutes: 30,
  costsMoney: false,
  status: "proposed",
  autoStartAt: new Date(Date.now() + 118_000).toISOString(),
  proposedAt: new Date().toISOString(),
  startedAt: null,
  startedBy: null,
  answers: null,
  thread: null,
  title: null,
  error: null,
})!;

it("asks Aldo again to hold a plan, and counts down again if it never hears", async () => {
  vi.useFakeTimers();
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<AldoPlanCard plan={plan} />));
  const timer = () => host.querySelector('[role="timer"], [role="status"]');
  expect(timer()?.getAttribute("role")).toBe("timer");
  // Another answer than Aldo's: the user is deciding.
  const other = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "One long film",
  )!;
  await act(async () => other.click());
  expect(timer()?.getAttribute("role")).toBe("status");
  // 1, 2 and 4 seconds apart, then it gives up.
  await act(async () => vi.advanceTimersByTimeAsync(7_000));
  expect(backend.holds).toBe(4);
  expect(timer()?.getAttribute("role")).toBe("timer");
  expect(timer()?.textContent).toMatch(/Couldn’t reach Aldo to hold it/);
  // The next word held it, once Aldo can hear.
  backend.fail = false;
  const recommended = [...host.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-pressed") !== null && b.textContent?.startsWith("Logo reveals"),
  )!;
  await act(async () => recommended.click());
  await act(async () => other.click());
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(backend.holds).toBe(5);
  expect(timer()?.getAttribute("role")).toBe("status");
  expect(timer()?.textContent).not.toMatch(/Couldn’t reach Aldo/);
  act(() => root.unmount());
  vi.useRealTimers();
});
