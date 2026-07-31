import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";

vi.stubEnv("VITE_DEVPC_MANAGED", "1");
vi.resetModules();
vi.stubGlobal("window", {
  __DEVPC_MANAGED_BOOTSTRAP__: {
    managed: true,
    state: "ready",
    ready: true,
    previewUrlTemplate: "",
    previewUrls: { "6080": "/_devpc/browser" },
  },
});

const { RightPanelTabs } = await import("./RightPanelTabs");

function markupWith(onAddWorkspaceBrowser: (() => void) | undefined) {
  return renderToStaticMarkup(
    <RightPanelTabs
      mode="inline"
      maximized={false}
      surfaces={[]}
      activeSurfaceId={null}
      pendingSurfaceIds={new Set()}
      previewSessions={{}}
      terminalLabelsById={new Map()}
      onActivate={() => {}}
      onCloseSurface={() => {}}
      onCloseOtherSurfaces={() => {}}
      onCloseSurfacesToRight={() => {}}
      onCloseAllSurfaces={() => {}}
      onCopyFilePath={() => {}}
      onAddBrowser={() => {}}
      {...(onAddWorkspaceBrowser ? { onAddWorkspaceBrowser } : {})}
      onAddTerminal={() => {}}
      onAddDiff={() => {}}
      onAddFiles={() => {}}
      onAddAgents={() => {}}
      browserAvailable={false}
      diffAvailable={false}
      filesAvailable={false}
    >
      {null}
    </RightPanelTabs>,
  );
}

describe("RightPanelTabs surface picker", () => {
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("shows the workspace browser card instead of the disabled Browser card", () => {
    const markup = markupWith(() => {});
    expect(markup).toContain("Workspace browser");
    expect(markup).not.toContain("Open a local app or URL.");
  });
  it("keeps the Browser card when no workspace browser exists", () => {
    const markup = markupWith(undefined);
    expect(markup).not.toContain("Workspace browser");
    expect(markup).toContain("Open a local app or URL.");
  });
});
