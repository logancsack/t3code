import type { UsageSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { ALDO_UNREPORTED_USAGE, aldoUnreportedUsageNote, withAldoUsage } from "./usage.logic";

const summary = {
  contractVersion: 5,
  readAt: "2026-09-30T21:00:00.000Z",
  timeZone: "America/Los_Angeles",
  sinceDay: "2026-09-01",
  untilDay: "2026-09-30",
  buckets: [
    {
      day: "2026-09-30",
      provider: "claude",
      model: "claude-opus-5-5",
      totals: {
        uncachedInputTokens: 64,
        cachedInputTokens: 2_089_293,
        cacheCreationTokens: 86_841,
        outputTokens: 15_765,
        reasoningTokens: 0,
      },
      costUsd: 1.17,
      cacheSavingsUsd: 7.94,
      costSource: "modelPriced",
      records: 32,
      unpricedRecords: 0,
      sessions: 1,
    },
  ],
  sources: [
    {
      fingerprint: {
        hostId: "6e820d2e-d58",
        provider: "claude",
        resolvedHomePath: "/vercel/.claude/projects",
        volumeId: "65040:1928504",
      },
      status: "ok",
      scannedFiles: 1,
      skippedFiles: 0,
      malformedRecords: 0,
      distinctSessions: 1,
      message: null,
    },
  ],
  pricing: { status: "fresh", source: "litellm", fetchedAt: null, knownModels: 10 },
  scanDurationMs: 12,
};

const asleep: {
  readonly environmentId: string;
  readonly label: string;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly summary: UsageSummary | null;
} = {
  environmentId: "aldo-y90nab5rbd",
  label: "aldo",
  isPending: false,
  error: "This environment could not report usage.",
  summary: null,
};

describe("withAldoUsage", () => {
  it("counts a sleeping agent from Aldo's answer", () => {
    const status = withAldoUsage(asleep, { "aldo-y90nab5rbd": summary });
    expect(status.error).toBeNull();
    expect(status.isPending).toBe(false);
    expect(status.summary?.buckets[0]?.records).toBe(32);
    expect(status.label).toBe("aldo");
  });

  it("waits for Aldo's answers before calling an agent unreported", () => {
    expect(withAldoUsage(asleep, "loading")).toMatchObject({ isPending: true, error: null });
  });

  it("leaves out an agent Aldo has nothing from", () => {
    expect(withAldoUsage(asleep, {}).error).toBe(ALDO_UNREPORTED_USAGE);
    expect(withAldoUsage(asleep, "none").error).toBe(ALDO_UNREPORTED_USAGE);
    // An answer this client can't read counts as none.
    expect(withAldoUsage(asleep, { "aldo-y90nab5rbd": { buckets: "?" } }).error).toBe(
      ALDO_UNREPORTED_USAGE,
    );
  });

  it("keeps what a connected agent answered, or is still answering", () => {
    const live = { ...asleep, error: null, summary: summary as unknown as UsageSummary };
    expect(withAldoUsage(live, "none")).toBe(live);
    const scanning = { ...asleep, error: null, isPending: true };
    expect(withAldoUsage(scanning, {})).toBe(scanning);
  });
});

describe("aldoUnreportedUsageNote", () => {
  it("says how many agents aren't counted, in one line", () => {
    expect(aldoUnreportedUsageNote(1)).toContain("1 cloud agent isn't");
    expect(aldoUnreportedUsageNote(25)).toContain("25 cloud agents isn't");
  });
});
