import { describe, expect, it } from "vite-plus/test";

import {
  aldoProviderLimitsOf,
  limitFraction,
  limitPageUrl,
  limitResetCopy,
  limitStateCopy,
  limitsCheckedCopy,
  limitTone,
  limitUsedCopy,
  nextLimitReset,
  type AldoProviderLimits,
} from "./providerLimits.logic";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const ahead = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

const claude: AldoProviderLimits = {
  id: "claude",
  name: "Claude",
  plan: null,
  state: "ok",
  windows: [
    {
      id: "5h",
      label: "5-hour session",
      usedPercent: 6,
      resetsAt: "2026-10-11T14:00:00Z",
      detail: null,
    },
    { id: "7d", label: "Week", usedPercent: 49, resetsAt: "2026-10-13T00:00:00Z", detail: null },
  ],
  lines: [],
  error: null,
  url: "https://claude.ai/settings/usage",
  checkedAt: "2026-10-11T11:58:00Z",
};

describe("aldoProviderLimitsOf", () => {
  it("takes Aldo's answer, leaving out a provider it can't read", () => {
    const aldo = { ...claude, id: "aldo", name: "Aldo", url: "/usage", windows: [] };
    const odd = { ...claude, id: "grok", state: "sideways" };
    const noWindows = { ...claude, id: "luma", windows: [{ label: "Month" }] };
    const undated = { ...claude, id: "fal", checkedAt: "recently" };
    expect(aldoProviderLimitsOf({ providers: [aldo, claude, odd, noWindows, undated] })).toEqual([
      aldo,
      claude,
    ]);
  });

  it("is null for an answer that isn't one, as an older Aldo's page", () => {
    expect(aldoProviderLimitsOf("<!doctype html>")).toBeNull();
    expect(aldoProviderLimitsOf({})).toBeNull();
    expect(aldoProviderLimitsOf(null)).toBeNull();
  });
});

describe("limitResetCopy", () => {
  it("counts down within a day", () => {
    expect(limitResetCopy(ahead(0.5), NOW)).toBe("Resets in under a minute");
    expect(limitResetCopy(ahead(25), NOW)).toBe("Resets in 25 min");
    expect(limitResetCopy(ahead(85), NOW)).toBe("Resets in 1 h 25 min");
    expect(limitResetCopy(ahead(180), NOW)).toBe("Resets in 3 h");
  });

  it("names the day and time within a week, then the date", () => {
    expect(limitResetCopy("2026-10-13T00:00:00Z", NOW, "UTC")).toBe("Resets Tue 12:00 AM");
    expect(limitResetCopy("2026-10-31T00:00:00Z", NOW, "UTC")).toBe("Resets Oct 31");
  });

  it("says a reset that's passed has happened, not that it's about to", () => {
    expect(limitResetCopy(ahead(0), NOW)).toBe("Has reset");
    expect(limitResetCopy(ahead(-90), NOW)).toBe("Has reset");
  });

  it("says nothing without a time", () => {
    expect(limitResetCopy(null, NOW)).toBeNull();
    expect(limitResetCopy("soon", NOW)).toBeNull();
  });
});

describe("a limit's meter", () => {
  it("warns at 80% and at the limit", () => {
    expect(limitTone(79)).toBe("ok");
    expect(limitTone(80)).toBe("near");
    expect(limitTone(100)).toBe("reached");
    expect(limitFraction(140)).toBe(1);
    expect(limitFraction(-1)).toBe(0);
  });

  it("doesn't round a sliver of use to nothing, or a sliver left to all of it", () => {
    expect(limitUsedCopy(0)).toBe("0% used");
    expect(limitUsedCopy(0.2)).toBe("1% used");
    expect(limitUsedCopy(42.1)).toBe("42% used");
    expect(limitUsedCopy(99.6)).toBe("99% used");
    expect(limitUsedCopy(100)).toBe("100% used");
  });
});

describe("a provider's row", () => {
  it("speaks up only near or at a limit", () => {
    expect(limitStateCopy("reached")).toBe("Limit reached");
    expect(limitStateCopy("near")).toBe("Close to its limit");
    expect(limitStateCopy("ok")).toBeNull();
    expect(limitStateCopy("unknown")).toBeNull();
  });

  it("links a provider's own page, not Aldo's own Usage page", () => {
    expect(limitPageUrl(claude)).toBe("https://claude.ai/settings/usage");
    expect(limitPageUrl({ ...claude, url: "/usage" })).toBeNull();
    expect(limitPageUrl({ ...claude, url: null })).toBeNull();
  });

  it("says how old the oldest reading is", () => {
    expect(limitsCheckedCopy([claude], NOW)).toBe("Checked 2 min ago");
    expect(limitsCheckedCopy([claude, { ...claude, checkedAt: "2026-10-11T11:59:30Z" }], NOW)).toBe(
      "Checked 2 min ago",
    );
    expect(limitsCheckedCopy([{ ...claude, checkedAt: "2026-10-11T11:59:30Z" }], NOW)).toBe(
      "Checked just now",
    );
    expect(limitsCheckedCopy([], NOW)).toBeNull();
  });
});

describe("nextLimitReset", () => {
  it("waits for the soonest reset ahead, a day at most", () => {
    expect(nextLimitReset([claude], NOW)).toBe(2 * 60 * 60_000);
    const passed = {
      ...claude,
      windows: [{ ...claude.windows[0]!, resetsAt: ahead(-5) }, claude.windows[1]!],
    };
    expect(nextLimitReset([passed], NOW)).toBe(24 * 60 * 60_000);
    expect(nextLimitReset([{ ...claude, windows: [] }], NOW)).toBeNull();
  });
});
