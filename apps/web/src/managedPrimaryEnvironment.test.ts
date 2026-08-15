import { EnvironmentId, type ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const DESCRIPTOR = {
  environmentId: EnvironmentId.make("environment-managed"),
  label: "Managed workspace",
  platform: { os: "linux", arch: "x64" },
  serverVersion: "0.0.0-test",
  capabilities: { repositoryIdentity: true },
} satisfies ExecutionEnvironmentDescriptor;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("managed primary environment descriptor cache", () => {
  it("round-trips validated metadata for a sleeping managed workspace", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    const { readManagedPrimaryEnvironmentDescriptor, writeManagedPrimaryEnvironmentDescriptor } =
      await import("./managedPrimaryEnvironment");

    writeManagedPrimaryEnvironmentDescriptor(DESCRIPTOR);

    expect(readManagedPrimaryEnvironmentDescriptor()).toEqual(DESCRIPTOR);
  });

  it("rejects malformed or non-managed cached data", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => JSON.stringify({ environmentId: "missing-required-fields" }),
      },
    });
    let cache = await import("./managedPrimaryEnvironment");
    expect(cache.readManagedPrimaryEnvironmentDescriptor()).toBeNull();

    vi.stubEnv("VITE_DEVPC_MANAGED", "0");
    vi.resetModules();
    cache = await import("./managedPrimaryEnvironment");
    expect(cache.readManagedPrimaryEnvironmentDescriptor()).toBeNull();
  });
});
