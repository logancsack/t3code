import { describe, expect, it } from "vite-plus/test";

import {
  checkoutFailureWords,
  checkoutReturnOf,
  confirmAgainIn,
  extraUsageLabel,
  extraUsageOffer,
  keptOf,
  keptStep,
  needsPlanOf,
  pickerLines,
  resumedOf,
  saidAlready,
  sendingWords,
  withoutCheckoutReturn,
  type AldoKept,
} from "./planPicker.logic";

const plans = [
  {
    id: "starter",
    name: "Starter",
    priceCents: 2000,
    credits: 2000,
    concurrent: 3,
    lines: ["2,000 credits a month (200 machine hours)", "3 agents at once"],
  },
  { id: "pro", name: "Pro", priceCents: 5000, credits: 6000, concurrent: 6, lines: [] },
];

const needsPlan = {
  requestId: "pr_abc123def456",
  text: "Make a deck from my notes",
  reason: "none",
  say: "I’ll start as soon as you choose a plan. Your request is saved, so you won’t need to type it again.",
  plans,
  note: "Renews monthly. Change or cancel any time on the Usage page.",
};

const refusal = { error: "Choose a plan on the Usage page to start.", needsPlan };

describe("needsPlanOf", () => {
  it("reads the picker from a refusal that kept the request", () => {
    const needs = needsPlanOf(refusal);
    expect(needs?.requestId).toBe("pr_abc123def456");
    expect(needs?.reason).toBe("none");
    expect(needs?.plans.map((p) => p.id)).toEqual(["starter", "pro"]);
    expect(needs?.note).toBe("Renews monthly. Change or cancel any time on the Usage page.");
  });

  it("is null for an older Aldo's plain refusal, and for one with nothing to choose", () => {
    expect(needsPlanOf({ error: "Choose a plan on the Usage page to start." })).toBeNull();
    expect(needsPlanOf(null)).toBeNull();
    expect(needsPlanOf("Choose a plan")).toBeNull();
    expect(needsPlanOf({ error: "x", needsPlan: { ...needsPlan, plans: [] } })).toBeNull();
    expect(needsPlanOf({ error: "x", needsPlan: { ...needsPlan, reason: "unpaid" } })).toBeNull();
    expect(needsPlanOf({ error: "x", needsPlan: { ...needsPlan, requestId: "" } })).toBeNull();
  });

  it("skips plans it can't read, and lines that aren't words", () => {
    const needs = needsPlanOf({
      needsPlan: {
        ...needsPlan,
        plans: [{ id: "x" }, { ...plans[0], lines: ["3 agents at once", 4, ""] }],
      },
    });
    expect(needs?.plans).toHaveLength(1);
    expect(needs?.plans[0]?.lines).toEqual(["3 agents at once"]);
  });
});

describe("keptOf", () => {
  it("reads what Aldo keeps, with the picker while a plan is what it waits for", () => {
    const kept = keptOf({
      pending: {
        id: "pr_abc123def456",
        text: "Make a deck",
        at: "2026-10-20T10:00:00Z",
        images: 1,
      },
      needsPlan,
    });
    expect(kept?.pending).toEqual({
      id: "pr_abc123def456",
      text: "Make a deck",
      at: "2026-10-20T10:00:00Z",
      images: 1,
    });
    expect(kept?.needsPlan?.requestId).toBe("pr_abc123def456");
  });

  it("is null where Aldo doesn't keep requests, and empty when there's none", () => {
    expect(keptOf(null)).toBeNull();
    expect(keptOf({ error: "Not found" })).toBeNull();
    expect(keptOf({ pending: null, needsPlan: null })).toEqual({ pending: null, needsPlan: null });
  });
});

describe("the way back from Checkout", () => {
  it("reads the kept request and Checkout's session", () => {
    expect(checkoutReturnOf("?resume=pr_abc123def456&session_id=cs_test_a1B2")).toEqual({
      requestId: "pr_abc123def456",
      checkoutSession: "cs_test_a1B2",
    });
    expect(checkoutReturnOf("?resume=pr_abc123def456")).toEqual({
      requestId: "pr_abc123def456",
      checkoutSession: null,
    });
  });

  it("ignores what isn't one", () => {
    expect(checkoutReturnOf("")).toBeNull();
    expect(checkoutReturnOf("?resume=1")).toBeNull();
    expect(checkoutReturnOf("?resume=pr_abc123def456&session_id={CHECKOUT_SESSION_ID}")).toEqual({
      requestId: "pr_abc123def456",
      checkoutSession: null,
    });
  });

  it("takes it out of the address, keeping the rest", () => {
    expect(withoutCheckoutReturn("?resume=pr_abc123def456&session_id=cs_1")).toBe("");
    expect(withoutCheckoutReturn("?resume=pr_abc123def456&session_id=cs_1&tab=home")).toBe(
      "?tab=home",
    );
    expect(withoutCheckoutReturn("?tab=home")).toBe("?tab=home");
  });
});

