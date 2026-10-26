import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../aldo/api", () => ({ isAldoCloud: true }));

import type { AldoWorkspaceUsage } from "../../state/aldoWorkspaceUsage";
import { aldoUsageAlertCopy } from "./aldoWorkspaceUsageView";

const usage: AldoWorkspaceUsage = {
  configured: true,
  metered: true,
  plan: { id: "pro", name: "Pro", includedCredits: 250 },
  period: {
    status: "active",
    start: "2026-08-15T00:00:00.000Z",
    end: "2026-09-15T00:00:00.000Z",
    cancelAtPeriodEnd: false,
  },
  credits: {
    used: 300,
    included: 250,
    authorized: 300,
    remaining: 0,
    includedRemaining: 0,
    overageRemaining: 0,
    projected: null,
  },
  bill: {
    estimatedCents: 12_000,
    projectedCents: null,
    spendLimitCents: 2_000,
    extraCentsPerCredit: 1.25,
  },
  machine: null,
  alert: "spend_reached",
  updatedAt: "2026-09-03T10:00:00.000Z",
};

describe("aldoUsageAlertCopy on Aldo cloud", () => {
  it("tells someone on their own plan to raise their limit", () => {
    expect(aldoUsageAlertCopy("spend_reached", usage)).toBe(
      "Your credits and extra usage limit are used up, so agents can't start. Raise the limit to keep going.",
    );
    expect(aldoUsageAlertCopy("included_warning", usage)).toContain("800 credits for $10");
  });

  it("sends a seat to its organization's admins, whose limit it is", () => {
    const seat = { ...usage, seat: { org: "Linden", admins: ["maya@linden.com"] } };
    expect(aldoUsageAlertCopy("spend_reached", seat)).toBe(
      "Your credits and extra usage limit are used up, so agents can't start. Ask maya@linden.com for a higher limit.",
    );
    expect(aldoUsageAlertCopy("spend_warning", seat)).toBe(
      "Extra usage is close to your limit. Ask maya@linden.com for a higher limit.",
    );
    expect(aldoUsageAlertCopy("included_exhausted", seat)).toBe(
      "This month's included credits are used up, and extra usage is off. Ask maya@linden.com to turn it on.",
    );
    // The price is the organization's to pay, not theirs.
    expect(aldoUsageAlertCopy("included_warning", seat)).toBe(
      "This month's included credits are running low. Past them, agents keep working up to your extra usage limit.",
    );
    // With no one else to ask, it says whose limit it is.
    const alone = { ...usage, seat: { org: "Linden", admins: [] } };
    expect(aldoUsageAlertCopy("spend_reached", alone)).toBe(
      "Your credits and extra usage limit are used up, so agents can't start. Linden sets your extra usage limit.",
    );
  });
});
