// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { type AldoHome } from "./homeApi";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const underTheHood = vi.hoisted(() => vi.fn());

vi.mock("./assistantSession", () => ({
  useAldoAssistant: (select: (s: { phase: string; replying: boolean }) => unknown) =>
    select({ phase: "idle", replying: false }),
}));
vi.mock("./receipts", () => ({
  useAldoReceipts: (select: (s: { receipts: never[] }) => unknown) => select({ receipts: [] }),
}));
vi.mock("./simpleMode", () => ({ setAldoUnderTheHood: underTheHood }));
vi.mock("./AldoFrame", () => ({ AldoFrame: () => null }));
vi.mock("./AldoHomeInbox", () => ({
  ThreadLink: ({ children }: { children: ReactNode }) => <a href="#thread">{children}</a>,
}));
vi.mock("./DismissChatDecision", () => ({
  AldoHiddenFromChat: () => null,
  DismissChatDecision: () => <button type="button">Show again</button>,
}));

let AldoPresence: typeof import("./AldoPresence").AldoPresence;
let useAldoHomeReadAt: typeof import("./homeFeed").useAldoHomeReadAt;
let root: Root;
let host: HTMLElement;

const conversation = (ref: string, over: Record<string, unknown>) => ({
  ref,
  thread: { environmentId: `aldo-${ref}`, threadId: ref },
  title: `Thread ${ref}`,
  repos: [],
  branch: "",
  machine: "running",
  at: ago(5),
  ...over,
});
const home = (conversations: unknown[]) =>
  ({
    at: ago(0),
    conversations,
    pullRequests: [],
    upcoming: [],
    approvals: [],
  }) as unknown as AldoHome;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  ({ AldoPresence } = await import("./AldoPresence"));
  ({ useAldoHomeReadAt } = await import("./homeFeed"));
  useAldoHomeReadAt.setState({ at: NOW - 10_000 });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const show = (read: AldoHome | null) =>
  act(() => root.render(<AldoPresence home={read} now={NOW} />));
const text = () => document.body.textContent ?? "";
const press = (label: string) =>
  act(() => {
    [...document.querySelectorAll<HTMLElement>("button, a")]
      .find((el) => el.textContent?.includes(label) || el.getAttribute("aria-label") === label)!
      .click();
  });

it("says all caught up after a recent read, and checking before one", () => {
  show(home([]));
  expect(text()).toContain("All caught up");
  useAldoHomeReadAt.setState({ at: 0 });
  show(home([]));
  expect(text()).toContain("Checking…");
});

it("counts a thread hidden from chat in the header and the list, tagged", () => {
  show(
    home([
      conversation("a", { state: "waiting" }),
      conversation("b", { state: "waiting", chatDecision: { id: "b", dismissed: true } }),
      conversation("c", { state: "working", stateAt: ago(3) }),
    ]),
  );
  expect(text()).toContain("2 need you · 1 working");
  press("Aldo:");
  expect(text()).toContain("Needs you");
  expect(text()).toContain("hidden from chat");
  expect(text()).toContain("Moved since you looked");
  expect(text()).toContain("Working");
  expect(text()).toContain("Coming up");
  expect(text()).toContain("Under the hood");
});

it("opens a list, goes back to the index, and keeps Under the hood reachable", () => {
  show(home([conversation("a", { state: "waiting" })]));
  press("Aldo:");
  press("Needs you");
  expect(text()).toContain("Thread a");
  expect(document.querySelector('a[href="#thread"]')).not.toBeNull();
  press("Back");
  expect(text()).toContain("Moved since you looked");
  press("Under the hood");
  expect(underTheHood).toHaveBeenCalledWith(true);
});

it("shows what moved until the drop-down is closed", () => {
  show(home([conversation("done", { state: "done", stateAt: ago(20) })]));
  expect(text()).toContain("1 thread moved");
  press("Aldo:");
  press("Moved since you looked");
  expect(text()).toContain("Finished");
  press("Back");
  press("Under the hood");
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(window.localStorage.getItem("aldo:presence:seen")).not.toBeNull();
  expect(text()).toContain("All caught up");
});
