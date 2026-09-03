import { describe, expect, it } from "vite-plus/test";

import type { AldoWorkspaceUsage } from "../../state/aldoWorkspaceUsage";
import {
  aldoUsageAlertCopy,
  aldoUsageFacts,
  aldoUsageFootnote,
  aldoUsageMeterFraction,
  aldoUsageUnmeteredCopy,
} from "./aldoWorkspaceUsageView";

const metered: AldoWorkspaceUsage = {
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
    used: 40.25,
    included: 250,
    authorized: 300,
    remaining: 259.75,
    includedRemaining: 209.75,
    overageRemaining: 50,
    projected: 80.5,
  },
  bill: { estimatedCents: 9_900, projectedCents: 9_900, spendLimitCents: 11_900 },
  machine: {
    class: "full_power",
    label: "Full Power",
    creditsPerHour: 2,
    status: "running",
    lifecyclePending: false,
  },
  alert: "none",
  updatedAt: "2026-09-03T10:00:00.000Z",
};

describe("aldoUsageFacts", () => {
  it("lays out plan, balances, bill, and hardware in reading order", () => {
    expect(aldoUsageFacts(metered)).toEqual([
      { label: "Plan", value: "Pro · 250 included" },
      { label: "Included left", value: "209.8" },
      { label: "Added capacity left", value: "50" },
      { label: "Projected at renewal", value: "80.5 credits" },
      { label: "Estimated total", value: "$99.00" },
      { label: "Hardware", value: "Full Power · 2 credits/hour" },
    ]);
  });

  it("shows only hardware for an unmetered workspace and a dash for no projection", () => {
    const complimentary: AldoWorkspaceUsage = {
      ...metered,
      metered: false,
      plan: null,
      period: null,
      credits: null,
      bill: null,
      machine: { ...metered.machine!, class: "standard", label: "Standard", creditsPerHour: 1 },
      updatedAt: null,
    };
    expect(aldoUsageFacts(complimentary)).toEqual([
      { label: "Hardware", value: "Standard · 1 credit/hour" },
    ]);
    expect(aldoUsageUnmeteredCopy(complimentary)).toMatch(/complimentary/);
    expect(aldoUsageUnmeteredCopy({ ...complimentary, configured: false })).toMatch(
      /not configured/,
    );

    expect(
      aldoUsageFacts({ ...metered, credits: { ...metered.credits!, projected: null } }).find(
        (fact) => fact.label === "Projected at renewal",
      )?.value,
    ).toBe("—");
  });
});

describe("aldoUsageMeterFraction", () => {
  it("clamps to the authorized ceiling and survives a zero ceiling", () => {
    expect(aldoUsageMeterFraction(metered.credits!)).toBeCloseTo(40.25 / 300);
    expect(aldoUsageMeterFraction({ ...metered.credits!, used: 400 })).toBe(1);
    expect(aldoUsageMeterFraction({ ...metered.credits!, used: 0, authorized: 0 })).toBe(0);
    expect(aldoUsageMeterFraction({ ...metered.credits!, used: 3, authorized: 0 })).toBe(1);
  });
});

describe("aldoUsageFootnote", () => {
  it("names the refresh time and the renewal, and says when a cycle ends instead", () => {
    expect(aldoUsageFootnote(metered)).toMatch(/^Updated Sep 3, .* · Resets Sep 1[45]$/);
    expect(
      aldoUsageFootnote({ ...metered, period: { ...metered.period!, cancelAtPeriodEnd: true } }),
    ).toMatch(/· Ends Sep 1[45]$/);
    expect(aldoUsageFootnote({ ...metered, updatedAt: null, period: null })).toBeNull();
  });
});

describe("aldoUsageAlertCopy", () => {
  it("is silent at the default level and speaks at every warning level", () => {
    expect(aldoUsageAlertCopy("none")).toBeNull();
    for (const level of [
      "included_warning",
      "included_exhausted",
      "spend_warning",
      "spend_reached",
    ] as const) {
      expect(aldoUsageAlertCopy(level)).toEqual(expect.any(String));
    }
  });
});
