import {
  DEFAULT_SERVER_SETTINGS,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  ALDO_MACHINE_SETTING_KEYS,
  aldoKeepsAll,
  aldoMachineSettingsOf,
  aldoSavesSettings,
  aldoSettingsSelection,
  withAldoMachineSettings,
} from "./machineSettings.logic";

/** Instances by id; `codex_work` is another Codex. */
const providers = (...ids: string[]) =>
  ids.map((instanceId) => ({
    instanceId,
    driver: instanceId.split("_")[0],
  })) as unknown as ServerProvider[];

function environment(id: string, options: { connected?: boolean; providers?: string[] } = {}) {
  return {
    environmentId: id,
    connected: options.connected !== false,
    serverConfig: {
      settings: { ...DEFAULT_SERVER_SETTINGS, responseStreamingMode: "paragraph" as const },
      providers: providers(...(options.providers ?? ["codex"])),
    },
  };
}

function selection(...environments: ReturnType<typeof environment>[]) {
  const connectedEnvironments = environments.filter((candidate) => candidate.connected);
  return { environments, connectedEnvironments, environment: connectedEnvironments[0] ?? null };
}

describe("aldoMachineSettingsOf", () => {
  it("keeps the five settings Aldo keeps, each as T3 reads it", () => {
    expect(
      aldoMachineSettingsOf({
        defaultModelSelection: { instanceId: "codex", model: "gpt-5.1" },
        defaultRuntimeMode: "approval-required",
        responseStreamingMode: "turn",
        continueThreadsAfterServerUpdate: true,
        textGenerationModelSelection: {
          instanceId: "claudeAgent",
          model: "claude-haiku-4-5",
          options: [{ id: "effort", value: "low" }],
        },
        // The machine's own, and the browser's.
        enableAgentBrowserAccess: true,
        projectSettingsOverrides: {},
        timestampFormat: "24-hour",
      }),
    ).toEqual({
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.1" },
      defaultRuntimeMode: "approval-required",
      responseStreamingMode: "turn",
      continueThreadsAfterServerUpdate: true,
      textGenerationModelSelection: {
        instanceId: "claudeAgent",
        model: "claude-haiku-4-5",
        options: [{ id: "effort", value: "low" }],
      },
    });
    expect(ALDO_MACHINE_SETTING_KEYS).toHaveLength(5);
  });

  it("keeps no default model (Automatic), and leaves out what T3 couldn't read", () => {
    expect(aldoMachineSettingsOf({ defaultModelSelection: null })).toEqual({
      defaultModelSelection: null,
    });
    expect(
      aldoMachineSettingsOf({
        defaultRuntimeMode: "yolo",
        responseStreamingMode: undefined,
        continueThreadsAfterServerUpdate: "yes",
        textGenerationModelSelection: null,
      }),
    ).toEqual({});
    expect(aldoMachineSettingsOf(null)).toEqual({});
    expect(aldoMachineSettingsOf([])).toEqual({});
  });

  it("leaves out a partial model selection, which isn't the user's whole choice", () => {
    expect(aldoMachineSettingsOf({ textGenerationModelSelection: { model: "gpt-5.1" } })).toEqual(
      {},
    );
  });
});

describe("withAldoMachineSettings", () => {
  it("puts the user's settings over a machine's", () => {
    const settings = withAldoMachineSettings(DEFAULT_SERVER_SETTINGS, {
      defaultRuntimeMode: "approval-required",
    });
    expect(settings.defaultRuntimeMode).toBe("approval-required");
    expect(settings.responseStreamingMode).toBe(DEFAULT_SERVER_SETTINGS.responseStreamingMode);
  });

  it("leaves them as they are with none kept", () => {
    expect(withAldoMachineSettings(DEFAULT_SERVER_SETTINGS, null)).toBe(DEFAULT_SERVER_SETTINGS);
    expect(
      withAldoMachineSettings(
        {
          ...DEFAULT_SERVER_SETTINGS,
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "inherited",
          },
        },
        {},
      ).defaultModelSelection,
    ).toBeNull();
  });
});

describe("aldoKeepsAll", () => {
  it("says whether every key is one Aldo keeps", () => {
    expect(aldoKeepsAll(["defaultRuntimeMode"])).toBe(true);
    expect(aldoKeepsAll(["defaultRuntimeMode", "responseStreamingMode"])).toBe(true);
    expect(aldoKeepsAll(["defaultRuntimeMode", "backgroundActivity"])).toBe(false);
    expect(aldoKeepsAll([])).toBe(false);
  });
});

describe("aldoSettingsSelection", () => {
  const kept = { responseStreamingMode: "turn" as const };

  it("shows the user's values over each connected machine's at All environments", () => {
    const selected = aldoSettingsSelection(
      "all",
      selection(environment("a"), environment("b", { connected: false })),
      kept,
    );
    expect(
      selected.connectedEnvironments.map(
        (candidate) => candidate.serverConfig?.settings.responseStreamingMode,
      ),
    ).toEqual(["turn"]);
    expect(selected.environment?.serverConfig?.settings.responseStreamingMode).toBe("turn");
    // The sleeping one is left to its cache (shells.ts), and the pickers use the connected one's providers.
    expect(selected.environments[1]?.serverConfig.settings.responseStreamingMode).toBe("paragraph");
    expect(selected.aldo).toEqual({ settings: kept, providers: null });
  });

  it("offers a sleeping machine's providers when none is connected", () => {
    const selected = aldoSettingsSelection(
      "all",
      selection(
        environment("old", { connected: false, providers: ["codex"] }),
        environment("new", { connected: false, providers: ["codex", "muse"] }),
      ),
      kept,
    );
    expect(selected.connectedEnvironments).toEqual([]);
    expect(selected.environment).toBeNull();
    expect(selected.aldo?.providers?.map((provider) => provider.instanceId)).toEqual([
      "codex",
      "muse",
    ]);
  });

  it("counts kinds of provider, not instances, to pick the sleeping machine", () => {
    const selected = aldoSettingsSelection(
      "all",
      selection(
        environment("instances", {
          connected: false,
          providers: ["codex", "codex_personal", "codex_work"],
        }),
        environment("kinds", { connected: false, providers: ["codex", "muse"] }),
      ),
      kept,
    );
    expect(selected.aldo?.providers?.map((provider) => provider.instanceId)).toEqual([
      "codex",
      "muse",
    ]);
  });

  it("leaves one machine's settings, a project's, and an Aldo that doesn't keep them as they are", () => {
    const given = selection(environment("a"));
    for (const [scope, settings] of [
      ["environment", kept],
      ["project", kept],
      ["checkout", kept],
      ["unavailable", kept],
      ["all", null],
    ] as const) {
      const selected = aldoSettingsSelection(scope, given, settings);
      expect(selected.aldo).toBeNull();
      expect(selected.connectedEnvironments).toBe(given.connectedEnvironments);
    }
  });
});

describe("aldoSavesSettings", () => {
  it("saves the keys Aldo keeps where the user's values count", () => {
    const aldo = { settings: {}, providers: null };
    expect(aldoSavesSettings(aldo, ["textGenerationModelSelection"])).toBe(true);
    expect(aldoSavesSettings(aldo, ["enableAgentBrowserAccess"])).toBe(false);
    expect(aldoSavesSettings(null, ["textGenerationModelSelection"])).toBe(false);
    expect(aldoSavesSettings(undefined, ["textGenerationModelSelection"])).toBe(false);
  });
});
