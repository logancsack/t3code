import { describe, expect, it } from "vite-plus/test";

import { type AldoHome, type AldoPayment } from "./homeApi";
import {
  aldoDecisions,
  aldoWaitingCount,
  chatDecisionOf,
  decisionAsk,
  decisionAt,
  decisionBrief,
  decisionThread,
  decisionTitle,
} from "./decisions.logic";
import { feedEvents, interleaveInPlace } from "./feed.logic";
import { paymentWaits, paymentWords, settledPayments, waitingPayments } from "./payments.logic";
import { simpleNeedsYou } from "./simpleMode.logic";

const NOW = Date.parse("2026-10-22T15:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function payment(id: string, over: Partial<AldoPayment> = {}): AldoPayment {
  return {
    id,
    merchant: "Stripe Press",
    site: "press.stripe.com",
    total: "$35.00",
    items: [{ name: "Working in Public", quantity: 1, price: "$30.00" }],
    context:
      "Buying 'Working in Public' from Stripe Press for the user, who asked for the hardcover.",
    status: "pending_approval",
    approvalUrl: `https://app.link.com/activity/approve/lsrq_${id}`,
    expiresAt: ago(-20),
    cardLast4: null,
    test: false,
    thread: { environmentId: "aldo-t1", threadId: "conv" },
    threadTitle: "Buy the book",
    createdAt: ago(10),
    updatedAt: ago(10),
    ...over,
  };
}

function home(payments?: ReadonlyArray<AldoPayment>): AldoHome {
  return {
    at: ago(0),
    conversations: [],
    pullRequests: [],
    upcoming: [],
    approvals: [],
    actions: [],
    usage: {
      configured: true,
      metered: false,
      plan: null,
      period: null,
      credits: null,
      bill: null,
      alert: "none",
      agents: { running: 0, limit: null },
    },
    spends: { once: 0, monthly: 0, recent: [] },
    health: { providers: [], connected: [], environments: [] },
    policy: { everywhere: {}, workspaces: [] },
    ...(payments ? { payments } : {}),
  };
}

describe("payments waiting on the user", () => {
  it("waits while Link asks them, until its time is up, or while Link needs something of them", () => {
    expect(paymentWaits(payment("a"), NOW)).toBe(true);
    expect(paymentWaits(payment("a", { status: "created" }), NOW)).toBe(true);
    expect(paymentWaits(payment("a", { expiresAt: ago(1) }), NOW)).toBe(false);
    expect(paymentWaits(payment("a", { status: "requires_action", expiresAt: null }), NOW)).toBe(
      true,
    );
    // With no page to open, the card would have nothing to do.
    expect(paymentWaits(payment("a", { status: "requires_action", approvalUrl: null }), NOW)).toBe(
      false,
    );
    for (const status of ["approved", "submitted", "succeeded", "denied", "expired", "canceled"])
      expect(paymentWaits(payment("a", { status, approvalUrl: null }), NOW)).toBe(false);
  });

  it("comes first among decisions, the soonest to stop waiting first, and can't be put off", () => {
    const later = payment("later", { expiresAt: ago(-25) });
    const soon = payment("soon", { expiresAt: ago(-5) });
    const paid = payment("paid", { status: "succeeded", approvalUrl: null, expiresAt: null });
    const h = {
      ...home([later, soon, paid]),
      approvals: [
        {
          id: "ap1",
          kind: "email" as const,
          provider: "google" as const,
          title: "Reply",
          summary: "To maya@example.com",
          fields: [],
          body: "Hi",
          approveLabel: "Send",
          discardLabel: "Discard",
          status: "pending" as const,
          result: null,
          failed: false,
          thread: null,
          threadTitle: null,
          createdAt: ago(30),
          decidedAt: null,
        },
      ],
    };
    const decisions = aldoDecisions(h, NOW);
    expect(decisions.map((d) => d.key)).toEqual(["payment:soon", "payment:later", "aldo:ap1"]);
    expect(waitingPayments(h, NOW).map((p) => p.id)).toEqual(["soon", "later"]);
    expect(aldoWaitingCount(h, NOW)).toBe(3);
    const first = decisions[0]!;
    expect(chatDecisionOf(first)).toBeUndefined();
    expect(decisionTitle(first)).toBe("Pay $35.00 at Stripe Press");
    expect(decisionAsk(first)).toMatch(/^Approve or decline it in Link by \d{1,2}:\d{2} [AP]M\.$/);
    expect(decisionThread(first)).toEqual({ environmentId: "aldo-t1", threadId: "conv" });
    expect(decisionAt(first)).toBe(soon.createdAt);
    const brief = decisionBrief(first);
    expect(brief).toContain("Nobody but the user can approve it, in Link");
    expect(brief).toContain('asked by the thread "Buy the book"');
    expect(brief).toContain("Working in Public ($30.00)");
  });

  it("is nothing on an Aldo that doesn't send payments", () => {
    expect(aldoDecisions(home(), NOW)).toEqual([]);
    expect(waitingPayments(home(), NOW)).toEqual([]);
    expect(feedEvents(home(), { now: NOW, from: null })).toEqual([]);
  });
});

