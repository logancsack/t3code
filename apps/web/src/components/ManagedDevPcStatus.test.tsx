import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("ManagedDevPcStatus", () => {
  it("renders workspace state and restart as sidebar utility controls", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    vi.stubGlobal("window", {
      __DEVPC_MANAGED_BOOTSTRAP__: {
        managed: true,
        state: "ready",
        ready: true,
        previewUrlTemplate: "https://{port}.preview.example.test/",
      },
    });

    const { ManagedDevPcStatus } = await import("./ManagedDevPcStatus");
    const markup = renderToStaticMarkup(<ManagedDevPcStatus />);

    expect(markup).toContain('data-devpc-workspace-status="ready"');
    expect(markup).toContain("Dev PC · Online");
    expect(markup).toContain('aria-label="Restart Dev PC"');
    expect(markup).not.toContain("fixed");
  });
});
