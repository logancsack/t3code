import { describe, expect, it } from "vite-plus/test";

import {
  approvalChoices,
  approvalQuestion,
  placeOf,
  approvalOutcome,
  heldStatus,
  threadApprovals,
  threadAwaitsApproval,
  withApprovalHolds,
  withThreadApprovals,
} from "./approvals.logic";
import type { AldoApproval, AldoHome } from "./homeApi";
import type { TimelineEntry } from "../session-logic";

const thread = { environmentId: "aldo-t", threadId: "c" };

function approval(over: Partial<AldoApproval> = {}): AldoApproval {
  return {
    id: "ap_1",
    kind: "confirm",
    provider: null,
    title: "Submit the Stripe activation",
    summary: "Stripe",
    fields: [],
    body: "",
    approveLabel: "Submit",
    discardLabel: "Don't",
    status: "pending",
    result: null,
    failed: false,
    thread,
    threadTitle: "Pricing",
    createdAt: "2026-10-21T10:00:00Z",
    decidedAt: null,
    ...over,
  };
}

const home = (approvals: AldoApproval[]) => ({ approvals }) as unknown as AldoHome;

describe("a thread's approvals", () => {
  it("are its own, oldest first, without the ones the agent took back", () => {
    const list = [
      approval({ id: "b", createdAt: "2026-10-21T11:00:00Z" }),
      approval({ id: "other", thread: { environmentId: "aldo-t", threadId: "x" } }),
      approval({ id: "gone", status: "withdrawn" }),
      approval({ id: "a" }),
    ];
    expect(threadApprovals(list, thread).map((a) => a.id)).toEqual(["a", "b"]);
    expect(threadApprovals(undefined, thread)).toEqual([]);
  });

  it("make the thread wait on the user only while one is pending", () => {
    expect(threadAwaitsApproval([approval()], thread)).toBe(true);
    expect(threadAwaitsApproval([approval({ status: "approved" })], thread)).toBe(false);
    expect(threadAwaitsApproval([approval({ thread: null })], thread)).toBe(false);
  });

  it("sit in the timeline where they were asked", () => {
    const message = (id: string, createdAt: string) =>
      ({ id, kind: "message", createdAt, message: {} }) as unknown as TimelineEntry;
    const entries = [message("m1", "2026-10-21T09:00:00Z"), message("m2", "2026-10-21T11:00:00Z")];
    const merged = withThreadApprovals(entries, [approval()]);
    expect(merged.map((e) => e.id)).toEqual(["m1", "aldo-approval:ap_1", "m2"]);
    expect(withThreadApprovals(entries, [])).toBe(entries);
    expect(
      withThreadApprovals(entries, [approval({ createdAt: "2026-10-21T12:00:00Z" })]).at(-1)?.id,
    ).toBe("aldo-approval:ap_1");
  });
});

describe("a decision held until Aldo's read catches up", () => {
  const at = "2026-10-21T10:05:00Z";
  const now = Date.parse(at);

  it("shows a step an agent takes decided at once, and the rest being carried out", () => {
    expect(heldStatus({ kind: "confirm" }, "approve")).toBe("approved");
    expect(heldStatus({ kind: "confirm" }, "discard")).toBe("discarded");
    expect(heldStatus({ kind: "email" }, "approve")).toBe("sending");
    expect(heldStatus({ kind: "event" }, "discard")).toBe("sending");
  });

  it("decides the approval in every place that shows it, and leaves the rest alone", () => {
    const other = approval({ id: "ap_2" });
    const holds = { ap_1: { status: "approved" as const, result: null, at } };
    const held = withApprovalHolds(home([approval({ always: "x" }), other]), holds, now);
    expect(held.home.approvals?.[0]).toMatchObject({
      status: "approved",
      decidedAt: at,
      failed: false,
    });
    expect(held.home.approvals?.[0]?.always).toBeUndefined();
    expect(held.home.approvals?.[1]).toBe(other);
    expect(held.holds).toBe(holds);
  });

  it("shows why not on a declined one at once, and takes its reasons to tap with the card", () => {
    const holds = {
      ap_1: { status: "discarded" as const, result: "Declined.", at, reason: "Too expensive" },
    };
    const waiting = approval({ reasons: ["Too expensive", "Bad timing"] });
    const [held] = withApprovalHolds(home([waiting]), holds, now).home.approvals ?? [];
    expect(held).toMatchObject({ status: "discarded", reason: "Too expensive" });
    expect(held?.reasons).toBeUndefined();
    // A plain no says nothing more.
    const plain = { ap_1: { status: "discarded" as const, result: "Declined.", at } };
    expect(
      withApprovalHolds(home([waiting]), plain, now).home.approvals?.[0]?.reason,
    ).toBeUndefined();
  });

  it("is let go once the read has it decided, or it outlives its time", () => {
    const holds = { ap_1: { status: "approved" as const, result: null, at, until: now + 1000 } };
    const caughtUp = withApprovalHolds(home([approval({ status: "approved" })]), holds, now);
    expect(caughtUp.holds).toEqual({});
    const expired = withApprovalHolds(home([approval()]), holds, now + 2000);
    expect(expired.holds).toEqual({});
    expect(expired.home.approvals?.[0]?.status).toBe("pending");
  });

  it("gives the same home back when nothing is held", () => {
    const same = home([approval()]);
    expect(withApprovalHolds(same, {}, now).home).toBe(same);
  });
});

