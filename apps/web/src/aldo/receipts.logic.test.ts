import { describe, expect, it } from "vite-plus/test";

import type { AldoApproval, AldoHomeConversation, AldoHomePullRequest } from "./cloud";
import type { AldoDecision } from "./decisions.logic";
import { withReceipts } from "./feed.logic";
import { movedOnText, receiptText } from "./receipts.logic";

const target = { environmentId: "aldo-m1", threadId: "t1" };

const approval = (overrides: Partial<AldoApproval>): AldoDecision => ({
  kind: "aldo-approval",
  key: "aldo:a1",
  approval: {
    id: "a1",
    kind: "email",
    provider: "google",
    title: "Reply to Dana",
    summary: "To dana@example.com",
    fields: [],
    body: "Hi Dana",
    approveLabel: "Send",
    discardLabel: "Discard",
    status: "pending",
    result: null,
    failed: false,
    thread: target,
    threadTitle: "Inbox triage",
    createdAt: "2026-10-15T10:00:00Z",
    decidedAt: null,
    ...overrides,
  } as AldoApproval,
});

const conversation = {
  ref: "m1:t1",
  thread: target,
  title: "Fix checkout",
} as AldoHomeConversation;

describe("receiptText", () => {
  it("says what was done with one of Aldo's approvals", () => {
    expect(receiptText(approval({}), { kind: "aldo", decision: "approve" })).toBe(
      "Sent “Reply to Dana”",
    );
    expect(receiptText(approval({}), { kind: "aldo", decision: "discard" })).toBe(
      "Discarded “Reply to Dana”",
    );
    expect(
      receiptText(approval({ kind: "event", title: "Design review" }), {
        kind: "aldo",
        decision: "approve",
      }),
    ).toBe("Added “Design review” to your calendar");
  });

  it("tells what Aldo said it did over what was asked", () => {
    expect(
      receiptText(
        approval({}),
        { kind: "aldo", decision: "approve" },
        'Sent "Re: Lease" to dana@example.com.',
      ),
    ).toBe('Sent "Re: Lease" to dana@example.com.');
    expect(
      receiptText(
        approval({}),
        { kind: "aldo", decision: "discard" },
        "Not sent. The draft is still in their drafts: Aldo couldn't delete it.",
      ),
    ).toBe(
      "“Reply to Dana”: Not sent. The draft is still in their drafts: Aldo couldn't delete it.",
    );
  });

  it("says what was answered, merged or approved", () => {
    const question = {
      kind: "question",
      key: "question:m1:t1:q1",
      conversation,
      pending: { kind: "question", requestId: "q1", questions: [] },
    } as unknown as AldoDecision;
    expect(receiptText(question, { kind: "answer", answers: { a: "Idempotency key" } })).toBe(
      "Answered “Idempotency key” for Fix checkout",
    );
    expect(receiptText(question, { kind: "answer", text: "Use a lock" })).toBe(
      "Answered “Use a lock” for Fix checkout",
    );
    const merge = {
      kind: "merge",
      key: "merge:o/r#231",
      pullRequest: { number: 231, title: "Virtualize the sidebar" } as AldoHomePullRequest,
    } as AldoDecision;
    expect(receiptText(merge, { kind: "merge" })).toBe("Merged #231 Virtualize the sidebar");
    const plan = {
      kind: "plan",
      key: "plan:m1:t1:p1",
      conversation,
      plan: { id: "p1", text: "1. Do it" },
    } as AldoDecision;
    expect(receiptText(plan, { kind: "plan" })).toBe("Approved the plan for Fix checkout");
  });
});

describe("withReceipts", () => {
  it("puts what was decided in where it was decided", () => {
    const events = withReceipts(
      [
        {
          kind: "action",
          key: "action:x",
          at: "2026-10-15T10:00:00Z",
          action: {} as never,
          live: false,
        },
      ],
      [{ key: "aldo:a1", at: "2026-10-15T09:00:00Z", text: "Sent “Reply to Dana”" }],
    );
    expect(events.map((e) => e.key)).toEqual(["decided:aldo:a1", "action:x"]);
  });
});

describe("movedOnText", () => {
  it("never says it did what had already moved on", () => {
    const merge = {
      kind: "merge",
      key: "merge:o/r#231",
      pullRequest: { number: 231, title: "Virtualize the sidebar" } as AldoHomePullRequest,
    } as AldoDecision;
    expect(movedOnText(merge)).toBe("#231 Virtualize the sidebar had already moved on");
    const question = { kind: "question", key: "q", conversation } as unknown as AldoDecision;
    expect(movedOnText(question)).toBe("Fix checkout had already moved on");
    expect(movedOnText(approval({}), "That expired: nothing was done.")).toBe(
      "“Reply to Dana”: That expired: nothing was done.",
    );
  });
});
