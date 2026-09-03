import { describe, expect, it } from "vite-plus/test";

import { isAldoWorkspaceUsage } from "./aldoWorkspaceUsage";

const metered = {
  configured: true,
  metered: true,
  plan: { id: "starter", name: "Starter", includedCredits: 60 },
  period: {
    status: "active",
    start: "2026-08-15T00:00:00.000Z",
    end: "2026-09-15T00:00:00.000Z",
    cancelAtPeriodEnd: false,
  },
  credits: {
    used: 12,
    included: 60,
    authorized: 60,
    remaining: 48,
    includedRemaining: 48,
    overageRemaining: 0,
    projected: 30,
  },
  bill: { estimatedCents: 2_900, projectedCents: 2_900, spendLimitCents: 2_900 },
  machine: {
    class: "standard",
    label: "Standard",
    creditsPerHour: 1,
    status: "running",
    lifecyclePending: false,
  },
  alert: "none",
  updatedAt: "2026-09-03T10:00:00.000Z",
};

describe("isAldoWorkspaceUsage", () => {
  it("accepts metered and unmetered gateway summaries", () => {
    expect(isAldoWorkspaceUsage(metered)).toBe(true);
    expect(
      isAldoWorkspaceUsage({
        configured: false,
        metered: false,
        plan: null,
        period: null,
        credits: null,
        bill: null,
        machine: null,
        alert: "none",
        updatedAt: null,
      }),
    ).toBe(true);
    expect(
      isAldoWorkspaceUsage({ ...metered, credits: { ...metered.credits, projected: null } }),
    ).toBe(true);
  });

  it("rejects shapes this build cannot render truthfully", () => {
    expect(isAldoWorkspaceUsage(null)).toBe(false);
    expect(isAldoWorkspaceUsage({ error: { code: "GATEWAY_SESSION_EXPIRED" } })).toBe(false);
    expect(isAldoWorkspaceUsage({ ...metered, alert: "on_fire" })).toBe(false);
    expect(isAldoWorkspaceUsage({ ...metered, credits: { ...metered.credits, used: "12" } })).toBe(
      false,
    );
    expect(isAldoWorkspaceUsage({ ...metered, credits: { ...metered.credits, used: NaN } })).toBe(
      false,
    );
    expect(isAldoWorkspaceUsage({ ...metered, machine: { ...metered.machine, class: "xl" } })).toBe(
      false,
    );
    // A metered summary must carry its numbers; a half-summary is a mismatch, not data.
    expect(isAldoWorkspaceUsage({ ...metered, credits: null })).toBe(false);
  });
});
