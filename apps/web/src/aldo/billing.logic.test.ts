import { describe, expect, it } from "vite-plus/test";

import type { AldoWorkspaceUsage } from "../state/aldoWorkspaceUsage";
import { isAldoWorkspaceUsage } from "../state/aldoWorkspaceUsage";
import {
  aldoBillingActionsEnabled,
  aldoBillingView,
  aldoCancelCopy,
  aldoCheckedOutPlan,
  aldoCheckoutReturn,
  aldoPlanChange,
  aldoPlanChangeCopy,
  aldoPlanChangedCopy,
  aldoPlanSummary,
  aldoPlanTerms,
  formatPlanPrice,
  isAldoBilling,
  withoutAldoCheckoutReturn,
  type AldoBilling,
  type AldoBillingPlan,
} from "./billing.logic";

const plus: AldoBillingPlan = {
  id: "plus",
  name: "Plus",
  priceCents: 2_000,
  credits: 2_000,
  concurrent: 3,
};
const pro: AldoBillingPlan = {
  id: "pro",
  name: "Pro",
  priceCents: 6_000,
  credits: 10_000,
  concurrent: 6,
};
const max: AldoBillingPlan = {
  id: "max",
  name: "Max",
  priceCents: 20_000,
  credits: 30_000,
  concurrent: 15,
};

const billing: AldoBilling = {
  enabled: true,
  managed: true,
  pendingPlan: null,
  pastDue: false,
  // Out of order on purpose: the page lists them by price.
  plans: [pro, plus, max],
};

// Midday, so the day is the same in every time zone the tests run in.
const PERIOD_END = "2026-10-31T12:00:00.000Z";

const onPro: AldoWorkspaceUsage = {
  configured: true,
  metered: true,
  plan: { id: "pro", name: "Pro", includedCredits: 10_000 },
  period: {
    status: "active",
    start: "2026-10-01T12:00:00.000Z",
    end: PERIOD_END,
    cancelAtPeriodEnd: false,
  },
  credits: {
    used: 1_000,
    included: 10_000,
    authorized: 11_600,
    remaining: 10_600,
    includedRemaining: 9_000,
    overageRemaining: 1_600,
    projected: 4_000,
  },
  bill: { estimatedCents: 6_000, projectedCents: 6_000, spendLimitCents: 2_000 },
  machine: null,
  alert: "none",
  updatedAt: null,
  billing,
};

const noPlan: AldoWorkspaceUsage = {
  ...onPro,
  configured: false,
  metered: false,
  plan: null,
  period: null,
  credits: null,
  bill: null,
  billing: { ...billing, managed: false },
};

function managed(usage: AldoWorkspaceUsage) {
  const view = aldoBillingView(usage);
  if (view?.kind !== "managed") throw new Error(`expected a managed plan, got ${view?.kind}`);
  return view;
}

function changes(usage: AldoWorkspaceUsage) {
  return Object.fromEntries(
    managed(usage).options.map((option) => [option.plan.id, option.change]),
  );
}

describe("isAldoBilling", () => {
  it("accepts Aldo's billing and usage with or without it", () => {
    expect(isAldoBilling(billing)).toBe(true);
    expect(isAldoBilling({ ...billing, pendingPlan: "plus", plans: [] })).toBe(true);
    expect(isAldoWorkspaceUsage(onPro)).toBe(true);
    const { billing: _left, ...older } = onPro;
    expect(isAldoWorkspaceUsage(older)).toBe(true);
  });

  it("rejects a shape this build would misread", () => {
    expect(isAldoBilling(null)).toBe(false);
    expect(isAldoBilling({ ...billing, pastDue: "no" })).toBe(false);
    expect(isAldoBilling({ ...billing, plans: [{ ...plus, priceCents: "20" }] })).toBe(false);
    expect(isAldoWorkspaceUsage({ ...onPro, billing: { enabled: true } })).toBe(false);
  });
});

