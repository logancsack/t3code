import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { getProviderSummary } from "./providerStatus";

describe("getProviderSummary", () => {
  it("describes an inconclusive provider check without implying an outage", () => {
    const provider = {
      instanceId: ProviderInstanceId.make("codex"),
      driver: ProviderDriverKind.make("codex"),
      displayName: "Codex",
      enabled: true,
      installed: true,
      version: "0.145.0",
      status: "warning",
      auth: { status: "unknown" },
      checkedAt: "2026-07-28T04:33:18.484Z",
      message: "Codex status verification timed out. T3 Code will retry automatically.",
      models: [],
      slashCommands: [],
      skills: [],
    } as const satisfies ServerProvider;

    expect(getProviderSummary(provider)).toEqual({
      headline: "Verification delayed",
      detail: "Codex status verification timed out. T3 Code will retry automatically.",
    });
  });
});
