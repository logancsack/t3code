// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { type AldoHome } from "./homeApi";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const underTheHood = vi.hoisted(() => vi.fn());
const dismiss = vi.hoisted(() => vi.fn(async () => undefined));
const restore = vi.hoisted(() => vi.fn(async () => undefined));
const remove = vi.hoisted(() => vi.fn(async (_ids: ReadonlyArray<string>) => undefined));

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
vi.mock("./homeApi", async (original) => ({
  ...(await original<typeof import("./homeApi")>()),
  removeAldoDecisions: remove,
}));
vi.mock("./homeFeed", async (original) => ({
  ...(await original<typeof import("./homeFeed")>()),
  refreshAldoHome: async () => undefined,
}));
vi.mock("./clearNeedsYou", () => ({ dismissNeedsYou: dismiss, restoreNeedsYou: restore }));
// No machine is connected here: no live step (and none of T3's thread state to load).
vi.mock("./liveWork", () => ({ useAldoLiveWork: () => null, useAldoLiveNow: () => NOW }));
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
  dismiss.mockClear();
  restore.mockClear();
  remove.mockReset();
  remove.mockResolvedValue(undefined);
  vi.useRealTimers();
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

const cleared = (id: string) => ({ id, dismissed: true, cleared: true });
const asks = (id: string) => ({ id, dismissed: false });

it("dismisses an item with its ✕, without opening its thread, and Clear all takes every one", () => {
  show(
    home([
      conversation("a", { state: "waiting", chatDecision: asks("da") }),
      conversation("b", { state: "failed", chatDecision: asks("db") }),
    ]),
  );
  press("Aldo:");
  press("Needs you");
  press("Dismiss Thread a");
  expect(dismiss).toHaveBeenLastCalledWith(["da"]);
  expect(text()).toContain("Dismissed “Thread a”");
  press("Undo");
  expect(restore).toHaveBeenLastCalledWith(["da"]);
  press("Clear all");
  expect(dismiss).toHaveBeenLastCalledWith(["da", "db"]);
  expect(text()).toContain("Dismissed 2 things");
});

it("offers no way to dismiss on an Aldo that can't", () => {
  show(home([conversation("a", { state: "waiting" })]));
  press("Aldo:");
  press("Needs you");
  expect(text()).toContain("Thread a");
  expect(document.querySelector('[aria-label^="Dismiss"]')).toBeNull();
  expect(text()).not.toContain("Clear all");
});

it("counts nothing dismissed, lists it under Dismissed, and restores it", () => {
  show(
    home([
      conversation("a", { state: "waiting", chatDecision: asks("da") }),
      conversation("b", { state: "failed", chatDecision: cleared("db") }),
    ]),
  );
  expect(text()).toContain("1 thing needs you");
  press("Aldo:");
  expect(text()).toContain("Needs you");
  press("Needs you");
  expect(text()).not.toContain("Thread b");
  press("Dismissed");
  expect(text()).toContain("Thread b");
  press("Restore Thread b");
  expect(restore).toHaveBeenLastCalledWith(["db"]);
});

it("says nothing waits once everything is dismissed, and keeps the Dismissed list reachable", () => {
  show(home([conversation("b", { state: "failed", chatDecision: cleared("db") })]));
  expect(text()).toContain("All caught up");
  press("Aldo:");
  press("Needs you");
  expect(text()).toContain("Nothing waiting on you");
  expect(text()).toContain("Dismissed");
});

const dismissedTwo = () =>
  show(
    home([
      conversation("a", { state: "failed", chatDecision: cleared("da") }),
      conversation("b", { state: "failed", chatDecision: cleared("db") }),
    ]),
  );
const openDismissed = () => {
  press("Aldo:");
  press("Needs you");
  press("Dismissed");
};

it("clears one dismissed item with its ✕ and Clear all takes the rest, each with an Undo", () => {
  dismissedTwo();
  openDismissed();
  expect(document.querySelector('[aria-label="Restore Thread a"]')).not.toBeNull();
  press("Clear Thread a");
  expect(text()).toContain("Cleared “Thread a”");
  expect(document.querySelector('[aria-label="Restore Thread a"]')).toBeNull();
  expect(document.querySelector('[aria-label="Restore Thread b"]')).not.toBeNull();
  press("Undo");
  expect(document.querySelector('[aria-label="Restore Thread a"]')).not.toBeNull();
  press("Clear all");
  expect(text()).toContain("Cleared 2 things");
  expect(text()).toContain("Threads are archived, not deleted.");
  // Nothing was sent: it can still be undone, and the empty list stays to say so.
  expect(remove).not.toHaveBeenCalled();
  expect(text()).toContain("Nothing dismissed");
  press("Undo");
  expect(document.querySelector('[aria-label="Restore Thread a"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="Restore Thread b"]')).not.toBeNull();
  expect(remove).not.toHaveBeenCalled();
});

it("sends the clear when the time to undo is up, and goes back to Needs you", () => {
  vi.useFakeTimers();
  dismissedTwo();
  openDismissed();
  press("Clear all");
  act(() => vi.advanceTimersByTime(7_999));
  expect(remove).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(remove).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenLastCalledWith(["da", "db"]);
  expect(text()).toContain("Nothing waiting on you");
  expect(text()).not.toContain("Dismissed");
});

it("sends the clear when the drop-down closes", () => {
  dismissedTwo();
  openDismissed();
  press("Clear Thread b");
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(remove).toHaveBeenLastCalledWith(["db"]);
});

it("says when a clear couldn't be sent, and the item is back", async () => {
  vi.useFakeTimers();
  remove.mockRejectedValueOnce(new Error("offline"));
  dismissedTwo();
  openDismissed();
  press("Clear Thread a");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8_000);
  });
  expect(text()).toContain("Couldn't clear it");
  expect(document.querySelector('[aria-label="Restore Thread a"]')).not.toBeNull();
});

it("doesn't list what was cleared for good, and a clear-all needs no Dismissed row once none are left", () => {
  show(
    home([
      conversation("a", { state: "failed", chatDecision: { ...cleared("da"), removed: true } }),
    ]),
  );
  press("Aldo:");
  press("Needs you");
  expect(text()).not.toContain("Dismissed");
});
