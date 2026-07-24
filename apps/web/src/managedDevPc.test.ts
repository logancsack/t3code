import { afterEach, describe, expect, it, vi } from "vite-plus/test";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("managed DevPC preview URLs", () => {
  it("fills the managed port template and preserves the requested path", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    vi.stubGlobal("window", {
      location: { origin: "https://app.example.test" },
      __DEVPC_MANAGED_BOOTSTRAP__: {
        managed: true,
        state: "ready",
        ready: true,
        previewUrlTemplate: "https://{port}.preview.example.test/",
      },
    });

    const { resolveManagedPreviewUrl } = await import("./managedDevPc");
    expect(resolveManagedPreviewUrl(5173, "/assets/app.js?x=1")).toBe(
      "https://5173.preview.example.test/assets/app.js?x=1",
    );
  });
});
