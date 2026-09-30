import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const hubConfig = {
  environment: { capabilities: { repositoryIdentity: true, threadMachines: true } },
};
const standaloneConfig = { environment: { capabilities: { repositoryIdentity: true } } };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function loadHubMode(input: {
  readonly managed: boolean;
  readonly bootstrap?: Record<string, unknown>;
  readonly cachedDescriptor?: unknown;
}) {
  vi.stubEnv("VITE_DEVPC_MANAGED", input.managed ? "1" : "0");
  vi.resetModules();
  const storage = new Map<string, string>();
  if (input.cachedDescriptor) {
    storage.set(
      "t3-managed-primary-environment-descriptor-v1",
      JSON.stringify(input.cachedDescriptor),
    );
  }
  vi.stubGlobal("window", {
    __DEVPC_MANAGED_BOOTSTRAP__: input.bootstrap,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  return import("./hubMode");
}

describe("resolveIsHubEnvironment", () => {
  it("follows the loaded server config for every environment", async () => {
    const { resolveIsHubEnvironment } = await loadHubMode({ managed: false });
    const managedPrimaryIsHub = () => true;
    expect(
      resolveIsHubEnvironment({ config: hubConfig, isPrimary: false, managedPrimaryIsHub }),
    ).toBe(true);
    // A loaded standalone config wins over a stale managed hint.
    expect(
      resolveIsHubEnvironment({ config: standaloneConfig, isPrimary: true, managedPrimaryIsHub }),
    ).toBe(false);
  });

  it("falls back to the managed bootstrap only for a primary without a config", async () => {
    const { resolveIsHubEnvironment } = await loadHubMode({ managed: false });
    const managedPrimaryIsHub = () => true;
    expect(resolveIsHubEnvironment({ config: null, isPrimary: true, managedPrimaryIsHub })).toBe(
      true,
    );
    expect(resolveIsHubEnvironment({ config: null, isPrimary: false, managedPrimaryIsHub })).toBe(
      false,
    );
  });
});

describe("readManagedPrimaryIsHub", () => {
  it("reads a hub bootstrap so the first render never shows local-checkout controls", async () => {
    const { readManagedPrimaryIsHub } = await loadHubMode({
      managed: true,
      bootstrap: { managed: true, serverMode: "hub", state: "ready", ready: true },
    });
    expect(readManagedPrimaryIsHub()).toBe(true);
  });

  it("reads the cached environment descriptor when the bootstrap says nothing", async () => {
    const { readManagedPrimaryIsHub } = await loadHubMode({
      managed: true,
      bootstrap: { managed: true, state: "ready", ready: true },
      cachedDescriptor: {
        environmentId: "environment-hub",
        label: "Aldo",
        platform: { os: "linux", arch: "x64" },
        serverVersion: "0.0.0-test",
        capabilities: { repositoryIdentity: true, threadMachines: true },
      },
    });
    expect(readManagedPrimaryIsHub()).toBe(true);
  });

  it("is never a hub outside a managed build", async () => {
    const { readManagedPrimaryIsHub } = await loadHubMode({
      managed: false,
      bootstrap: { managed: true, serverMode: "hub" },
    });
    expect(readManagedPrimaryIsHub()).toBe(false);
  });
});

describe("hubNewThreadOptions", () => {
  it("turns a carried-over checkout into a fresh machine checkout from the same branch", async () => {
    const { hubNewThreadOptions } = await loadHubMode({ managed: false });
    expect(
      hubNewThreadOptions({
        branch: "feature/login",
        worktreePath: "/workspace/t/thread-1",
        envMode: "local",
        startFromOrigin: true,
      }),
    ).toEqual({
      branch: "feature/login",
      worktreePath: null,
      envMode: "worktree",
      startFromOrigin: false,
    });
  });

  it("leaves absent options absent so existing drafts keep their context", async () => {
    const { hubNewThreadOptions } = await loadHubMode({ managed: false });
    expect(hubNewThreadOptions(undefined)).toBeUndefined();
    // The caller's full option shape, with only `replace` given.
    const replaceOnly: Parameters<typeof hubNewThreadOptions>[0] & { replace?: boolean } = {
      replace: true,
    };
    expect(hubNewThreadOptions(replaceOnly)).toEqual({ replace: true });
  });
});

describe("hub project helpers", () => {
  it("uses the virtual root the hub assigns", async () => {
    const { hubProjectWorkspaceRoot } = await loadHubMode({ managed: false });
    expect(hubProjectWorkspaceRoot("project-1")).toBe("/workspace/p/project-1");
  });

  it("names a project by its repository, or as blank", async () => {
    const { hubProjectLocationLabel } = await loadHubMode({ managed: false });
    expect(
      hubProjectLocationLabel({
        repositoryIdentity: { locator: { remoteUrl: "https://github.com/acme/app" } },
      }),
    ).toBe("https://github.com/acme/app");
    expect(hubProjectLocationLabel({ repositoryIdentity: null })).toBe("Blank project");
  });
});
