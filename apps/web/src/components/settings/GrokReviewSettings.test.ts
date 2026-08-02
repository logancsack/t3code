import { describe, expect, it } from "vite-plus/test";

import { aldoReviewToggleDisabled } from "./GrokReviewSettings";

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
