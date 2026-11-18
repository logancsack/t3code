// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type { AldoApproval } from "./homeApi";

const backend = vi.hoisted(() => ({ send: vi.fn(), toast: vi.fn() }));
vi.mock("../components/ui/toast", () => ({ toastManager: { add: backend.toast } }));
vi.mock("./homeFeed", async (original) => ({
  ...(await original<typeof import("./homeFeed")>()),
  sendAldoApproval: backend.send,
}));

let ApprovalCard: typeof import("./AldoApprovalCard").ApprovalCard;
let DecidedApproval: typeof import("./AldoApprovals").DecidedApproval;
let root: Root;
let container: HTMLDivElement;

const booking = (over: Partial<AldoApproval> = {}): AldoApproval => ({
  id: "ap_1",
  kind: "confirm",
  provider: null,
  title: "Book a table for 4 at Café de France, Thu Oct 8, 7:30 PM",
  summary: "$48.00 at Café de France (OpenTable)",
  fields: [
    { label: "Where", value: "Café de France (OpenTable)" },
    { label: "Total", value: "$48.00" },
  ],
  body: "Party of 4, indoor.",
  approveLabel: "Book",
  discardLabel: "Don't",
  status: "pending",
  result: null,
  failed: false,
  thread: null,
  threadTitle: null,
  createdAt: "2026-10-21T12:00:00Z",
  decidedAt: null,
  reasons: ["Too expensive", "Bad timing", "Wrong details", "I'll do it myself"],
  ...over,
});

const labels = () => [...container.querySelectorAll("button")].map((b) => b.textContent);
const tap = (label: string) =>
  act(async () =>
    [...container.querySelectorAll("button")].find((b) => b.textContent === label)!.click(),
  );
const show = (approval: AldoApproval) =>
  act(async () =>
    root.render(
      <ul>
        <ApprovalCard
          approval={approval}
          now={Date.parse("2026-10-21T12:05:00Z")}
          onActed={() => {}}
        />
      </ul>,
    ),
  );

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // The card's text measures itself to offer "Show more" (AldoQuoted.tsx); jsdom has nothing to measure with.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  ({ ApprovalCard } = await import("./AldoApprovalCard"));
  ({ DecidedApproval } = await import("./AldoApprovals"));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  backend.send.mockReset();
  backend.send.mockImplementation(async (_approval, decision) => ({
    message: "Decision saved.",
    approval: { status: decision === "discard" ? "discarded" : "approved" },
  }));
  backend.toast.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it("declines with a reason in a tap, from the reasons Aldo offers", async () => {
  const approval = booking();
  await show(approval);
  expect(labels()).toEqual(["Book", "Don't", "Don't, because…"]);
  await tap("Don't, because…");
  // The reasons take the buttons' place, and the keyboard goes with them.
  expect(labels()).toEqual([
    "Too expensive",
    "Bad timing",
    "Wrong details",
    "I'll do it myself",
    "Back",
  ]);
  expect(container.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe("Why not?");
  expect(document.activeElement?.textContent).toBe("Too expensive");
  await tap("Bad timing");
  expect(backend.send).toHaveBeenCalledExactlyOnceWith(approval, "discard", "Bad timing");
});

it("requires an explicit first spending limit and can choose to ask every time", async () => {
  const approval = booking({ spendingLimit: true });
  await show(approval);
  const approve = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "Book and save limit",
  )!;
  expect(approve.disabled).toBe(false);
  await tap("Book and save limit");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Choose a spending limit",
  );
  expect(backend.send).not.toHaveBeenCalled();
  const select = container.querySelector("select")!;
  expect(document.querySelector(`label[for="${select.id}"]`)?.textContent).toContain(
    "For future spending",
  );
  await act(async () => {
    select.value = "0";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(approve.disabled).toBe(false);
  expect(backend.send).not.toHaveBeenCalled();
  await tap("Book and save limit");
  expect(backend.send).toHaveBeenCalledExactlyOnceWith(approval, "approve", undefined, 0);
});

it("keeps custom limits invalid until fixed and can decline without saving one", async () => {
  const approval = booking({ spendingLimit: true });
  await show(approval);
  const select = container.querySelector("select")!;
  await act(async () => {
    select.value = "custom";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const input = container.querySelector("input")!;
  const set = async (value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await set("-1");
  await tap("Book and save limit");
  expect(backend.send).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "zero or a positive amount",
  );
  await set("19.99");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(
    [...container.querySelectorAll("button")].find((b) => b.textContent === "Book and save limit")
      ?.disabled,
  ).toBe(false);
  await tap("Don't");
  expect(backend.send).toHaveBeenCalledExactlyOnceWith(approval, "discard", undefined);
});

it("keeps the custom amount when an optimistic removal is followed by a failed save", async () => {
  const approval = booking({ id: "ap_failed_limit", spendingLimit: true });
  await show(approval);
  await act(async () => {
    const select = container.querySelector("select")!;
    select.value = "custom";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "19.99");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  backend.send.mockImplementationOnce(async () => {
    root.render(<ul />);
    throw new Error("Couldn't save the approval");
  });
  await tap("Book and save limit");
  expect(container.querySelector("select")).toBeNull();
  await show(approval);
  expect(container.querySelector("select")!.value).toBe("custom");
  expect(container.querySelector("input")!.value).toBe("19.99");
});

it("goes back without deciding, by its button or Escape, and gives the keyboard back", async () => {
  await show(booking());
  await tap("Don't, because…");
  await tap("Back");
  expect(labels()).toEqual(["Book", "Don't", "Don't, because…"]);
  expect(document.activeElement?.textContent).toBe("Don't, because…");
  await tap("Don't, because…");
  await act(async () => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  expect(labels()).toEqual(["Book", "Don't", "Don't, because…"]);
  expect(backend.send).not.toHaveBeenCalled();
});

it("still declines in one tap, with no reason", async () => {
  const approval = booking();
  await show(approval);
  await tap("Don't");
  expect(backend.send).toHaveBeenCalledExactlyOnceWith(approval, "discard", undefined);
});

it("offers no reasons where Aldo gives none", async () => {
  const { reasons: _none, ...plain } = booking();
  await show(plain);
  expect(labels()).toEqual(["Book", "Don't"]);
});

it("says what the user said on one they declined", () => {
  const declined = booking({
    status: "discarded",
    result: "Declined. I won't do it.",
    reason: "Too expensive",
    decidedAt: "2026-10-21T12:04:00Z",
  });
  const line = renderToStaticMarkup(
    <DecidedApproval approval={declined} now={Date.parse("2026-10-21T12:05:00Z")} />,
  );
  expect(line).toContain("Declined. I won&#x27;t do it.");
  expect(line).toContain("You said: Too expensive");
});
