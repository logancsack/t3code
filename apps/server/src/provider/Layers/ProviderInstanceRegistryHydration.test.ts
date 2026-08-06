import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";

import { resolveBuiltInDrivers } from "../builtInDrivers.ts";
import { deriveProviderInstanceConfigMap } from "./ProviderInstanceRegistryHydration.ts";

describe("ProviderInstanceRegistryHydration runtime gates", () => {
  const museDriverKind = ProviderDriverKind.make("muse");
  const museDefaultId = ProviderInstanceId.make("muse");
  const productionDrivers = resolveBuiltInDrivers({ museCodeEnabled: false });

  it("does not synthesize the legacy Muse instance when Muse is withheld", () => {
    const configMap = deriveProviderInstanceConfigMap(DEFAULT_SERVER_SETTINGS, productionDrivers);

    expect(configMap[museDefaultId]).toBeUndefined();
    expect(productionDrivers.some((driver) => driver.driverKind === museDriverKind)).toBe(false);
  });

  it("retains stale explicit Muse settings without adding an executable Muse driver", () => {
    const customId = ProviderInstanceId.make("muse_internal");
    const explicitMuse = {
      driver: museDriverKind,
      enabled: true,
      config: { binaryPath: "muse" },
    } as const;
    const configMap = deriveProviderInstanceConfigMap(
      {
        ...DEFAULT_SERVER_SETTINGS,
        providerInstances: { [customId]: explicitMuse },
      },
      productionDrivers,
    );

    expect(configMap[customId]).toEqual(explicitMuse);
    expect(configMap[museDefaultId]).toBeUndefined();
    expect(productionDrivers.some((driver) => driver.driverKind === museDriverKind)).toBe(false);
  });
});
