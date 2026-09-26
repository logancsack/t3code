import { afterEach, describe, expect, it, vi } from "vite-plus/test";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function load(bootstrap: Record<string, unknown>) {
  vi.stubEnv("VITE_DEVPC_MANAGED", "1");
  vi.resetModules();
  vi.stubGlobal("window", {
    location: { origin: "https://app.example.test" },
    __DEVPC_MANAGED_BOOTSTRAP__: { managed: true, state: "ready", ready: true, ...bootstrap },
  });
  return import("./hubAuthConnector");
}

describe("resolveAuthWorkspaceBrowserUrl", () => {
  it("prefers the browser the sign-in session names", async () => {
    const { resolveAuthWorkspaceBrowserUrl } = await load({
      serverMode: "hub",
      threadBrowserUrlTemplate: "/_devpc/threads/{threadId}/browser",
    });
    expect(
      resolveAuthWorkspaceBrowserUrl({ id: "session", workspaceBrowserUrl: "/_aldo/sign-in" }),
    ).toBe("/_aldo/sign-in");
  });

  it("opens the hub's sign-in machine browser when the session names none", async () => {
    const { resolveAuthWorkspaceBrowserUrl } = await load({
      serverMode: "hub",
      threadBrowserUrlTemplate: "/_devpc/threads/{threadId}/browser",
    });
    expect(resolveAuthWorkspaceBrowserUrl({ id: "session" })).toBe(
      "/_devpc/threads/aldo-provider-sign-in/browser",
    );
    expect(resolveAuthWorkspaceBrowserUrl(null)).toBe(
      "/_devpc/threads/aldo-provider-sign-in/browser",
    );
  });

  it("keeps the shared workspace browser on a persistent workspace", async () => {
    const { resolveAuthWorkspaceBrowserUrl } = await load({
      previewUrlTemplate: "https://{port}.preview.example.test/",
      previewUrls: { "6080": "https://6080.preview.example.test/vnc.html" },
    });
    expect(resolveAuthWorkspaceBrowserUrl(null)).toBe("https://6080.preview.example.test/vnc.html");
  });
});
