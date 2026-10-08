// @effect-diagnostics nodeBuiltinImport:off

import * as NodeFS from "node:fs";
import { describe, expect, it, vi } from "vite-plus/test";
import { aldoDesktopOwnsKeyboard } from "./desktopInput.logic";

// Exercise the real capture-handler entry before any terminal/chat shortcut runs.
const chatView = NodeFS.readFileSync(
  new URL("../components/ChatView.tsx", import.meta.url),
  "utf8",
);
const captureEntry = chatView
  .split("const handler = (event: globalThis.KeyboardEvent) => {")[1]!
  .split("if (preventRepeatedTerminalCloseShortcut(event, keybindings)) {")[0]!;

describe("remote desktop keyboard ownership", () => {
  it.each(["a", "Enter", "Escape", "Control", "c"])(
    "lets desktop %s events reach noVNC before app shortcut processing",
    (key) => {
      const processAppShortcut = vi.fn();
      const handler = new Function(
        "aldoDesktopOwnsKeyboard",
        "processAppShortcut",
        `return (event) => { ${captureEntry} processAppShortcut(event); };`,
      )(aldoDesktopOwnsKeyboard, processAppShortcut);
      const event = {
        key,
        target: { closest: (selector: string) => (selector === "[data-aldo-desktop]" ? {} : null) },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      };
      handler(event);
      expect(processAppShortcut).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopPropagation).not.toHaveBeenCalled();
    },
  );

  it("keeps normal app keyboard handling available outside the desktop", () => {
    const processAppShortcut = vi.fn();
    const handler = new Function(
      "aldoDesktopOwnsKeyboard",
      "processAppShortcut",
      `return (event) => { ${captureEntry} processAppShortcut(event); };`,
    )(aldoDesktopOwnsKeyboard, processAppShortcut);
    handler({ target: { closest: () => null } });
    expect(processAppShortcut).toHaveBeenCalledOnce();
    expect(aldoDesktopOwnsKeyboard(null)).toBe(false);
    expect(aldoDesktopOwnsKeyboard({})).toBe(false);
  });
});
