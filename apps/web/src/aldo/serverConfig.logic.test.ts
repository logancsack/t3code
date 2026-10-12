import { describe, expect, it } from "vite-plus/test";

import { lacksProviders, providerInstances } from "./serverConfig.logic";

const config = (...ids: string[]) => ({ providers: ids.map((instanceId) => ({ instanceId })) });

describe("providerInstances", () => {
  it("lists a config's provider instances in order", () => {
    expect(providerInstances(config("muse", "codex", "claudeAgent"))).toEqual([
      "claudeAgent",
      "codex",
      "muse",
    ]);
  });
});

describe("lacksProviders", () => {
  it("finds a provider the cached config doesn't list", () => {
    expect(
      lacksProviders(config("claudeAgent", "codex"), config("claudeAgent", "codex", "muse")),
    ).toBe(true);
  });

  it("keeps a cached config that lists every provider, or more", () => {
    expect(lacksProviders(config("codex", "claudeAgent"), config("claudeAgent", "codex"))).toBe(
      false,
    );
    expect(
      lacksProviders(config("claudeAgent", "codex", "muse"), config("claudeAgent", "codex")),
    ).toBe(false);
  });
});