describe("keptStep", () => {
  const request = {
    id: "pr_abc123def456",
    text: "Make a deck",
    at: "2026-10-20T10:00:00Z",
    images: 0,
  };
  const needs = needsPlanOf(refusal)!;
  const returning = { requestId: "pr_abc123def456", checkoutSession: "cs_1" };

  it("does nothing without a kept request", () => {
    expect(keptStep(null, { pending: null, needsPlan: null })).toEqual({ kind: "nothing" });
    expect(keptStep(null, null)).toEqual({ kind: "nothing" });
    // Back, but Aldo says none is kept (sent already from another tab).
    expect(keptStep(returning, { pending: null, needsPlan: null })).toEqual({ kind: "nothing" });
  });

  it("shows it again with the picker while there's still no plan", () => {
    const kept: AldoKept = { pending: request, needsPlan: needs };
    expect(keptStep(null, kept)).toEqual({ kind: "pick", request, needs });
  });

  it("sends it back from Checkout, even before Stripe confirms the plan", () => {
    expect(keptStep(returning, { pending: request, needsPlan: needs })).toEqual({
      kind: "resume",
      requestId: request.id,
      request,
      needs,
      checkoutSession: "cs_1",
      returning: true,
    });
  });

  it("sends it on a later load once a plan's on (the tab was closed)", () => {
    expect(keptStep(null, { pending: request, needsPlan: null })).toEqual({
      kind: "resume",
      requestId: request.id,
      request,
      needs: null,
      checkoutSession: null,
      returning: false,
    });
  });

  it("sends the latest kept, whichever the way back named", () => {
    const latest = { ...request, id: "pr_zzz999yyy888", text: "Price my services" };
    const step = keptStep(returning, { pending: latest, needsPlan: null });
    expect(step.kind === "resume" && step.requestId).toBe("pr_zzz999yyy888");
  });

  it("shows the picker again back from a Checkout that wasn't paid (no session)", () => {
    const canceled = { requestId: "pr_abc123def456", checkoutSession: null };
    expect(keptStep(canceled, { pending: request, needsPlan: needs })).toEqual({
      kind: "pick",
      request,
      needs,
    });
    expect(keptStep(canceled, null)).toEqual({ kind: "nothing" });
  });

  it("still asks back from Checkout when Aldo couldn't say what it keeps", () => {
    expect(keptStep(returning, null)).toEqual({
      kind: "resume",
      requestId: "pr_abc123def456",
      request: null,
      needs: null,
      checkoutSession: "cs_1",
      returning: true,
    });
  });
});

describe("resumedOf", () => {
  it("reads a sent request, with the plan it went on", () => {
    expect(
      resumedOf({
        ok: true,
        body: {
          sessionId: "as_1",
          reply: "On it.",
          calls: [],
          resumed: { id: "pr_abc123def456", text: "Make a deck", plan: "Starter" },
        },
      }),
    ).toEqual({
      kind: "sent",
      turn: { sessionId: "as_1", reply: "On it.", calls: [] },
      text: "Make a deck",
      plan: "Starter",
    });
  });

  it("reads one that's gone (sent already, or not kept)", () => {
    expect(resumedOf({ ok: true, body: { resumed: null } })).toEqual({ kind: "gone" });
  });

  it("reads the picker again, or a refusal a plan doesn't fix", () => {
    expect(resumedOf({ ok: false, status: 402, message: "x", body: refusal }).kind).toBe(
      "needsPlan",
    );
    expect(
      resumedOf({
        ok: false,
        status: 402,
        message: "Your last payment didn’t go through.",
        body: { error: "Your last payment didn’t go through." },
      }),
    ).toEqual({ kind: "refused", message: "Your last payment didn’t go through." });
  });

  it("reads anything else as failed, so the page checks whether it went", () => {
    expect(resumedOf({ ok: false, status: 500, message: "Aldo is down.", body: null })).toEqual({
      kind: "failed",
      message: "Aldo is down.",
    });
    // An older Aldo answers a resume as a chat turn without one: not sent as the request.
    expect(resumedOf({ ok: true, body: { sessionId: "as_1", reply: "Hi", calls: [] } }).kind).toBe(
      "failed",
    );
    expect(resumedOf({ ok: true, body: { resumed: { id: "pr_1" } } }).kind).toBe("failed");
  });
});

