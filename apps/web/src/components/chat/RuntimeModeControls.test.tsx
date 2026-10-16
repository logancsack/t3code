// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import { ComposerFooterModeControls } from "./ChatComposer";
import { CompactComposerControlsMenu } from "./CompactComposerControlsMenu";

it("prevents changing a provider's fixed runtime mode in desktop and compact controls", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const changeMode = vi.fn();
  const props = {
    showInteractionModeToggle: false,
    interactionMode: "default" as const,
    runtimeMode: "full-access" as const,
    supportedRuntimeModes: ["full-access"] as const,
    onToggleInteractionMode: vi.fn(),
    onRuntimeModeChange: changeMode,
  };
  try {
    await act(async () => root.render(<ComposerFooterModeControls {...props} />));
    const desktop = container.querySelector<HTMLButtonElement>('[aria-label^="Runtime mode"]');
    expect(desktop).not.toBeNull();
    await act(async () => desktop!.click());
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(changeMode).not.toHaveBeenCalled();

    await act(async () => root.render(<CompactComposerControlsMenu {...props} />));
    const compact = container.querySelector<HTMLButtonElement>(
      '[aria-label^="More composer controls"]',
    );
    expect(compact).not.toBeNull();
    await act(async () => compact!.click());
    const fixedMode = document.querySelector<HTMLElement>(
      '[role="menuitem"][aria-label="Full access required"]',
    );
    expect(fixedMode).not.toBeNull();
    await act(async () => fixedMode!.click());
    expect(document.querySelector('[role="menuitemradio"]')).toBeNull();
    expect(changeMode).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