describe("how a decided approval is worded", () => {
  it("says what happened to one the agent took back or one being carried out", () => {
    expect(approvalOutcome({ kind: "email", status: "withdrawn" })).toBe("Withdrawn");
    expect(approvalOutcome({ kind: "email", status: "sending" })).toBe("Sending");
    expect(approvalOutcome({ kind: "confirm", status: "approved" })).toBe("Approved");
  });
});

describe("approvalChoices", () => {
  it("offers a paid step once, always up to Aldo's amount, or not, each saying what it does", () => {
    const choices = approvalChoices(
      approval({
        fields: [
          { label: "Where", value: "https://www.adp.com/pricing" },
          { label: "Total", value: "$12.00" },
          { label: "Terms", value: "No refunds" },
        ],
        approveLabel: "Buy",
        discardLabel: "Don't",
        allowUpTo: 15,
      }),
    );
    expect(choices).toEqual([
      {
        decision: "approve",
        label: "Allow once",
        detail: "$12.00 to adp.com, this task only",
        primary: true,
      },
      {
        decision: "approve",
        label: "Always allow up to $15",
        detail: "Saves a rule. You can change it in Settings → Permissions",
        spendLimit: 15,
      },
      { decision: "discard", label: "Don't allow", detail: "The agent carries on without it" },
    ]);
  });

  it("offers no rule where Aldo offers none, and a free step says only where", () => {
    const free = approvalChoices(
      approval({
        fields: [
          { label: "Where", value: "Café de France (OpenTable)" },
          { label: "Total", value: "$0.00" },
        ],
        approveLabel: "Book",
        discardLabel: "Don't",
      }),
    );
    expect(free.map((c) => [c.label, c.detail])).toEqual([
      ["Allow", "At Café de France (OpenTable)"],
      ["Don't allow", "The agent carries on without it"],
    ]);
    for (const allowUpTo of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(approvalChoices(approval({ allowUpTo })).map((c) => c.label)).not.toContain(
        expect.stringMatching(/^Always/),
      );
    }
  });

  it("an email or event names its rule and what each answer does", () => {
    const email = approvalChoices(
      approval({
        kind: "email",
        approveLabel: "Send",
        discardLabel: "Discard",
        always: "Agents can send email to dana@example.com without asking",
      }),
    );
    expect(email.map((c) => [c.decision, c.label, c.detail])).toEqual([
      ["approve", "Send", "Sends it now, exactly as shown"],
      [
        "always",
        "Always allow",
        "Agents can send email to dana@example.com without asking. You can change it in Settings → Permissions",
      ],
      ["discard", "Discard", "Deletes the draft. Nothing is sent"],
    ]);
    const event = approvalChoices(
      approval({
        kind: "event",
        approveLabel: "Add and invite",
        discardLabel: "Discard",
        fields: [{ label: "Invites", value: "dana@example.com" }],
      }),
    );
    expect(event.map((c) => c.detail)).toEqual([
      "Adds it to your calendar and invites them",
      "Nothing is added to your calendar",
    ]);
  });
});

describe("approvalQuestion", () => {
  it("asks a step once, whatever the agent ended it with", () => {
    expect(approvalQuestion({ kind: "confirm", title: "Buy the price sheet." })).toBe(
      "Buy the price sheet?",
    );
    expect(approvalQuestion({ kind: "confirm", title: "Buy the price sheet?" })).toBe(
      "Buy the price sheet?",
    );
    expect(approvalQuestion({ kind: "email", title: "Re: Thursday" })).toBe('Send "Re: Thursday"?');
  });

  it("says a web address as its site", () => {
    expect(placeOf("https://www.adp.com/pricing?x=1")).toBe("adp.com");
    expect(placeOf("ADP (adp.com)")).toBe("ADP (adp.com)");
    expect(placeOf("https://")).toBe("https://");
  });
});
