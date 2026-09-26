// Cloud agents ready before they're needed. Opening a new thread starts
// creating its machine and opening an existing thread wakes its machine,
// silently, so a message sent a moment later goes straight out (if the
// machine is still starting, the thread says so then). If the user leaves
// without sending anything, the machine is put back shortly after: a new one
// that never got a thread is deleted, a woken one goes back to sleep. Aldo's
// sweep does the same for tabs that close first. Both are settings
// (preloadSettings.ts).

import { useEffect } from "react";

import {
  isAldoCloud,
  isAldoEnvironmentId,
  touchAldoEnvironment,
  unloadAldoEnvironment,
} from "./cloud";
import { aldoLastSentAt, ensureAldoConnected, isAldoConnected } from "./dispatch";
import { useAldoPreloadSettings } from "./preloadSettings";

/** A thread passed over on the way elsewhere shouldn't start anything. */
const DWELL_MS = 800;
/** Leaving and coming back within this keeps the machine. */
const UNLOAD_AFTER_MS = 90_000;
const TOUCH_INTERVAL_MS = 4 * 60 * 1000;

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
 * thread (its machine is woken). Also keeps an agent that's up from idling
 * out while the thread is on screen.
 */
export function useAldoPreload(
  environmentId: string | null,
  isThread: boolean,
  phase: string | undefined,
): void {
  const settings = useAldoPreloadSettings();
  const enabled = isThread ? settings.openedThreads : settings.newThreads;
  const applies = isAldoCloud && environmentId !== null && isAldoEnvironmentId(environmentId);

  useEffect(() => {
    if (!applies || environmentId === null) return;
    cancelUnload(environmentId);
    if (!enabled) return;
    const openedAt = Date.now();
    let preloaded = false;
    const preload = () => {
      // Already up: it isn't this visit's to put back.
      if (document.visibilityState !== "visible" || isAldoConnected(environmentId)) return;
      preloaded = true;
      void ensureAldoConnected(environmentId).catch(() => undefined);
    };
    const timer = window.setTimeout(preload, DWELL_MS);
    // Back to a tab that sat hidden (its agent may have gone to sleep meanwhile).
    const onVisibility = () => {
      if (document.visibilityState === "visible") preload();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      if (preloaded && aldoLastSentAt(environmentId) < openedAt) scheduleUnload(environmentId);
    };
  }, [applies, enabled, environmentId]);

  useEffect(() => {
    if (!applies || environmentId === null || phase !== "connected") return;
    const touch = () => {
      if (document.visibilityState === "visible") touchAldoEnvironment(environmentId);
    };
    touch();
    const timer = window.setInterval(touch, TOUCH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [applies, environmentId, phase]);
}
