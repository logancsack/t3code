import { expect, it } from "@effect/vitest";
import { ProviderDriverKind } from "@t3tools/contracts";

import { BUILT_IN_DRIVERS, resolveBuiltInDrivers } from "../builtInDrivers.ts";
import { MuseDriver } from "./MuseDriver.ts";

it("registers Muse Code as a built-in multi-instance driver", () => {
  expect(MuseDriver.driverKind).toBe(ProviderDriverKind.make("muse"));
  expect(MuseDriver.metadata).toEqual({
    displayName: "Muse Code",
    supportsMultipleInstances: true,
  });
  expect(MuseDriver.defaultConfig()).toEqual({
    enabled: true,
    binaryPath: "muse",
    launchArgs: "",
    customModels: [],
  });
  expect(BUILT_IN_DRIVERS).toContain(MuseDriver);
});

it("omits Muse Code from the executable driver set when its runtime gate is disabled", () => {
  expect(resolveBuiltInDrivers({ museCodeEnabled: true })).toContain(MuseDriver);
  expect(resolveBuiltInDrivers({ museCodeEnabled: false })).not.toContain(MuseDriver);
});
