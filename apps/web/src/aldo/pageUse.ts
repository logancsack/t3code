// When the user last used the page (preload.ts notes each use: the pointer,
// a key, a touch, the wheel, or coming back to the tab or window), and
// whether the page is in use now: visible, focused and used lately
// (focus.logic.ts). Home's read says so (homeFeed.ts), for Aldo to hold back
// what the user would see here from their phone. No imports of the app's, so
// anything can read it.

import { aldoPageInUse } from "./focus.logic";

let lastUsedAt = Date.now();

export function noteAldoPageUse(at = Date.now()): void {
  lastUsedAt = at;
}

/** When the user last used the page (focus.ts tells a page in use from one left alone). */
export function aldoPageUsedAt(): number {
  return lastUsedAt;
}

export function aldoPageInUseNow(): boolean {
  if (typeof document === "undefined") return false;
  return aldoPageInUse({
    visible: document.visibilityState === "visible",
    focused: document.hasFocus(),
    idleMs: Date.now() - lastUsedAt,
  });
}
