import { describe, expect, it } from "vite-plus/test";

import {
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
