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

// A choice row reads as its label; its line under the label says what it does.
const labelOf = (b: HTMLButtonElement) =>
  (b.querySelector("[data-aldo-choice-label]") ?? b).textContent;
const labels = () => [...container.querySelectorAll("button")].map(labelOf);
const detailOf = (label: string) =>
  [...container.querySelectorAll("button")]
    .find((b) => labelOf(b) === label)!
    .querySelector(":scope > span:last-child")!.textContent;
const tap = (label: string) =>
  act(async () =>
    [...container.querySelectorAll("button")].find((b) => labelOf(b) === label)!.click(),
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
  expect(labels()).toEqual(["Allow", "Don't allow", "Don't allow, and say why…"]);
  await tap("Don't allow, and say why…");
  // The reasons take the rows' place, and the keyboard goes with them.
  expect(labels()).toEqual([
    "Too expensive",
    "Bad timing",
    "Wrong details",
    "I'll do it myself",
    "Back",
  ]);
  expect(container.querySelector('[aria-label="Why not?"]')).not.toBeNull();
  expect(document.activeElement?.textContent).toBe("Too expensive");
  await tap("Bad timing");
  expect(backend.send).toHaveBeenCalledExactlyOnceWith(
    approval,
    "discard",
    "Bad timing",
    undefined,
    { afterAccepted: true },
  );
});

it("asks the question with why, and says what each choice does", async () => {
  await show(
    booking({
      title: "Let the agent pay $12 for the full ADP price sheet.",
      why: "It can finish without it, using ADP's public pages, which give no price.",
      fields: [
        { label: "Where", value: "https://www.adp.com/pricing" },
        { label: "Total", value: "$12.00" },
        { label: "Terms", value: "No refunds" },
      ],
      allowUpTo: 15,
    }),
  );
  expect(container.textContent).toContain("Let the agent pay $12 for the full ADP price sheet?");
  expect(container.textContent).toContain("It can finish without it, using ADP's public pages");
  expect(labels()).toEqual([
    "Allow once",
    "Always allow up to $15",
    "Don't allow",
    "Don't allow, and say why…",
  ]);
  expect(detailOf("Allow once")).toBe("$12.00 to adp.com, this task only");
  expect(detailOf("Always allow up to $15")).toBe(
    "Saves a rule. You can change it in Settings → Permissions",
  );
  expect(detailOf("Don't allow")).toBe("The agent carries on without it");
  // The total and the place are said in the first choice; the terms stay above it.
  const terms = [...container.querySelectorAll("dt")].map((dt) => dt.textContent);
  expect(terms).toEqual(["Terms"]);
});

it("always allows up to Aldo's amount in one tap, which approves and saves that limit", async () => {
  const approval = booking({ allowUpTo: 50 });
  await show(approval);
  expect(container.querySelector("select")).toBeNull();
  await tap("Always allow up to $50");
  expect(backend.send).toHaveBeenCalledExactlyOnceWith(approval, "approve", undefined, 50, {
    afterAccepted: true,
  });
});

it("allows once without saving a limit", async () => {
  const approval = booking({ allowUpTo: 50 });
  await show(approval);
  await tap("Allow once");
  expect(backend.send).toHaveBeenCalledExactlyOnceWith(approval, "approve", undefined, undefined, {
    afterAccepted: true,
  });
});

it("an older Aldo's first paid step is allowed once, with no limit to choose on the card", async () => {
  const approval = booking({ spendingLimit: true });
  await show(approval);
  expect(container.querySelector("select")).toBeNull();
  expect(labels()).toEqual(["Allow", "Don't allow", "Don't allow, and say why…"]);
  await tap("Allow");
  expect(backend.send).toHaveBeenCalledExactlyOnceWith(approval, "approve", undefined, undefined, {
    afterAccepted: true,
  });
});

it("goes back without deciding, by its button or Escape, and gives the keyboard back", async () => {
  await show(booking());
  await tap("Don't allow, and say why…");
  await tap("Back");
  expect(labels()).toEqual(["Allow", "Don't allow", "Don't allow, and say why…"]);
  expect(document.activeElement?.textContent).toBe("Don't allow, and say why…");
  await tap("Don't allow, and say why…");
  await act(async () => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  expect(labels()).toEqual(["Allow", "Don't allow", "Don't allow, and say why…"]);
  expect(backend.send).not.toHaveBeenCalled();
});

it("still declines in one tap, with no reason", async () => {
  const approval = booking();
  await show(approval);
  await tap("Don't allow");
  expect(backend.send).toHaveBeenCalledExactlyOnceWith(approval, "discard", undefined, undefined, {
    afterAccepted: true,
  });
});

it("offers no reasons where Aldo gives none", async () => {
  const { reasons: _none, ...plain } = booking();
  await show(plain);
  expect(labels()).toEqual(["Allow", "Don't allow"]);
});

it("an email's rule is saved in one tap from its row, which names it", async () => {
  const { reasons: _none, ...email } = booking({
    kind: "email",
    title: "Re: Thursday",
    summary: "To dana@example.com",
    fields: [{ label: "To", value: "dana@example.com" }],
    approveLabel: "Send",
    discardLabel: "Discard",
    always: "Agents can send email to dana@example.com without asking",
  });
  const approval: AldoApproval = email;
  await show(approval);
  expect(labels()).toEqual(["Send", "Always allow", "Discard"]);
  expect(detailOf("Always allow")).toBe(
    "Agents can send email to dana@example.com without asking. You can change it in Settings → Permissions",
  );
  await tap("Always allow");
  expect(backend.send).toHaveBeenCalledExactlyOnceWith(approval, "always", undefined, undefined, {
    afterAccepted: true,
  });
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
