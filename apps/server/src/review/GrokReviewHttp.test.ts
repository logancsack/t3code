import { describe, expect, it } from "vite-plus/test";

import { managedReviewTokenMatches } from "./GrokReviewHttp.ts";

describe("managed Grok review route authorization", () => {
  it("accepts only the exact non-empty workspace gateway token", () => {
    expect(managedReviewTokenMatches("review-secret", "review-secret")).toBe(true);
    expect(managedReviewTokenMatches("review-secret", "other-secret")).toBe(false);
    expect(managedReviewTokenMatches(undefined, "review-secret")).toBe(false);
    expect(managedReviewTokenMatches("review-secret", undefined)).toBe(false);
    expect(managedReviewTokenMatches("", "")).toBe(false);
  });
});
