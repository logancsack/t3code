// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.stubEnv("VITE_ALDO_CLOUD", "1");
vi.resetModules();

const { RightPanelTabs } = await import("./RightPanelTabs");

let root: Root;
let container: HTMLDivElement;
let uncaught: unknown[];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom has no layout or animations; the tab strip watches its size for
  // overflow and the scroll area waits on its animations.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  uncaught = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container, { onUncaughtError: (error) => uncaught.push(error) });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("RightPanelTabs in Aldo, on work that isn't code", () => {
  it("opens the add menu with the rest of the surfaces under More", async () => {
    await act(async () => {
      root.render(
        <RightPanelTabs
          mode="inline"
          maximized={false}
          offersPullRequests={false}
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
          onAddAgents={() => {}}
          onAddDevice={() => {}}
          liveAgentCount={0}
          browserAvailable
          terminalAvailable
          diffAvailable
          filesAvailable
          pullRequestAvailable={false}
          pullRequestsAvailable={false}
          agentsAvailable
          deviceAvailable
        >
          {null}
        </RightPanelTabs>,
      );
    });

    const trigger = document.querySelector<HTMLButtonElement>('[aria-label="Add panel surface"]');
    expect(trigger).not.toBeNull();
    await act(async () => trigger!.click());

    expect(uncaught).toEqual([]);
    const menu = document.querySelector('[role="menu"]');
    expect(menu?.textContent).toContain("More");
    const more = [...document.querySelectorAll('[role="group"]')].find((group) =>
      group.textContent?.startsWith("More"),
    );
    expect(more?.textContent).toContain("Terminal");
    expect(more?.textContent).toContain("Helpers");
    expect(menu?.textContent).not.toContain("Device");
    expect(menu?.textContent).not.toContain("iOS Simulator");
  });
});