describe("aldoBillingView", () => {
  it("adds nothing for an older Aldo, without Stripe, or for a complimentary account", () => {
    const { billing: _left, ...older } = onPro;
    expect(aldoBillingView(older)).toBeNull();
    expect(aldoBillingView({ ...onPro, billing: { ...billing, enabled: false } })).toBeNull();
    expect(
      aldoBillingView({ ...noPlan, configured: true, billing: { ...billing, managed: false } }),
    ).toBeNull();
  });

  it("offers every plan, cheapest first, to someone without one", () => {
    const view = aldoBillingView(noPlan);
    expect(view).toEqual({ kind: "choose", plans: [plus, pro, max], ended: null });
    expect(aldoPlanSummary(view!)).toBeNull();
    expect(aldoBillingView({ ...onPro, configured: true, plan: null })).toMatchObject({
      kind: "choose",
    });
  });

  it("offers the plans again once a plan has ended, and names it", () => {
    const ended: AldoWorkspaceUsage = {
      ...onPro,
      period: { ...onPro.period!, status: "canceled" },
      billing: { ...billing, managed: false },
    };
    const view = aldoBillingView(ended);
    expect(view).toMatchObject({ kind: "choose", ended: "Pro" });
    expect(aldoPlanSummary(view!)).toBe(
      "Your Pro plan has ended, so cloud agents can't start. Choose a plan to keep going.",
    );
  });

  it("shows a plan an admin set, with nothing to change", () => {
    const view = aldoBillingView({ ...onPro, billing: { ...billing, managed: false } });
    expect(view).toEqual({
      kind: "fixed",
      plan: onPro.plan,
      periodEnd: PERIOD_END,
    });
    expect(aldoPlanSummary(view!)).toBe("Pro, set by your Aldo admin. Renews on Oct 31.");
  });

  it("offers an upgrade to pricier plans and a downgrade to cheaper ones", () => {
    const view = managed(onPro);
    expect(view.current).toEqual(pro);
    expect(view.options.map((option) => [option.plan.id, option.current])).toEqual([
      ["plus", false],
      ["pro", true],
      ["max", false],
    ]);
    expect(changes(onPro)).toEqual({ plus: "downgrade", pro: null, max: "upgrade" });
    expect(aldoPlanSummary(view)).toBe("Pro · $60 a month · Renews on Oct 31");
  });

  it("marks a pending downgrade's plan instead of offering it again", () => {
    const pending = { ...onPro, billing: { ...billing, pendingPlan: "plus" } };
    const view = managed(pending);
    expect(view.pending).toEqual(plus);
    expect(view.options.find((option) => option.pending)?.plan).toEqual(plus);
    expect(changes(pending)).toEqual({ plus: null, pro: null, max: "upgrade" });
    expect(aldoPlanSummary(view)).toBe("Pro · $60 a month");
  });

  it("keeps a pending downgrade to a plan Aldo no longer offers, named by its id", () => {
    const retired = { ...onPro, billing: { ...billing, pendingPlan: "starter" } };
    const view = managed(retired);
    // Still shown (and so still undoable with Keep Pro), not dropped as unknown.
    expect(view.pending).toEqual({ id: "starter", name: "starter" });
    expect(aldoPlanSummary(view)).toBe("Pro · $60 a month");
    expect(view.options.some((option) => option.pending)).toBe(false);
    expect(changes(retired)).toEqual({ plus: "downgrade", pro: null, max: "upgrade" });
  });

  it("offers no switching while the plan is ending or unpaid", () => {
    const canceling = {
      ...onPro,
      period: { ...onPro.period!, cancelAtPeriodEnd: true },
    };
    expect(managed(canceling).canceling).toBe(true);
    expect(changes(canceling)).toEqual({ plus: null, pro: null, max: null });
    expect(aldoPlanSummary(managed(canceling))).toBe("Pro · $60 a month");

    const pastDue = { ...onPro, period: { ...onPro.period!, status: "past_due" } };
    const unpaid = { ...pastDue, billing: { ...billing, pastDue: true } };
    expect(managed(unpaid).pastDue).toBe(true);
    expect(changes(unpaid)).toEqual({ plus: null, pro: null, max: null });
  });

  it("keeps a plan Aldo no longer offers manageable, without comparing prices", () => {
    const legacy = { ...onPro, plan: { id: "starter", name: "Starter", includedCredits: 600 } };
    const view = managed(legacy);
    expect(view.current).toBeNull();
    expect(changes(legacy)).toEqual({ plus: null, pro: null, max: null });
    expect(aldoPlanSummary(view)).toBe("Starter · Renews on Oct 31");
  });
});

