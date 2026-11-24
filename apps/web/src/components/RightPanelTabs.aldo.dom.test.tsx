// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("gt-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("gt-react")>()),
  useGT:
    () =>
    (text: string, values: Record<string, unknown> = {}) =>
      text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key])),
  useMessages: () => (text: string) => text,
  T: ({ children }: { children: ReactNode }) => children,
  Var: ({ children }: { children: ReactNode }) => children,
}));

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
    expect(more?.textContent).toContain("Diff");
    expect(menu?.textContent).not.toContain("Device");
    expect(menu?.textContent).not.toContain("iOS Simulator");
  });
});
