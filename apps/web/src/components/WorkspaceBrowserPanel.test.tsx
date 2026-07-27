import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const GRANT_URL =
  "https://6080--devpc.preview.example.test/vnc.html?grant=abc&autoconnect=true&resize=remote";

async function renderPanel(input: { managed?: boolean; grantUrl?: string | null }) {
  vi.stubEnv("VITE_DEVPC_MANAGED", input.managed === false ? "" : "1");
  vi.resetModules();
  vi.stubGlobal("window", {
    location: { origin: "https://app.example.test" },
    __DEVPC_MANAGED_BOOTSTRAP__: {
      managed: true,
      state: "ready",
      ready: true,
      previewUrlTemplate: "https://{port}--devpc.preview.example.test/",
      ...(input.grantUrl === null ? {} : { previewUrls: { "6080": input.grantUrl ?? GRANT_URL } }),
    },
  });

  const { WorkspaceBrowserPanel } = await import("./WorkspaceBrowserPanel");
  return renderToStaticMarkup(<WorkspaceBrowserPanel />);
}

describe("WorkspaceBrowserPanel", () => {
  it("renders the shared browser as a frame, not a desktop-app notice", async () => {
    // The whole reason this is not a preview surface: preview rendering needs the
    // Electron desktop bridge, so on a managed workspace it only ever produced
    // "Preview is only available in the T3 Code desktop app".
    const markup = await renderPanel({});

    expect(markup).toContain("<iframe");
    expect(markup).toContain(GRANT_URL.replace(/&/g, "&amp;"));
    expect(markup).not.toContain("desktop app");
  });

  it("uses the granted URL untouched, so the noVNC viewer options survive", async () => {
    const markup = await renderPanel({});

    // resize=remote is what makes the remote screen follow the panel size; losing
    // it gives a phone a scaled-down desktop instead of a phone-shaped screen.
    expect(markup).toContain("resize=remote");
    expect(markup).toContain("autoconnect=true");
  });

  it("does not let a touch drag scroll the panel instead of the remote screen", async () => {
    const markup = await renderPanel({});

    expect(markup).toContain("touch-none");
  });

  it("explains itself when the workspace has no shared browser", async () => {
    const markup = await renderPanel({ grantUrl: null });

    expect(markup).not.toContain("<iframe");
    expect(markup).toContain("does not provide a shared browser");
  });

  it("renders nothing framed outside a managed workspace", async () => {
    const markup = await renderPanel({ managed: false });

    expect(markup).not.toContain("<iframe");
  });
});
