import { describe, expect, it } from "vite-plus/test";

import {
  aldoReviewToggleDisabled,
  resolveSupplementalReviewProviderId,
} from "./GrokReviewSettings";

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

describe("resolveSupplementalReviewProviderId", () => {
  it("never reuses the selected primary as supplemental coverage", () => {
    expect(
      resolveSupplementalReviewProviderId({
        stored: null,
        preferred: "opencode",
        primary: "opencode",
      }),
    ).toBeNull();
    expect(
      resolveSupplementalReviewProviderId({
        stored: "opencode",
        preferred: "opencode",
        primary: "opencode",
      }),
    ).toBeNull();
  });

  it("uses a distinct stored or preferred supplemental provider", () => {
    expect(
      resolveSupplementalReviewProviderId({
        stored: "opencode-work",
        preferred: "opencode-default",
        primary: "grok",
      }),
    ).toBe("opencode-work");
    expect(
      resolveSupplementalReviewProviderId({
        stored: null,
        preferred: "opencode-default",
        primary: "grok",
      }),
    ).toBe("opencode-default");
  });
});
