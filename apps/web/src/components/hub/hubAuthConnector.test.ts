import type { AuthConnectorSession } from "@t3tools/contracts";
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

const HUB_BOOTSTRAP = {
  serverMode: "hub",
  threadBrowserUrlTemplate: "/_devpc/threads/{threadId}/browser",
};

function session(patch: Partial<AuthConnectorSession> = {}): AuthConnectorSession {
  return {
    id: "session",
    connector: "cursor",
    method: "account",
    status: "starting",
    flow: "browser",
    stage: "preparing",
    message: "Starting a machine for sign-in…",
    verificationUrl: null,
    userCode: null,
    fields: [],
    expiresAt: null,
    ...patch,
  };
}

describe("resolveAuthWorkspaceBrowserUrl", () => {
  it("opens the browser the hub's sign-in session names", async () => {
    const { resolveAuthWorkspaceBrowserUrl } = await load(HUB_BOOTSTRAP);
    expect(
      resolveAuthWorkspaceBrowserUrl(
        session({ workspaceBrowserUrl: "/_devpc/threads/aldo-provider-sign-in/browser" }),
      ),
    ).toBe("/_devpc/threads/aldo-provider-sign-in/browser");
  });

  it("has no browser on a hub until the session names one", async () => {
    const { resolveAuthWorkspaceBrowserUrl } = await load(HUB_BOOTSTRAP);
    expect(resolveAuthWorkspaceBrowserUrl(session({ workspaceBrowserUrl: null }))).toBeNull();
    expect(resolveAuthWorkspaceBrowserUrl(null)).toBeNull();
  });

  it("keeps the shared workspace browser on a persistent workspace", async () => {
    const { resolveAuthWorkspaceBrowserUrl } = await load({
      previewUrlTemplate: "https://{port}.preview.example.test/",
      previewUrls: { "6080": "https://6080.preview.example.test/vnc.html" },
    });
    expect(resolveAuthWorkspaceBrowserUrl(session())).toBe(
      "https://6080.preview.example.test/vnc.html",
    );
  });
});

describe("hubAuthConnectorProgress", () => {
  it("shows the hub's staged messages while it starts the machine and saves the sign-in", async () => {
    const { hubAuthConnectorProgress } = await load(HUB_BOOTSTRAP);
    expect(hubAuthConnectorProgress(session())).toBe("Starting a machine for sign-in…");
    expect(
      hubAuthConnectorProgress(session({ stage: "verifying", message: "Saving your sign-in…" })),
    ).toBe("Saving your sign-in…");
  });

  it("stays quiet once the provider asks the user for something", async () => {
    const { hubAuthConnectorProgress } = await load(HUB_BOOTSTRAP);
    expect(
      hubAuthConnectorProgress(session({ status: "waiting", stage: "authorize", message: "Go" })),
    ).toBeNull();
    expect(hubAuthConnectorProgress(null)).toBeNull();
  });
});
