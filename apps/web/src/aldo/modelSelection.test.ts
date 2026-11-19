import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts/settings";
import { describe, expect, it, vi } from "vite-plus/test";
import { getAppModelOptionsForInstance } from "../modelSelection";
import { deriveProviderInstanceEntries } from "../providerInstances";

vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  isAldoCloud: true,
}));

const instanceId = ProviderInstanceId.make("codex");
const provider: ServerProvider = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-01-01T00:00:00.000Z",
  models: [
    {
      slug: "incumbent",
      name: "Current default",
      isCustom: false,
      isDefault: true,
      capabilities: {},
    },
    // Older T3 servers label every model absent from their manifest as legacy.
    {
      slug: "future-release",
      name: "Future release",
      isCustom: false,
      isLegacy: true,
      capabilities: {},
    },
  ],
  slashCommands: [],
  skills: [],
};
const settings: UnifiedSettings = {
  ...DEFAULT_UNIFIED_SETTINGS,
  providerInstances: { [instanceId]: { driver: provider.driver, config: { customModels: [] } } },
};
const entry = deriveProviderInstanceEntries([provider])[0]!;

describe("Aldo subscription model visibility", () => {
  it("includes models reported by older servers in the normal picker without changing the default", () => {
    const options = getAppModelOptionsForInstance(settings, entry);
    expect(options.filter((model) => !model.isLegacy).map((model) => model.slug)).toEqual([
      "incumbent",
      "future-release",
    ]);
    expect(options.find((model) => model.isDefault)?.slug).toBe("incumbent");
    expect(options.find((model) => model.slug === "future-release")?.name).toBe("Future release");
    expect(provider.models[1]?.isLegacy).toBe(true);
  });

  it("still respects models the user explicitly hid", () => {
    const hidden = {
      ...settings,
      providerModelPreferences: {
        [instanceId]: { hiddenModels: ["future-release"], modelOrder: [] },
      },
    };
    expect(getAppModelOptionsForInstance(hidden, entry).map((model) => model.slug)).toEqual([
      "incumbent",
    ]);
  });
});
