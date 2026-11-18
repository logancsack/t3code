import { DEFAULT_SERVER_SETTINGS, EnvironmentId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const cloud = vi.hoisted(() => ({
  fetchAldoMachineSettings: vi.fn<() => Promise<unknown>>(),
  saveAldoMachineSettings: vi.fn<(settings: Record<string, unknown>) => Promise<unknown>>(),
}));
const toasts = vi.hoisted(() => ({ add: vi.fn() }));

const aldoApiMock = vi.hoisted(() => ({ isAldoCloud: true, ...cloud }));
vi.mock("./api", () => aldoApiMock);
vi.mock("./threadApi", () => aldoApiMock);
vi.mock("../components/ui/toast", () => ({ toastManager: toasts }));

import { planScopedSettingsPatch } from "../components/settings/scopedSettings";
import { resolveSettingsScope } from "../components/settings/settingsScope";

/** The store, fresh for each test (it keeps what Aldo said for the tab). */
async function store() {
  vi.resetModules();
  return import("./machineSettings");
}

/** A machine that's asleep: Settings has nowhere to write it. */
const asleep = {
  environmentId: EnvironmentId.make("aldo-thread"),
  label: "thread",
  connection: { phase: "available" as const },
  serverConfig: {
    settings: DEFAULT_SERVER_SETTINGS,
    environment: { capabilities: { projectSettingsOverrides: true } },
  },
};
const all = resolveSettingsScope({}, [], [asleep]);
const aldo = { settings: {}, providers: null };

beforeEach(() => {
  cloud.fetchAldoMachineSettings.mockReset();
  cloud.saveAldoMachineSettings.mockReset();
  toasts.add.mockReset();
});

describe("the user's T3 settings in Aldo", () => {
  it("saves a setting Aldo keeps with no machine connected, and shows it at once", async () => {
    cloud.fetchAldoMachineSettings.mockResolvedValue({ responseStreamingMode: "turn" });
    let answer!: (settings: unknown) => void;
    cloud.saveAldoMachineSettings.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { getAldoMachineSettings, keepAldoMachineSettings, loadAldoMachineSettings } =
      await store();
    expect(await loadAldoMachineSettings()).toEqual({ responseStreamingMode: "turn" });

    const patch = { defaultRuntimeMode: "approval-required" } as const;
    const plan = planScopedSettingsPatch(all, [asleep], patch);
    // Without Aldo, T3 refuses it: no environment to write it to.
    expect(plan.unavailableReason).not.toBeNull();
    const kept = keepAldoMachineSettings(aldo, patch, plan);
    expect(kept.unavailableReason).toBeNull();
    expect(kept.serverWrites).toEqual([]);
    expect(cloud.saveAldoMachineSettings).toHaveBeenCalledWith(patch);
    expect(getAldoMachineSettings()).toEqual({
      responseStreamingMode: "turn",
      defaultRuntimeMode: "approval-required",
    });

    answer({ responseStreamingMode: "turn", defaultRuntimeMode: "approval-required", x: 1 });
    await vi.waitFor(() =>
      expect(getAldoMachineSettings()).toEqual({
        responseStreamingMode: "turn",
        defaultRuntimeMode: "approval-required",
      }),
    );
  });

  it("saves a change made before Aldo first answers, which doesn't then undo it", async () => {
    let answer!: (settings: unknown) => void;
    cloud.fetchAldoMachineSettings.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    cloud.saveAldoMachineSettings.mockReturnValue(new Promise(() => undefined));
    const { getAldoMachineSettings, keepAldoMachineSettings, loadAldoMachineSettings } =
      await store();
    const loaded = loadAldoMachineSettings();
    const patch = { defaultRuntimeMode: "approval-required" } as const;
    keepAldoMachineSettings(aldo, patch, planScopedSettingsPatch(all, [asleep], patch));
    expect(cloud.saveAldoMachineSettings).toHaveBeenCalledWith(patch);
    answer({ defaultRuntimeMode: "auto" });
    await loaded;
    expect(getAldoMachineSettings()).toEqual({ defaultRuntimeMode: "approval-required" });
  });

  it("still saves to Aldo when it couldn't be read", async () => {
    cloud.fetchAldoMachineSettings.mockRejectedValue(new Error("offline"));
    cloud.saveAldoMachineSettings.mockResolvedValue({ defaultRuntimeMode: "auto" });
    const { keepAldoMachineSettings, loadAldoMachineSettings } = await store();
    expect(await loadAldoMachineSettings()).toEqual({});
    const patch = { defaultRuntimeMode: "auto" } as const;
    keepAldoMachineSettings(aldo, patch, planScopedSettingsPatch(all, [asleep], patch));
    expect(cloud.saveAldoMachineSettings).toHaveBeenCalledWith(patch);
  });

  it("leaves a setting Aldo doesn't keep to the machines, as T3 does", async () => {
    cloud.fetchAldoMachineSettings.mockResolvedValue({});
    const { keepAldoMachineSettings, loadAldoMachineSettings } = await store();
    await loadAldoMachineSettings();
    const patch = { enableAgentBrowserAccess: true };
    const plan = planScopedSettingsPatch(all, [asleep], patch);
    expect(keepAldoMachineSettings(aldo, patch, plan)).toBe(plan);
    // A partial text generation model isn't the user's whole choice: the machines complete it.
    const partial = { textGenerationModelSelection: { model: "gpt-5.1" } };
    expect(keepAldoMachineSettings(aldo, partial, plan)).toBe(plan);
    expect(cloud.saveAldoMachineSettings).not.toHaveBeenCalled();
  });

  it("saves nothing to Aldo for one machine or a project (the scope's `aldo` is null)", async () => {
    cloud.fetchAldoMachineSettings.mockResolvedValue({});
    const { keepAldoMachineSettings, loadAldoMachineSettings } = await store();
    await loadAldoMachineSettings();
    const patch = { defaultRuntimeMode: "auto" } as const;
    const plan = planScopedSettingsPatch(all, [asleep], patch);
    expect(keepAldoMachineSettings(null, patch, plan)).toBe(plan);
    expect(cloud.saveAldoMachineSettings).not.toHaveBeenCalled();
  });

  it("works as before with an Aldo that doesn't keep them", async () => {
    cloud.fetchAldoMachineSettings.mockResolvedValue(null);
    const { keepAldoMachineSettings, loadAldoMachineSettings } = await store();
    expect(await loadAldoMachineSettings()).toBeNull();
    const patch = { defaultRuntimeMode: "auto" } as const;
    const plan = planScopedSettingsPatch(all, [asleep], patch);
    expect(keepAldoMachineSettings(aldo, patch, plan)).toBe(plan);
    expect(cloud.saveAldoMachineSettings).not.toHaveBeenCalled();
  });

  it("says so when Aldo couldn't save one, and shows what it has", async () => {
    cloud.fetchAldoMachineSettings.mockResolvedValue({ defaultRuntimeMode: "auto" });
    cloud.saveAldoMachineSettings.mockRejectedValue(new Error("Aldo is down."));
    const { getAldoMachineSettings, keepAldoMachineSettings, loadAldoMachineSettings } =
      await store();
    await loadAldoMachineSettings();
    const patch = { defaultRuntimeMode: "approval-required" } as const;
    keepAldoMachineSettings(aldo, patch, planScopedSettingsPatch(all, [asleep], patch));
    await vi.waitFor(() =>
      expect(toasts.add).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error", description: "Aldo is down." }),
      ),
    );
    await vi.waitFor(() =>
      expect(getAldoMachineSettings()).toEqual({ defaultRuntimeMode: "auto" }),
    );
  });
});