describe("what a payment says as it stands", () => {
  const says = (over: Partial<AldoPayment>) => paymentWords(payment("p", over), NOW);

  it("asks, then says how it went, from approved to paid", () => {
    expect(says({}).headline).toBe("Pay $35.00 at Stripe Press?");
    expect(says({}).tone).toBe("waiting");
    expect(says({ status: "approved" })).toMatchObject({
      headline: "Approved: $35.00 at Stripe Press",
      tone: "going",
    });
    expect(says({ status: "approved" }).line).toContain("works once, for up to $35.00");
    expect(says({ status: "submitted", cardLast4: "1984" }).line).toBe(
      "Stripe Press is charging the card. Card ending 1984.",
    );
    expect(says({ status: "succeeded", cardLast4: "1984" })).toEqual({
      headline: "Paid $35.00 at Stripe Press",
      line: "Card ending 1984. The order's details are in the conversation.",
      tone: "done",
    });
  });

  it("says nothing was paid when it didn't go, and why", () => {
    expect(says({ status: "denied" }).headline).toBe("Declined: $35.00 at Stripe Press");
    expect(says({ status: "expired" }).headline).toBe(
      "Not approved in time: $35.00 at Stripe Press",
    );
    expect(says({ status: "expired", cardLast4: "1984" }).headline).toBe(
      "The card expired unused: $35.00 at Stripe Press",
    );
    // Past its time before Aldo next reads Link: not approved in time, already.
    expect(says({ expiresAt: ago(1) }).headline).toBe(
      "Not approved in time: $35.00 at Stripe Press",
    );
    expect(says({ status: "failed" }).line).toMatch(/^Nothing was paid\./);
    expect(says({ status: "canceled" }).tone).toBe("stopped");
    expect(says({ status: "disconnected" }).line).toContain("Connect Link again");
    // Link needs something, with no page of its to open: not waiting here, and nothing to open.
    expect(says({ status: "requires_action", approvalUrl: null })).toEqual({
      headline: "Link needs something before paying $35.00 at Stripe Press",
      line: "The agent tells you in the conversation what it is.",
      tone: "going",
    });
    // A status Link adds later reads as under way, not as an error.
    expect(says({ status: "something_new" }).tone).toBe("going");
    for (const status of ["pending_approval", "requires_action", "approved", "succeeded", "failed"])
      expect(`${says({ status }).headline} ${says({ status }).line}`).not.toMatch(/!|—/);
  });
});

describe("payments in the conversation", () => {
  it("one that went on is where it came up; one still waiting is a decision, not a line", () => {
    const paid = payment("paid", {
      status: "succeeded",
      approvalUrl: null,
      expiresAt: null,
      createdAt: ago(40),
      updatedAt: ago(30),
    });
    const waiting = payment("waiting");
    const h = home([paid, waiting]);
    expect(settledPayments(h, NOW).map((p) => p.id)).toEqual(["paid"]);
    expect(feedEvents(h, { now: NOW, from: null })).toEqual([
      { kind: "payment", key: "payment:paid", at: ago(40), payment: paid },
    ]);
    // Asked before the conversation began: where it last changed.
    expect(feedEvents(h, { now: NOW, from: ago(35) }).map((e) => e.at)).toEqual([ago(30)]);
    // Before it all: not in it.
    expect(feedEvents(h, { now: NOW, from: ago(20) })).toEqual([]);
  });

  it("one that went on stays where its card was, under the reply of the turn it came up in", () => {
    const paid = payment("paid", {
      status: "succeeded",
      approvalUrl: null,
      expiresAt: null,
      createdAt: ago(40),
      updatedAt: ago(30),
    });
    type Said = { readonly at: string; readonly reply: boolean };
    const said: ReadonlyArray<Said> = [
      { at: ago(42), reply: false },
      { at: ago(39), reply: true },
      { at: ago(20), reply: false },
    ];
    const slot = (s: Said) => s;
    const events = feedEvents(home([paid]), { now: NOW, from: null });
    const where = (decided: Parameters<typeof interleaveInPlace>[3]) =>
      interleaveInPlace(said, events, slot, decided).map((item) =>
        item.kind === "events" ? "paid" : item.entry.at,
      );
    // When it came up, it'd be before the reply...
    expect(where([])).toEqual([ago(42), "paid", ago(39), ago(20)]);
    // ...but its card was under it, so it stays there.
    expect(where([{ key: "payment:paid", at: paid.createdAt }])).toEqual([
      ago(42),
      ago(39),
      "paid",
      ago(20),
    ]);
  });
});

describe("payments in simple mode's Needs you", () => {
  it("lists the ones waiting, soonest first, and counts them", () => {
    const soon = payment("soon", { expiresAt: ago(-5) });
    const later = payment("later", { expiresAt: ago(-25) });
    const paid = payment("paid", { status: "succeeded", approvalUrl: null, expiresAt: null });
    const h = home([later, paid, soon]);
    expect(simpleNeedsYou(h, NOW).payments.map((p) => p.id)).toEqual(["soon", "later"]);
    expect(aldoWaitingCount(h, NOW)).toBe(2);
    expect(simpleNeedsYou(home(), NOW).payments).toEqual([]);
  });
});
