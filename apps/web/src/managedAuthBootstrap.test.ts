import { afterEach, describe, expect, it, vi } from "vite-plus/test";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("managed sleeping auth bootstrap", () => {
  it("trusts the authenticated managed gateway without contacting the guest", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    vi.stubGlobal("window", {
      location: new URL("https://aldo.example.test/"),
      history: { replaceState: vi.fn() },
      __DEVPC_MANAGED_BOOTSTRAP__: {
        managed: true,
        state: "stopped",
        status: "stopped",
        ready: false,
        previewUrlTemplate: "https://{port}.preview.example.test/",
      },
    });
    vi.stubGlobal("document", { title: "Aldo" });
    const fetchMock = vi.fn(() => {
      throw new Error("The sleeping guest must not receive an auth request.");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { resolveInitialServerAuthGateState } = await import("./environments/primary");

    await expect(resolveInitialServerAuthGateState()).resolves.toEqual({
      status: "authenticated",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
