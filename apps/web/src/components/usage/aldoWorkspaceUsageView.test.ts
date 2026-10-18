import { describe, expect, it } from "vite-plus/test";

import type { AldoWorkspaceUsage } from "../../state/aldoWorkspaceUsage";
import {
  aldoUsageAlertCopy,
  aldoUsageFacts,
  aldoUsageFootnote,
  aldoUsageMeterFraction,
  aldoUsageSentence,
  aldoUsageUnmeteredCopy,
  aldoWindowsDiskCopy,
  formatBytes,
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
  it("adds Aldo's allowances and storage before the hardware, when Aldo reports them", () => {
    const facts = aldoUsageFacts({
      ...metered,
      prime: {
        deepAsks: { used: 12, included: 100 },
        voiceMinutes: { used: 3.5, included: 40 },
        texts: { used: 20, included: 100 },
        quickReplies: { usedPercent: 4 },
      },
      storage: { usedBytes: 1.2 * 1024 ** 3, includedBytes: 10 * 1024 ** 3 },
    });
    expect(facts.slice(5)).toEqual([
      { label: "Aldo's deep asks", value: "12 of 100" },
      { label: "Voice minutes", value: "3.5 of 40" },
      { label: "Texts with Aldo", value: "20 of 100" },
      { label: "Quick replies", value: "4% of fair use" },
      { label: "Storage", value: "1.2 GB of 10 GB" },
      { label: "Hardware", value: "Full Power · 2 credits/hour" },
    ]);
    // Without a plan Aldo says null: nothing to show.
    expect(aldoUsageFacts({ ...metered, prime: null })).toEqual(aldoUsageFacts(metered));
  });

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

  it("shows what's left for Aldo's models, when Aldo reports it", () => {
    const facts = aldoUsageFacts({
      ...metered,
      credits: { ...metered.credits!, ai: 30, aiIncluded: 100, aiRemaining: 70 },
    });
    expect(facts[2]).toEqual({ label: "Aldo's models left", value: "70 of 100" });
    expect(aldoUsageFacts(metered)).not.toContainEqual(
      expect.objectContaining({ label: "Aldo's models left" }),
    );
  });

  it("shows the economy lane once the authorized credits are used, when the gateway reports it", () => {
    const economy: AldoWorkspaceUsage = {
      ...metered,
      credits: {
        ...metered.credits!,
        used: 300,
        remaining: 0,
        economyIncluded: 125,
        economyRemaining: 100,
      },
    };
    expect(aldoUsageFacts(economy)).toContainEqual({ label: "Economy lane left", value: "100" });
    expect(
      aldoUsageFacts({ ...economy, credits: { ...economy.credits!, used: 299 } }),
    ).not.toContainEqual(expect.objectContaining({ label: "Economy lane left" }));
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

describe("aldoUsageSentence", () => {
  it("says what's used and what the pace leaves", () => {
    expect(aldoUsageSentence(metered)).toBe(
      "You've used 40.3 of 250 credits this month; at this pace you'll have about 170 left.",
    );
  });

  it("says when the pace runs past the plan, or out", () => {
    const credits = metered.credits!;
    expect(aldoUsageSentence({ ...metered, credits: { ...credits, projected: 280 } })).toBe(
      "You've used 40.3 of 250 credits this month; at this pace you'll go about 30 over, within your extra usage limit.",
    );
    expect(aldoUsageSentence({ ...metered, credits: { ...credits, projected: 400 } })).toBe(
      "You've used 40.3 of 250 credits this month; at this pace you'll run out before the month ends.",
    );
    expect(
      aldoUsageSentence({
        ...metered,
        credits: { ...credits, projected: 400, economyIncluded: 125, economyRemaining: 100 },
      }),
    ).toBe(
      "You've used 40.3 of 250 credits this month; at this pace you'll use them up before the month ends, and agents on your own AI subscriptions then keep working one at a time on the economy lane.",
    );
    expect(aldoUsageSentence({ ...metered, credits: { ...credits, projected: null } })).toBe(
      "You've used 40.3 of 250 credits this month.",
    );
    expect(aldoUsageSentence({ ...metered, credits: null })).toBeNull();
  });
});

describe("storage and the kept Windows disk", () => {
  it("sizes storage in GB, or MB under one", () => {
    expect(formatBytes(10 * 1024 ** 3)).toBe("10 GB");
    expect(formatBytes(340 * 1024 ** 2)).toBe("340 MB");
    expect(formatBytes(0)).toBe("0 MB");
  });

  it("says what the kept disk costs, and when it goes if the plan can't pay for it", () => {
    expect(aldoWindowsDiskCopy({ creditsPerHour: 2, deletedOn: null })).toBe(
      "Your Windows computer's disk is kept for next time, at 2 credits an hour.",
    );
    expect(aldoWindowsDiskCopy({ creditsPerHour: 2, deletedOn: "Oct 25" })).toBe(
      "Your Windows computer's disk is kept for next time, at 2 credits an hour. Your plan can't pay for it now, so it's deleted on Oct 25 unless it has room by then.",
    );
  });
});