describe("saidAlready", () => {
  it("finds the user's words, with Aldo's notes of images after them", () => {
    const messages = [
      { role: "assistant", text: "Make a deck" },
      { role: "user", text: "Make a deck\n\n[image img_1: notes.png]" },
    ];
    expect(saidAlready(messages, "Make a deck")).toBe(true);
    expect(saidAlready(messages.slice(0, 1), "Make a deck")).toBe(false);
    expect(saidAlready(messages, "  ")).toBe(false);
  });
});

describe("confirmAgainIn", () => {
  it("asks again for about 20 seconds, then stops", () => {
    const waits: number[] = [];
    for (let attempt = 0; ; attempt++) {
      const wait = confirmAgainIn(attempt);
      if (wait === null) break;
      waits.push(wait);
    }
    expect(waits.length).toBeGreaterThan(0);
    expect(waits.reduce((a, b) => a + b, 0)).toBe(21_500);
  });
});

describe("what the picker shows", () => {
  it("uses Aldo's lines, or the plan's credits and agents", () => {
    expect(pickerLines(needsPlanOf(refusal)!.plans[0]!)).toEqual([
      "2,000 credits a month (200 machine hours)",
      "3 agents at once",
    ]);
    expect(pickerLines(needsPlanOf(refusal)!.plans[1]!)).toEqual([
      "6,000 credits a month",
      "6 agents at once",
    ]);
  });

  it("offers extra usage only where Aldo's Checkout takes the choice", () => {
    expect(extraUsageOffer({ extraUsage: { limitCents: 2000 } })).toBe(2000);
    expect(extraUsageOffer({})).toBeNull();
    expect(extraUsageOffer(null)).toBeNull();
    expect(extraUsageOffer({ extraUsage: { limitCents: 0 } })).toBeNull();
    expect(extraUsageOffer({ extraUsage: true })).toBeNull();
    expect(extraUsageLabel(2000).hint).toContain("billed up to $20 a month");
  });
});

describe("sendingWords", () => {
  const kept: AldoKept = {
    pending: { id: "pr_abc123def456", text: "Make a deck", at: "2026-10-20T10:00:00Z", images: 0 },
    needsPlan: null,
  };
  const wordsOn = (search: string) => {
    const step = keptStep(checkoutReturnOf(search), kept);
    return step.kind === "resume" ? sendingWords(step.checkoutSession) : null;
  };

  it("confirms the plan only back from Checkout", () => {
    expect(wordsOn("?resume=pr_abc123def456&session_id=cs_test_a1")).toBe("Confirming your plan");
  });

  it("says the request is going when no Checkout came back (a plan on already)", () => {
    expect(wordsOn("?resume=pr_abc123def456")).toBe("Sending your request");
    expect(wordsOn("?resume=pr_abc123def456&session_id=nope")).toBe("Sending your request");
    expect(wordsOn("")).toBe("Sending your request");
  });
});

describe("checkoutFailureWords", () => {
  const failed =
    "Aldo couldn’t open Checkout just now, so nothing was charged. Your request is saved. Try again in a moment.";

  it("keeps a payment provider's raw error out, from an Aldo that failed", () => {
    const stripe = "No such price: 'price_1Q2w3E4r5T6y'";
    expect(checkoutFailureWords({ status: 500, message: stripe, body: { error: stripe } })).toBe(
      failed,
    );
    // A gateway's page: no words from Aldo at all.
    expect(checkoutFailureWords({ status: 504, message: "Request failed (504)", body: {} })).toBe(
      failed,
    );
    // A newer Aldo says its failure in words for people too, but the picker's say the request is saved.
    const said =
      "Aldo couldn’t open Checkout just now, so nothing was charged. Try again in a moment.";
    expect(checkoutFailureWords({ status: 502, message: said, body: { error: said } })).toBe(
      failed,
    );
  });

  it("says Aldo's own words for a refusal", () => {
    const verify = "Verify your email address to continue.";
    expect(checkoutFailureWords({ status: 403, message: verify, body: { error: verify } })).toBe(
      verify,
    );
    expect(
      checkoutFailureWords({ status: 403, message: "Request failed (403)", body: { error: " " } }),
    ).toBe(failed);
    expect(
      checkoutFailureWords({ status: 401, message: "Your Aldo session ended. Sign in again." }),
    ).toBe("Your Aldo session ended. Sign in again.");
  });

  it("says when Aldo couldn't be reached", () => {
    expect(checkoutFailureWords(null)).toBe(
      "Aldo couldn’t be reached, so Checkout didn’t open and nothing was charged. Your request is saved. Check your connection and try again.",
    );
  });
});
