import { describe, expect, it } from "vite-plus/test";

import type { AldoApproval } from "./cloud";
import {
  approvalOutcome,
  approvalQuestion,
  decidedLately,
  waitingApprovals,
} from "./approvals.logic";

const NOW = Date.parse("2026-10-03T12:00:00Z");

function approval(overrides: Partial<AldoApproval>): AldoApproval {
  return {
    id: "ap_1",
    kind: "email",
    provider: "google",
    title: "Re: Thursday",
    summary: "To sam@example.com",
    fields: [],
    body: "Friday works.",
    approveLabel: "Send",
    discardLabel: "Discard",
    status: "pending",
    result: null,
    failed: false,
    thread: null,
    threadTitle: null,
    createdAt: "2026-10-03T11:00:00Z",
    decidedAt: null,
    ...overrides,
  };
}

describe("waitingApprovals", () => {
  it("keeps what waits, oldest first", () => {
    const list = [
      approval({ id: "b", createdAt: "2026-10-03T11:30:00Z" }),
      approval({ id: "a", createdAt: "2026-10-03T10:00:00Z", status: "sending" }),
      approval({ id: "c", status: "approved", decidedAt: "2026-10-03T11:45:00Z" }),
    ];
    expect(waitingApprovals(list).map((a) => a.id)).toEqual(["a", "b"]);
    expect(waitingApprovals(undefined)).toEqual([]);
  });
});

describe("decidedLately", () => {
  it("keeps the last day's decisions, newest first", () => {
    const list = [
      approval({ id: "old", status: "approved", decidedAt: "2026-10-01T11:00:00Z" }),
      approval({ id: "sent", status: "approved", decidedAt: "2026-10-03T09:00:00Z" }),
      approval({ id: "gone", status: "discarded", decidedAt: "2026-10-03T11:00:00Z" }),
      approval({ id: "waiting" }),
    ];
    expect(decidedLately(list, NOW).map((a) => a.id)).toEqual(["gone", "sent"]);
  });
});

describe("approvalQuestion and approvalOutcome", () => {
  it("say what it asks and how it went", () => {
    expect(approvalQuestion({ kind: "email", title: "Re: Thursday" })).toBe('Send "Re: Thursday"?');
    expect(approvalQuestion({ kind: "event", title: "Review" })).toBe(
      'Add "Review" to your calendar?',
    );
    expect(approvalQuestion({ kind: "start", title: "Reply to Sam" })).toBe("Reply to Sam");
    expect(approvalOutcome({ kind: "email", status: "approved" })).toBe("Sent");
    expect(approvalOutcome({ kind: "event", status: "approved" })).toBe("Added");
    expect(approvalOutcome({ kind: "start", status: "discarded" })).toBe("Skipped");
    expect(approvalOutcome({ kind: "email", status: "expired" })).toBe("Expired");
  });
});
