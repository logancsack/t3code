import { describe, expect, it } from "vite-plus/test";

import {
  ALL_RUNTIME_MODES,
  RUNTIME_MODE_OPTIONS,
  coerceProviderRuntimeMode,
  getProviderSupportedRuntimeModes,
  runtimeModeLabel,
} from "./runtimeModes";

describe("mobile provider runtime modes", () => {
  it("keeps every access mode for legacy provider snapshots", () => {
    expect(getProviderSupportedRuntimeModes(undefined)).toEqual(ALL_RUNTIME_MODES);
    expect(ALL_RUNTIME_MODES).toEqual(RUNTIME_MODE_OPTIONS.map((option) => option.value));
    expect(coerceProviderRuntimeMode(undefined, "approval-required")).toBe("approval-required");
  });

  it("restricts Prime to Full access and coerces stale selections", () => {
    const prime = { supportedRuntimeModes: ["full-access"] as const };

    expect(getProviderSupportedRuntimeModes(prime)).toEqual(["full-access"]);
    expect(coerceProviderRuntimeMode(prime, "approval-required")).toBe("full-access");
    expect(coerceProviderRuntimeMode(prime, "auto-accept-edits")).toBe("full-access");
    expect(coerceProviderRuntimeMode(prime, "auto")).toBe("full-access");
    expect(coerceProviderRuntimeMode(prime, "full-access")).toBe("full-access");
    expect(runtimeModeLabel("full-access")).toBe("Full access");
  });
});
