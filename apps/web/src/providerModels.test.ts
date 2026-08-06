import { describe, expect, it } from "vite-plus/test";

import {
  ALL_RUNTIME_MODES,
  coerceProviderRuntimeMode,
  getProviderSupportedRuntimeModes,
} from "./providerModels";

describe("provider runtime mode capabilities", () => {
  it("keeps every access mode for legacy provider snapshots", () => {
    expect(getProviderSupportedRuntimeModes(undefined)).toEqual(ALL_RUNTIME_MODES);
    expect(coerceProviderRuntimeMode(undefined, "approval-required")).toBe("approval-required");
  });

  it("exposes a fixed Full access state and coerces stale Prime drafts", () => {
    const prime = { supportedRuntimeModes: ["full-access"] as const };

    expect(getProviderSupportedRuntimeModes(prime)).toEqual(["full-access"]);
    expect(coerceProviderRuntimeMode(prime, "approval-required")).toBe("full-access");
    expect(coerceProviderRuntimeMode(prime, "auto-accept-edits")).toBe("full-access");
    expect(coerceProviderRuntimeMode(prime, "auto")).toBe("full-access");
    expect(coerceProviderRuntimeMode(prime, "full-access")).toBe("full-access");
  });
});
