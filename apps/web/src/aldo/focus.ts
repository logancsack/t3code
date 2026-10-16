// Tells Aldo which conversation is on screen, so notifications about it come
// quietly while the user is looking at it (focus.logic.ts says what to say,
// and when). The thread page names its conversation; this listens for the
// page going to the background, hidden or away, and for it coming back, and
// looks again every few seconds, for the reports to stay fresh and to notice
// a page left alone.

import { useEffect } from "react";

import { isAldoCloud, isAldoEnvironmentId } from "./api";
import { touchAldoEnvironment } from "./directory";
import { aldoFocusReports, type AldoFocusSent, type AldoFocusTarget } from "./focus.logic";
import { aldoPageUsedAt } from "./preload";

/** How often it looks again. */
const TICK_MS = 15_000;
/** Focus going into a frame on the page (a preview, the agent's browser) blurs the window on its way. */
const BLUR_SETTLE_MS = 250;
/** Using the page again says so at once, rather than at the next look: the same uses preload.ts counts. */
const USE_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

let onScreen: AldoFocusTarget | null = null;
/** The page is going away (closed, or kept for back and forward): nothing of it is on screen. */
let leaving = false;
let last: AldoFocusSent | null = null;

function report(keepalive = false): void {
  const at = Date.now();
  const next = aldoFocusReports(last, {
    onScreen: leaving ? null : onScreen,
    visible: document.visibilityState === "visible",
    focused: document.hasFocus(),
    idleMs: at - aldoPageUsedAt(),
    at,
  });
  last = next.last;
  for (const { to, focused } of next.send) {
    touchAldoEnvironment(to.environmentId, { thread: to.thread, focused }, { keepalive });
  }
}

/**
 * Reports a conversation while it's on screen, from now until the returned
 * stop (leaving the thread), which says it no longer is.
 */
export function watchAldoFocus(target: AldoFocusTarget): () => void {
  onScreen = target;
  leaving = false;
  report();
  const look = () => report();
  let blurTimer: number | undefined;
  const onBlur = () => {
    window.clearTimeout(blurTimer);
    blurTimer = window.setTimeout(look, BLUR_SETTLE_MS);
  };
  // A hidden page may be frozen or closed next, so what it says then goes out regardless.
  const onVisibility = () => report(document.visibilityState !== "visible");
  const onPageHide = () => {
    leaving = true;
    report(true);
  };
  const onPageShow = () => {
    leaving = false;
    report();
  };
  const onUse = () => {
    if (!last?.focused) report();
  };
  const timer = window.setInterval(look, TICK_MS);
  window.addEventListener("focus", look);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  // After the page's own note of use (preload.ts), which listens first.
  for (const type of USE_EVENTS) {
    window.addEventListener(type, onUse, { capture: true, passive: true });
  }
  return () => {
    window.clearInterval(timer);
    window.clearTimeout(blurTimer);
    window.removeEventListener("focus", look);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
    for (const type of USE_EVENTS) {
      window.removeEventListener(type, onUse, { capture: true });
    }
    if (onScreen === target) onScreen = null;
    report(true);
  };
}

/** Reports the conversation on the thread page (`threadId`, T3's) while it's on screen. */
export function useAldoFocusReport(environmentId: string | null, threadId: string | null): void {
  useEffect(() => {
    if (!isAldoCloud || !environmentId || !threadId || !isAldoEnvironmentId(environmentId)) return;
    return watchAldoFocus({ environmentId, thread: threadId });
  }, [environmentId, threadId]);
}
