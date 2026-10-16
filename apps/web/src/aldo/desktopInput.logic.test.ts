// @vitest-environment jsdom

import { expect, it, vi } from "vite-plus/test";
import { listenForAppShortcuts } from "./desktopInput.logic";

it("leaves desktop key events for noVNC, handles app shortcuts elsewhere, and stops listening", () => {
  const desktop = document.createElement("div");
  desktop.dataset.aldoDesktop = "";
  const screen = document.createElement("canvas");
  desktop.append(screen);
  const composer = document.createElement("textarea");
  document.body.append(desktop, composer);
  const appShortcut = vi.fn((event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
  });
  const remoteKeyboard = vi.fn();
  screen.addEventListener("keydown", remoteKeyboard);
  const stop = listenForAppShortcuts(appShortcut);
  try {
    for (const key of ["a", "Enter", "Escape", "Control", "c"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      screen.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(remoteKeyboard).toHaveBeenCalledTimes(5);
    expect(appShortcut).not.toHaveBeenCalled();

    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    composer.dispatchEvent(event);
    expect(appShortcut).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);

    stop();
    composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(appShortcut).toHaveBeenCalledOnce();
  } finally {
    stop();
    desktop.remove();
    composer.remove();
  }
});
