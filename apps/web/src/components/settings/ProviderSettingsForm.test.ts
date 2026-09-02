import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind } from "@t3tools/contracts";

import {
  DRIVER_OPTION_BY_VALUE,
  isProviderDriverRuntimeSupported,
  runtimeSupportedDriverOptions,
} from "./providerDriverMeta";
import {
  deriveProviderSettingsFields,
  nextProviderConfigWithFieldValue,
  readProviderConfigBoolean,
  readProviderConfigString,
} from "./ProviderSettingsForm";

describe("ProviderSettingsForm helpers", () => {
  it("derives visible provider config fields from the client definition schema", () => {
    const codex = DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make("codex")];

    expect(codex).toBeDefined();
    expect(deriveProviderSettingsFields(codex!).map((field) => field.key)).toEqual([
      "binaryPath",
      "homePath",
      "shadowHomePath",
      "launchArgs",
    ]);
  });

  it("sources labels and descriptions from schema annotations", () => {
    const opencode = DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make("opencode")];
    expect(opencode).toBeDefined();

    const serverPassword = deriveProviderSettingsFields(opencode!).find(
      (field) => field.key === "serverPassword",
    );

    expect(serverPassword).toMatchObject({
      label: "Server password",
      description: "Stored in plain text on disk.",
      control: "password",
    });
  });

  it("exposes the Muse Code CLI fields without surfacing internal model storage", () => {
    const muse = DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make("muse")];

    expect(muse).toMatchObject({ label: "Muse Code", badgeLabel: "Beta" });
    expect(deriveProviderSettingsFields(muse!).map((field) => field.key)).toEqual([
      "binaryPath",
      "launchArgs",
    ]);
  });

  it("shows the auto-compaction threshold for Claude providers", () => {
    const claude = DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make("claudeAgent")];
    expect(claude).toBeDefined();

    expect(deriveProviderSettingsFields(claude!).map((field) => field.key)).toEqual([
      "binaryPath",
      "homePath",
      "autoCompactWindow",
      "launchArgs",
    ]);
  });

  it("exposes Prime Agent as an experimental provider with its ACP launch fields", () => {
    const primeAgent = DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make("primeAgent")];

    expect(primeAgent).toMatchObject({ label: "Prime Agent", badgeLabel: "Experimental" });
    expect(deriveProviderSettingsFields(primeAgent!).map((field) => field.key)).toEqual([
      "binaryPath",
      "launchArgs",
    ]);
  });

  it("hides Muse when the server withholds it or reports only a stale unavailable shadow", () => {
    const muse = ProviderDriverKind.make("muse");

    expect(isProviderDriverRuntimeSupported(muse, [])).toBe(false);
    expect(
      isProviderDriverRuntimeSupported(muse, [{ driver: muse, availability: "unavailable" }]),
    ).toBe(false);
    expect(runtimeSupportedDriverOptions([]).map((option) => option.value)).not.toContain(muse);
  });

  it("shows Muse when the server registers a concrete Muse instance", () => {
    const muse = ProviderDriverKind.make("muse");

    expect(
      isProviderDriverRuntimeSupported(muse, [{ driver: muse, availability: "available" }]),
    ).toBe(true);
    expect(
      runtimeSupportedDriverOptions([{ driver: muse, availability: "available" }]).map(
        (option) => option.value,
      ),
    ).toContain(muse);
  });

  it("preserves unknown config keys while omitting empty configurable fields", () => {
    const opencode = DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make("opencode")];
    expect(opencode).toBeDefined();

    const serverUrl = deriveProviderSettingsFields(opencode!).find(
      (field) => field.key === "serverUrl",
    );
    expect(serverUrl).toBeDefined();

    const next = nextProviderConfigWithFieldValue(
      { forkOwned: 1, serverUrl: "http://127.0.0.1:4096" },
      serverUrl!,
      "",
    );

    expect(next).toEqual({ forkOwned: 1 });
  });

  it("reads non-string config values as blank strings", () => {
    expect(readProviderConfigString({ binaryPath: 123 }, "binaryPath")).toBe("");
  });

  it("omits false boolean fields when clearWhenEmpty is omit", () => {
    const next = nextProviderConfigWithFieldValue(
      { forkOwned: 1, experimental: true },
      {
        key: "experimental",
        control: "switch",
        label: "Experimental",
        clearWhenEmpty: "omit",
        defaultBooleanValue: false,
      },
      false,
    );

    expect(next).toEqual({ forkOwned: 1 });
  });

  it("omits true boolean fields when true is the default", () => {
    const next = nextProviderConfigWithFieldValue(
      { forkOwned: 1, experimental: false },
      {
        key: "experimental",
        control: "switch",
        label: "Experimental",
        clearWhenEmpty: "omit",
        defaultBooleanValue: true,
      },
      true,
    );

    expect(next).toEqual({ forkOwned: 1 });
  });

  it("stores false boolean fields when true is the default", () => {
    const next = nextProviderConfigWithFieldValue(
      undefined,
      {
        key: "experimental",
        control: "switch",
        label: "Experimental",
        clearWhenEmpty: "omit",
        defaultBooleanValue: true,
      },
      false,
    );

    expect(next).toEqual({ experimental: false });
  });

  it("preserves false boolean fields when clearWhenEmpty is persist", () => {
    const next = nextProviderConfigWithFieldValue(
      undefined,
      {
        key: "experimental",
        control: "switch",
        label: "Experimental",
        clearWhenEmpty: "persist",
      },
      false,
    );

    expect(next).toEqual({ experimental: false });
  });

  it("reads non-boolean config values as false booleans", () => {
    expect(readProviderConfigBoolean({ experimental: "true" }, "experimental")).toBe(false);
  });

  it("reads missing boolean config values from the supplied default", () => {
    expect(readProviderConfigBoolean({}, "experimental", true)).toBe(true);
  });
});
