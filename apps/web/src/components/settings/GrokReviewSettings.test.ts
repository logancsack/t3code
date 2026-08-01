import { describe, expect, it } from "vite-plus/test";

import { aldoReviewToggleDisabled, normalizeGrokReviewRepository } from "./GrokReviewSettings";

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

describe("aldoReviewToggleDisabled", () => {
  it("allows an enabled setting to be disabled after the app disconnects", () => {
    expect(
      aldoReviewToggleDisabled({
        saving: false,
        enabled: true,
        connected: false,
        providerAvailable: false,
      }),
    ).toBe(false);
  });

  it("prevents enabling until the app and provider are ready", () => {
    expect(
      aldoReviewToggleDisabled({
        saving: false,
        enabled: false,
        connected: false,
        providerAvailable: true,
      }),
    ).toBe(true);
  });
});