describe("plan copy", () => {
  it("prices and describes a plan", () => {
    expect(formatPlanPrice(2_000)).toBe("$20");
    expect(formatPlanPrice(1_950)).toBe("$19.50");
    expect(aldoPlanTerms(pro)).toEqual([
      "$60 a month",
      "10,000 credits a month",
      "6 agents at once",
    ]);
    expect(aldoPlanTerms({ ...plus, concurrent: 1 })[2]).toBe("1 agent at once");
  });

  it("says an upgrade starts now and what it charges", () => {
    expect(aldoPlanChange(plus, pro)).toBe("upgrade");
    expect(aldoPlanChangeCopy(plus, pro, PERIOD_END)).toEqual({
      title: "Upgrade to Pro?",
      description:
        "Pro starts now with 10,000 credits and 6 agents at once. You're charged $60 today, minus the unused part of Plus.",
      confirm: "Upgrade to Pro",
    });
  });

  it("says a downgrade happens when the period ends", () => {
    expect(aldoPlanChange(pro, plus)).toBe("downgrade");
    expect(aldoPlanChangeCopy(pro, plus, PERIOD_END)).toMatchObject({
      title: "Downgrade to Plus?",
      description: expect.stringMatching(/^Your plan becomes Plus on Oct 31, .* keep Pro\.$/),
    });
    expect(aldoPlanChangeCopy(pro, plus, null).description).toMatch(
      /^Your plan becomes Plus at the end of this period, /,
    );
  });

  it("says when canceling ends the plan, and what a change did", () => {
    expect(aldoCancelCopy("Pro", PERIOD_END)).toMatchObject({
      title: "Cancel your plan?",
      description: expect.stringMatching(/^Pro ends on Oct 31, /),
      confirm: "Cancel plan",
    });
    expect(aldoPlanChangedCopy("Max", "now", PERIOD_END, false)).toBe("You're on Max");
    expect(aldoPlanChangedCopy("Plus", "period_end", PERIOD_END, false)).toBe(
      "Your plan becomes Plus on Oct 31",
    );
    expect(aldoPlanChangedCopy("Pro", "period_end", PERIOD_END, true)).toBe(
      "You're staying on Pro",
    );
  });
});

describe("checkout return", () => {
  it("reads Stripe's return and takes it out of the query", () => {
    expect(aldoCheckoutReturn("?checkout=done")).toBe("done");
    expect(aldoCheckoutReturn("?checkout=canceled&x=1")).toBe("canceled");
    expect(aldoCheckoutReturn("?checkout=other")).toBeNull();
    expect(aldoCheckoutReturn("")).toBeNull();
    expect(withoutAldoCheckoutReturn("?checkout=done")).toBe("");
    expect(withoutAldoCheckoutReturn("?x=1&checkout=done")).toBe("?x=1");
  });

  it("waits for a running Stripe plan, not an ended or admin-set one", () => {
    expect(aldoCheckedOutPlan(onPro, null)).toBe("Pro");
    expect(aldoCheckedOutPlan(null, null)).toBeNull();
    expect(aldoCheckedOutPlan(noPlan, null)).toBeNull();
    expect(
      aldoCheckedOutPlan(
        {
          ...onPro,
          period: { ...onPro.period!, status: "canceled" },
          billing: { ...billing, managed: false },
        },
        null,
      ),
    ).toBeNull();
    expect(
      aldoCheckedOutPlan({ ...onPro, billing: { ...billing, managed: false } }, null),
    ).toBeNull();
    const { billing: _left, ...older } = onPro;
    expect(aldoCheckedOutPlan(older, null)).toBe("Pro");
  });

  it("waits for the plan that was bought, not the one the user still has", () => {
    // Bought Max from Pro (no Stripe subscription after all): Aldo shows Pro until Stripe says.
    expect(aldoCheckedOutPlan(onPro, "max")).toBeNull();
    expect(
      aldoCheckedOutPlan(
        { ...onPro, plan: { id: "max", name: "Max", includedCredits: 30_000 } },
        "max",
      ),
    ).toBe("Max");
  });
});

describe("aldoBillingActionsEnabled", () => {
  it("allows one request at a time, and only on a current summary", () => {
    expect(aldoBillingActionsEnabled("ready", null)).toBe(true);
    expect(aldoBillingActionsEnabled("ready", "portal")).toBe(false);
    // Refreshing, or the refresh failed: the plan shown may be out of date.
    expect(aldoBillingActionsEnabled("loading", null)).toBe(false);
    expect(aldoBillingActionsEnabled("error", null)).toBe(false);
    expect(aldoBillingActionsEnabled("unavailable", null)).toBe(false);
  });
});
