import { describe, expect, it } from "vite-plus/test";

import {
  missingProviders,
  providerInstances,
  providerKinds,
  withMissingProviders,
} from "./serverConfig.logic";

const config = (...ids: string[]) => ({
  providers: ids.map((instanceId) => ({ instanceId, driver: instanceId.split("_")[0] })),
});

describe("providerInstances", () => {
  it("lists a config's provider instances in order", () => {
    expect(providerInstances(config("muse", "codex", "claudeAgent"))).toEqual([
      "claudeAgent",
      "codex",
      "muse",
    ]);
  });
});

describe("providerKinds", () => {
  it("counts kinds of agent, not the instances the user added", () => {
    expect(providerKinds(config("claudeAgent", "codex", "codex_work", "codex_home"))).toBe(2);
    expect(providerKinds(config("claudeAgent", "codex", "muse"))).toBe(3);
  });
});

describe("missingProviders", () => {
  it("finds the providers the cached config doesn't list", () => {
    expect(
      missingProviders(config("claudeAgent", "codex"), config("claudeAgent", "codex", "muse")),
    ).toEqual([{ instanceId: "muse", driver: "muse" }]);
  });

  it("finds none when the cached config lists every provider, or more", () => {
    expect(
      missingProviders(config("codex", "claudeAgent"), config("claudeAgent", "codex")),
    ).toEqual([]);
    expect(
      missingProviders(config("claudeAgent", "codex_work", "muse"), config("claudeAgent", "muse")),
    ).toEqual([]);
  });
});

describe("withMissingProviders", () => {
  const stored = (...ids: string[]) =>
    JSON.stringify({ schemaVersion: 1, environmentId: "env", config: { ...config(...ids), x: 1 } });

  it("keeps the cached providers and adds the ones it lacks after them", () => {
    const merged = withMissingProviders(
      stored("claudeAgent", "codex_work"),
      stored("codex", "muse"),
    );
    expect(JSON.parse(merged!)).toEqual({
      schemaVersion: 1,
      environmentId: "env",
      config: { ...config("claudeAgent", "codex_work", "codex", "muse"), x: 1 },
    });
  });

  it("leaves a cached config that lacks nothing, or can't be read", () => {
    expect(withMissingProviders(stored("codex", "muse"), stored("muse"))).toBeNull();
    expect(withMissingProviders("{", stored("muse"))).toBeNull();
    expect(withMissingProviders(undefined, stored("muse"))).toBeNull();
  });
});
