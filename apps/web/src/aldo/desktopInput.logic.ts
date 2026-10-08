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
