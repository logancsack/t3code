import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, expect, it, vi } from "vite-plus/test";

import type { AldoEnvironment } from "./directory";

const host = vi.hoisted(() => ({
  sync: null as ((environments: ReadonlyArray<AldoEnvironment>) => Promise<void>) | null,
  template: { providers: [] as Record<string, unknown>[], environment: {}, settings: {} },
  settings: {} as Record<string, unknown>,
  cached: new Map<string, string>(),
  local: new Map<string, string>(),
  seeds: vi.fn(),
  refreshed: vi.fn(),
}));

vi.mock("../connection/storage", async () => {
  const { withAldoTemplate } = await import("./serverConfig.logic");
  return {
    readCachedShells: async () => new Map(),
    seedEnvironmentCache: vi.fn(),
    seedMissingServerConfigs: async (
      config: typeof host.template,
      ids: EnvironmentId[],
      settings: Record<string, unknown>,
    ) => {
      host.seeds(ids);
      const written: EnvironmentId[] = [];
      const kept: EnvironmentId[] = [];
      for (const id of ids) {
        const next = withAldoTemplate(host.cached.get(id), config, settings);
        if (next === null) kept.push(id);
        else {
          host.cached.set(id, next);
          written.push(id);
        }
      }
      return { written, kept };
    },
  };
});
vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: () => new Map([["aldo-sleeping", { connection: { phase: "available" } }]]),
    subscribe: () => () => undefined,
    refresh: host.refreshed,
  },
}));
vi.mock("../state/presentation", () => ({
  environmentPresentations: { presentationsAtom: "presentations" },
}));
vi.mock("../state/server", () => ({
  serverEnvironment: {
    configProjection: ({ environmentId }: { environmentId: string }) => environmentId,
  },
}));
vi.mock("../state/shell", () => ({ environmentShell: { stateAtom: vi.fn() } }));
vi.mock("./threadApi", () => ({ fetchAldoShells: vi.fn(), offerAldoShell: vi.fn() }));
vi.mock("./api", () => ({ isAldoCloud: true }));
vi.mock("./directory", () => ({
  setAldoDirectorySync: (sync: typeof host.sync) => {
    host.sync = sync;
  },
}));
vi.mock("./machineSettings", () => ({
  getAldoMachineSettings: () => host.settings,
  loadAldoMachineSettings: async () => host.settings,
  subscribeAldoMachineSettings: () => () => undefined,
}));
vi.mock("./serverConfig", () => ({ aldoServerConfigTemplate: async () => host.template }));
vi.mock("./startingThreads", () => ({
  aldoShowsStartingThread: () => false,
  clearLeftoverAldoThreads: async () => undefined,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  host.cached.clear();
  host.local.clear();
  host.seeds.mockClear();
  host.refreshed.mockClear();
  host.sync = null;
  host.settings = {};
});

it("updates an already-seeded sleeping picker when models change, including across visits", async () => {
  const id = EnvironmentId.make("aldo-sleeping");
  const provider = {
    instanceId: "claudeAgent",
    driver: "claudeAgent",
    checkedAt: "2026-11-19T01:00:00Z",
    usageLimits: { checkedAt: "2026-11-19T01:00:00Z", windows: [] },
    models: [{ slug: "incumbent", name: "Incumbent", isDefault: true }],
  };
  host.template.providers = [provider];
  host.cached.set(id, JSON.stringify({ config: { providers: [provider], settings: {} } }));
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => host.local.get(key) ?? null,
      setItem: (key: string, value: string) => host.local.set(key, value),
    },
  });
  (await import("./shells")).installAldoShellSync();
  const environment: AldoEnvironment = {
    environmentId: id,
    threadId: "sleeping",
    label: "Sleeping",
    repo: "",
    branch: "",
    state: "stopped",
  };
  const sync = async () => {
    await host.sync!([environment]);
    // Model seeding is intentionally detached from shell downloads; drain its resolved promises.
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
  const cached = () => JSON.parse(host.cached.get(id)!).config;
  await sync();
  expect(host.seeds).toHaveBeenCalledOnce();
  await sync();
  expect(host.seeds).toHaveBeenCalledOnce();

  const future = { slug: "future", name: "Future", capabilities: { reasoning: ["high"] } };
  host.template.providers = [
    { ...provider, checkedAt: "2026-11-19T02:00:00Z", models: [...provider.models, future] },
  ];
  await sync();
  expect(cached().providers[0].models).toEqual([...provider.models, future]);
  expect(host.refreshed).toHaveBeenCalledWith(id);

  // A new page loads the persisted modelsChecked entry for the same provider IDs.
  vi.resetModules();
  (await import("./shells")).installAldoShellSync();
  const renamed = {
    ...future,
    name: "Future model",
    capabilities: { reasoning: ["high", "xhigh"] },
  };
  host.template.providers = [
    { ...provider, checkedAt: "2026-11-19T03:00:00Z", models: [...provider.models, renamed] },
  ];
  await sync();
  expect(cached().providers[0].models).toEqual([...provider.models, renamed]);
  expect(host.seeds).toHaveBeenCalledTimes(3);

  host.template.providers = [
    {
      ...host.template.providers[0],
      checkedAt: "2026-11-19T04:00:00Z",
      usageLimits: { checkedAt: "2026-11-19T04:00:00Z", windows: [{ usedPercent: 20 }] },
    },
  ];
  await sync();
  expect(host.seeds).toHaveBeenCalledTimes(3);
  host.settings = { responseStreamingMode: "turn" };
  await sync();
  expect(cached().settings.responseStreamingMode).toBe("turn");
  expect(cached().providers[0].models[0].isDefault).toBe(true);

  host.template.providers = [
    {
      ...host.template.providers[0],
      checkedAt: "2026-11-19T05:00:00Z",
      availability: "unavailable",
    },
  ];
  await sync();
  expect(cached().providers[0].availability).toBe("unavailable");
});
