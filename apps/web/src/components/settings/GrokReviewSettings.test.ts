import { describe, expect, it } from "vite-plus/test";

import { normalizeGrokReviewRepository } from "./GrokReviewSettings";

describe("automatic Grok review repository input", () => {
  it("normalizes GitHub owner/repository names", () => {
    expect(normalizeGrokReviewRepository(" Aldo/Platform ")).toBe("aldo/platform");
  });

  it("rejects path traversal and incomplete names", () => {
    expect(normalizeGrokReviewRepository("../platform")).toBeNull();
    expect(normalizeGrokReviewRepository("aldo")).toBeNull();
    expect(normalizeGrokReviewRepository("aldo/platform/extra")).toBeNull();
  });
});
