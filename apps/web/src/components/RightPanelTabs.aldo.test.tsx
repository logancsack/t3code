import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";

vi.stubEnv("VITE_ALDO_CLOUD", "1");
vi.resetModules();
// The preview panel clamps its width against the viewport.
vi.stubGlobal("window", { innerWidth: 1280 });

const { RightPanelTabs } = await import("./RightPanelTabs");

describe("RightPanelTabs in Aldo", () => {
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("offers no Device surface, since Aldo's machines can't run simulators", () => {
    const markup = renderToStaticMarkup(
      <RightPanelTabs
        mode="inline"
        maximized={false}
        surfaces={[]}
        environmentId={null}
        activeSurfaceId={null}
        pendingSurfaceIds={new Set()}
        previewSessions={{}}
        desktopByTabId={{}}
        terminalLabelsById={new Map()}
        onActivate={() => {}}
        onCloseSurface={() => {}}
        onCloseOtherSurfaces={() => {}}
        onCloseSurfacesToRight={() => {}}
        onCloseAllSurfaces={() => {}}
        onCopyFilePath={() => {}}
        onAddBrowser={() => {}}
        onAddBrowserInProfile={() => {}}
        onAddTerminal={() => {}}
        onAddDiff={() => {}}
        onAddFiles={() => {}}
        onAddPullRequest={() => {}}
        onAddPullRequests={() => {}}
        onAddAgents={() => {}}
        onAddDevice={() => {}}
        liveAgentCount={0}
        browserAvailable
        terminalAvailable
        diffAvailable
        filesAvailable
        pullRequestAvailable
        pullRequestsAvailable
        agentsAvailable
        deviceAvailable
      >
        {null}
      </RightPanelTabs>,
    );
    expect(markup).toContain(">Agents<");
    expect(markup).not.toContain(">Device<");
    expect(markup).not.toContain("iOS Simulator");
  });
});
