// Cloud agents ready before they're needed. Opening a new thread starts
// creating its machine and opening an existing thread wakes its machine,
// silently, so a message sent a moment later goes straight out (if the
// machine is still starting, the thread says so then). If the user leaves
// without sending anything, the machine is put back shortly after: a new one
// that never got a thread is deleted, a woken one goes back to sleep. Aldo's
// sweep does the same for tabs that close first. Both are settings
// (preloadSettings.ts). A machine Aldo is starting a thread on is left to it
// until it's up, and then connected; one Aldo couldn't start isn't brought up.
// A thread with nothing to show (neither Aldo nor this browser has a copy of
// it, threadDetails.ts) wakes its machine regardless, once: the machine then
// reports it, and it opens without waking from then on. A thread on screen
// keeps its machine up while the page is in use; one left open and untouched
// for half an hour lets it sleep, and using the page again brings it back.

import { useEffect, useRef, useState } from "react";

import {
  aldoStartOf,
  isAldoCloud,
  isAldoEnvironmentId,
  subscribeAldoEnvironments,
  touchAldoEnvironment,
  unloadAldoEnvironment,
} from "./cloud";
import {
  aldoLastSentAt,
  ensureAldoConnected,
  isAldoConnected,
  notifyAldoRefusal,
} from "./dispatch";
import { useAldoPreloadSettings } from "./preloadSettings";

/** A thread passed over on the way elsewhere shouldn't start anything. */
const DWELL_MS = 800;
/** Leaving and coming back within this keeps the machine. */
const UNLOAD_AFTER_MS = 90_000;
/** Aldo puts a machine to sleep 5 minutes after its last activity: two touches fit in that. */
const TOUCH_INTERVAL_MS = 2 * 60 * 1000;
/** A page on screen that hasn't been used for this long no longer keeps its agent up. */
const UNATTENDED_MS = 30 * 60 * 1000;

/** When the user last used the page: the pointer, a key, a touch, the wheel, or coming back to the tab. */
let lastUsedAt = Date.now();
/** Run when the page is used after a pause: the agent on screen may need a touch, or waking, at once. */
const resumeListeners = new Set<() => void>();

function noteUse(): void {
  const paused = Date.now() - lastUsedAt > TOUCH_INTERVAL_MS;
  lastUsedAt = Date.now();
  if (paused) for (const listener of resumeListeners) listener();
}

if (isAldoCloud && typeof window !== "undefined") {
  for (const type of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"]) {
    window.addEventListener(type, noteUse, { capture: true, passive: true });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") noteUse();
  });
}

const unloadTimers = new Map<string, number>();

function cancelUnload(environmentId: string): void {
  const timer = unloadTimers.get(environmentId);
  if (timer !== undefined) window.clearTimeout(timer);
  unloadTimers.delete(environmentId);
}

function scheduleUnload(environmentId: string): void {
  cancelUnload(environmentId);
  unloadTimers.set(
    environmentId,
    window.setTimeout(() => {
      unloadTimers.delete(environmentId);
      void unloadAldoEnvironment(environmentId).catch(() => undefined);
    }, UNLOAD_AFTER_MS),
  );
}

/**
 * Preloads the cloud agent of the thread on screen: `isThread` is false for
 * a new thread's draft (its machine is created) and true for an existing
 * thread (its machine is woken). `nothingToShow`: the thread has no copy
 * anywhere, so its machine is woken to show it, whatever the setting. Also
 * keeps an agent that's up from idling out while the thread is on screen and the page is in use.
 */
export function useAldoPreload(
  environmentId: string | null,
  isThread: boolean,
  phase: string | undefined,
  nothingToShow = false,
): void {
  const settings = useAldoPreloadSettings();
  // Once woken to show the thread, the machine stays up while it's on screen.
  const [wokenToShow, setWokenToShow] = useState<string | null>(null);
  useEffect(() => {
    if (nothingToShow && environmentId !== null) setWokenToShow(environmentId);
  }, [environmentId, nothingToShow]);
  const toShow = isThread && environmentId !== null && wokenToShow === environmentId;
  const toShowRef = useRef(toShow);
  toShowRef.current = toShow;
  const enabled = isThread ? settings.openedThreads || toShow : settings.newThreads;
  const applies = isAldoCloud && environmentId !== null && isAldoEnvironmentId(environmentId);

  useEffect(() => {
    if (!applies || environmentId === null) return;
    cancelUnload(environmentId);
    if (!enabled) return;
    const openedAt = Date.now();
    let preloaded = false;
    /** Waiting for Aldo to finish starting a thread on the machine (the directory says). */
    let stopWaiting: (() => void) | null = null;
    const preload = () => {
      // Already up: it isn't this visit's to put back.
      if (document.visibilityState !== "visible" || isAldoConnected(environmentId)) return;
      const start = aldoStartOf(environmentId);
      // Aldo couldn't start its thread: there's nothing to bring up.
      if (start === "failed") return;
      // Aldo is bringing it up (bringing it up here too would race it): connect once it has.
      if (start === "starting") {
        stopWaiting ??= subscribeAldoEnvironments(() => {
          if (aldoStartOf(environmentId) === "starting") return;
          stopWaiting?.();
          stopWaiting = null;
          preload();
        });
        return;
      }
      preloaded = true;
      // Woken to show the thread, a refusal is the user's to know.
      void ensureAldoConnected(environmentId).catch((cause: unknown) => {
        if (toShowRef.current) notifyAldoRefusal(cause);
      });
    };
    const timer = window.setTimeout(preload, DWELL_MS);
    // Back to a tab that sat hidden, or to a page left untouched (its agent may have gone to sleep meanwhile).
    const onVisibility = () => {
      if (document.visibilityState === "visible") preload();
    };
    document.addEventListener("visibilitychange", onVisibility);
    resumeListeners.add(preload);
    return () => {
      window.clearTimeout(timer);
      stopWaiting?.();
      document.removeEventListener("visibilitychange", onVisibility);
      resumeListeners.delete(preload);
      if (preloaded && aldoLastSentAt(environmentId) < openedAt) scheduleUnload(environmentId);
    };
  }, [applies, enabled, environmentId]);

  useEffect(() => {
    if (!applies || environmentId === null || phase !== "connected") return;
    const touch = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastUsedAt > UNATTENDED_MS) return;
      touchAldoEnvironment(environmentId);
    };
    touch();
    const timer = window.setInterval(touch, TOUCH_INTERVAL_MS);
    resumeListeners.add(touch);
    return () => {
      window.clearInterval(timer);
      resumeListeners.delete(touch);
    };
  }, [applies, environmentId, phase]);
}
