/** Remote desktop keystrokes belong to the computer, including app shortcuts. */
export function aldoDesktopOwnsKeyboard(target: unknown): boolean {
  return (
    target !== null &&
    typeof target === "object" &&
    "closest" in target &&
    typeof target.closest === "function" &&
    target.closest("[data-aldo-desktop]") !== null
  );
}

/** Leave desktop keystrokes for noVNC before the app claims any shortcut. */
export function listenForAppShortcuts(handler: (event: KeyboardEvent) => void): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (!aldoDesktopOwnsKeyboard(event.target)) handler(event);
  };
  window.addEventListener("keydown", onKeyDown, true);
  return () => window.removeEventListener("keydown", onKeyDown, true);
}
