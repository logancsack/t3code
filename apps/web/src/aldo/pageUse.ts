// When the user last used the page (the pointer, a key, a touch, the wheel,
// or coming back to the tab or window), and whether the page is in use now:
// visible, focused and used lately (focus.logic.ts). Home's read says so
// (homeFeed.ts), for Aldo to hold back what the user would see here from
// their phone. It listens from the first time anything asks, wherever the
// page opened (Home, or a thread). No imports of the app's, so anything can
// read it.

import { aldoPageInUse } from "./focus.logic";

let lastUsedAt = Date.now();
let listening = false;
/** Told of each use, with when the page was used before it (preload.ts wakes what a pause let sleep). */
const useListeners = new Set<(before: number) => void>();

function listen(): void {
  if (listening || typeof window === "undefined" || typeof document === "undefined") return;
  listening = true;
  const used = () => noteAldoPageUse();
  for (const type of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "focus"]) {
    window.addEventListener(type, used, { capture: true, passive: true });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") used();
  });
}

export function noteAldoPageUse(at = Date.now()): void {
  const before = lastUsedAt;
  lastUsedAt = at;
  for (const listener of useListeners) listener(before);
}

/** Hears each use of the page from now on, with when it was used before. */
export function onAldoPageUse(listener: (before: number) => void): void {
  listen();
  useListeners.add(listener);
}

/** When the user last used the page (focus.ts tells a page in use from one left alone). */
export function aldoPageUsedAt(): number {
  listen();
  return lastUsedAt;
}

export function aldoPageInUseNow(): boolean {
  if (typeof document === "undefined") return false;
  return aldoPageInUse({
    visible: document.visibilityState === "visible",
    focused: document.hasFocus(),
    idleMs: Date.now() - aldoPageUsedAt(),
  });
}
