import { describe, expect, it } from "vite-plus/test";

import { sameSnapShotShortcut, snapShotKeybindingConflict } from "./snapShotShortcut";

describe("window capture keybinding conflicts", () => {
  it("finds an effective T3 Code keybinding on the current platform", () => {
    expect(
      snapShotKeybindingConflict(
        {
          key: "n",
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          modKey: true,
        },
        [
          {
            command: "chat.new",
            shortcut: {
              key: "n",
              metaKey: true,
              ctrlKey: false,
              shiftKey: false,
              altKey: false,
              modKey: false,
            },
          },
        ],
        "MacIntel",
      ),
    ).toBe("chat.new");
  });

  it("does not conflict with regular keybindings for both Shift keys", () => {
    expect(snapShotKeybindingConflict({ kind: "both-shift-keys" }, [], "Linux")).toBeNull();
  });

  it("keeps symbols on different physical keys distinct", () => {
    const modifiers = {
      metaKey: false,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      modKey: true,
    } as const;

    expect(
      snapShotKeybindingConflict(
        { key: '"', ...modifiers },
        [
          {
            command: "capture.other",
            shortcut: { key: "'", ...modifiers },
          },
        ],
        "MacIntel",
      ),
    ).toBeNull();
  });
});

describe("sameSnapShotShortcut", () => {
  it("compares the physical Shift pair and platform-equivalent chords", () => {
    expect(
      sameSnapShotShortcut({ kind: "both-shift-keys" }, { kind: "both-shift-keys" }, "MacIntel"),
    ).toBe(true);
    expect(
      sameSnapShotShortcut(
        { kind: "both-shift-keys" },
        { kind: "modifier-pair", modifier: "shift" },
        "MacIntel",
      ),
    ).toBe(true);
    expect(
      sameSnapShotShortcut(
        { kind: "modifier-pair", modifier: "meta" },
        { kind: "both-shift-keys" },
        "MacIntel",
      ),
    ).toBe(false);
    expect(
      sameSnapShotShortcut(
        { key: "n", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, modKey: true },
        { key: "n", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, modKey: false },
        "MacIntel",
      ),
    ).toBe(true);
  });
});
