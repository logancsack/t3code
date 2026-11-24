import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { RightPanelTabs } from "./RightPanelTabs";

vi.mock(import("../aldo/api"), async (original) => ({ ...(await original()), isAldoCloud: true }));

describe("RightPanelTabs in Aldo, on work that isn't code", () => {
  it("opens the add menu with the rest of the surfaces under More", async () => {
    await using _screen = await render(
      <RightPanelTabs
        mode="inline"
        maximized={false}
        offersPullRequests={false}
        keybindings={[]}
        getShortcutContext={() => ({
          terminalFocus: false,
          terminalOpen: false,
          previewFocus: false,
          previewOpen: false,
          isWeb: true,
          isDesktop: false,
        })}
        surfaces={[{ id: "browser:tab-1", kind: "preview", resourceId: "tab-1" }]}
        environmentId={null}
        activeSurfaceId="browser:tab-1"
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
        onAddDevice={() => {}}
        browserAvailable
        terminalAvailable
        diffAvailable
        filesAvailable
        pullRequestAvailable={false}
        pullRequestsAvailable={false}
        deviceAvailable
      >
        {null}
      </RightPanelTabs>,
    );

    await page.getByRole("button", { name: "Add panel surface" }).click();

    const menu = () => document.querySelector('[role="menu"]')?.textContent ?? "";
    await expect.poll(menu).toContain("More");
    const more = [...document.querySelectorAll('[role="group"]')].find((group) =>
      group.textContent?.startsWith("More"),
    );
    expect(more?.textContent).toContain("Terminal");
    expect(more?.textContent).toContain("Diff");
    expect(menu()).not.toContain("Device");
    expect(menu()).not.toContain("iOS Simulator");
  });
});
