import { describe, expect, it } from "vite-plus/test";

import {
  missingProviders,
  mergeProviderSnapshots,
  withSavedBackends,
  providerInstances,
  providerKinds,
  withAldoTemplate,
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

describe("withAldoTemplate", () => {
  const stored = (ids: string[], settings: Record<string, unknown>) =>
    JSON.stringify({
      schemaVersion: 1,
      environmentId: "env",
      config: { ...config(...ids), settings },
    });
  const own = { defaultRuntimeMode: "full-access", responseStreamingMode: "paragraph", x: 1 };

  it("puts the user's settings over a cached config's own, as the machine gets them when it wakes", () => {
    const merged = withAldoTemplate(stored(["codex"], own), stored(["codex"], {}), {
      defaultRuntimeMode: "approval-required",
    });
    expect(JSON.parse(merged!).config.settings).toEqual({
      ...own,
      defaultRuntimeMode: "approval-required",
    });
  });

  it("adds the providers it lacks as well", () => {
    const merged = withAldoTemplate(stored(["codex"], own), stored(["codex", "muse"], {}), {
      responseStreamingMode: "turn",
    });
    expect(JSON.parse(merged!).config).toEqual({
      ...config("codex", "muse"),
      settings: { ...own, responseStreamingMode: "turn" },
    });
  });

  it("takes the template's providers already read, as Aldo checks many copies against one", () => {
    const merged = withAldoTemplate(
      stored(["codex"], own),
      { providers: JSON.parse(stored(["codex", "muse"], {})).config.providers },
      {},
    );
    expect(JSON.parse(merged!).config).toEqual({ ...config("codex", "muse"), settings: own });
    expect(
      withAldoTemplate(
        stored(["codex"], own),
        { providers: JSON.parse(stored(["codex"], {})).config.providers },
        {},
      ),
    ).toBeNull();
  });

  it("leaves a cached config that already has them, or can't be read", () => {
    expect(
      withAldoTemplate(stored(["codex"], own), stored(["codex"], {}), {
        responseStreamingMode: "paragraph",
      }),
    ).toBeNull();
    expect(withAldoTemplate(stored(["codex"], own), stored(["codex"], {}), {})).toBeNull();
    expect(
      withAldoTemplate("{", stored(["codex"], {}), { responseStreamingMode: "turn" }),
    ).toBeNull();
    expect(withAldoTemplate(undefined, stored(["codex"], {}), {})).toBeNull();
  });
});

it("refreshes existing sleeping providers independently, without replacing a newer local check", () => {
  const codex = {
    instanceId: "codex",
    driver: "codex",
    checkedAt: "2026-11-19T01:00:00Z",
    models: ["old"],
  };
  const claude = {
    instanceId: "claudeAgent",
    driver: "claudeAgent",
    checkedAt: "2026-11-19T03:00:00Z",
    models: ["current"],
  };
  const future = { ...codex, checkedAt: "2026-11-19T02:00:00Z", models: ["old", "future"] };
  const reported = [future, { ...claude, checkedAt: "2026-11-19T00:00:00Z", models: [] }];
  expect(mergeProviderSnapshots([codex, claude], reported)).toEqual([future, claude]);
  const raw = JSON.stringify({ config: { providers: [codex, claude], settings: {} } });
  const refreshed = withAldoTemplate(raw, { providers: reported }, {});
  expect(JSON.parse(refreshed!).config.providers).toEqual([future, claude]);
  expect(withAldoTemplate(refreshed, { providers: reported }, {})).toBeNull();
});

it("keeps the saved OpenCode backends a machine without their keys doesn't list", () => {
  const model = (slug: string) => ({ slug, name: slug });
  const opencode = (slugs: string[]) => ({
    instanceId: "opencode",
    driver: "opencode",
    checkedAt: "2026-11-28T01:00:00Z",
    models: slugs.map(model),
  });
  const codex = { instanceId: "codex", driver: "codex", models: [model("gpt")] };
  const saved = [opencode(["aldo/a", "openrouter/x", "openrouter/y"]), codex];
  // A machine started before the OpenRouter key: Aldo's saved models of it stay, after the machine's own.
  expect(withSavedBackends([opencode(["aldo/a", "aldo/b"]), codex], saved)).toEqual([
    opencode(["aldo/a", "aldo/b", "openrouter/x", "openrouter/y"]),
    codex,
  ]);
  // A backend the machine lists is its own; other agents and an empty save are as reported.
  expect(withSavedBackends([opencode(["openrouter/z"])], saved)).toEqual([
    opencode(["openrouter/z", "aldo/a"]),
  ]);
  expect(withSavedBackends([opencode(["aldo/a"]), codex], [])).toEqual([
    opencode(["aldo/a"]),
    codex,
  ]);
});
