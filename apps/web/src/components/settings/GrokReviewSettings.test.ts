import { describe, expect, it } from "vite-plus/test";

import {
  aldoReviewToggleDisabled,
  resolveSupplementalReviewProviderId,
  supplementalProviderInstanceIdForSave,
  supplementalProviderSelectDisabled,
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
        primary: "opencode",
      }),
    ).toBeNull();
    expect(
      resolveSupplementalReviewProviderId({
        stored: "opencode",
        primary: "opencode",
      }),
    ).toBeNull();
  });

  it("uses only a distinct explicitly stored supplemental provider", () => {
    expect(
      resolveSupplementalReviewProviderId({
        stored: "opencode-work",
        primary: "grok",
      }),
    ).toBe("opencode-work");
    expect(
      resolveSupplementalReviewProviderId({
        stored: null,
        primary: "grok",
      }),
    ).toBeNull();
  });
});

describe("supplementalProviderInstanceIdForSave", () => {
  it("serializes the explicit no-provider option as null", () => {
    expect(supplementalProviderInstanceIdForSave(null)).toBeNull();
    expect(supplementalProviderInstanceIdForSave({ instanceId: "opencode-work" })).toBe(
      "opencode-work",
    );
  });
});

describe("supplementalProviderSelectDisabled", () => {
  it("keeps a stale stored selection clearable without an available provider", () => {
    expect(
      supplementalProviderSelectDisabled({
        saving: false,
        availableProviderCount: 0,
        selectedProviderInstanceId: "disconnected-opencode",
      }),
    ).toBe(false);
    expect(
      supplementalProviderSelectDisabled({
        saving: false,
        availableProviderCount: 0,
        selectedProviderInstanceId: null,
      }),
    ).toBe(true);
  });
});
