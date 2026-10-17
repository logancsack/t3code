// Reveal the current route promptly. Its own loading states and cached content
// can fill in while the directory and other machines refresh in the background.
// Keep the boot splash only until React renders, with a short allowance for
// the current view's data. Boot errors keep their reload button on the splash.

import { useLayoutEffect } from "react";

import { environmentCatalog } from "../connection/catalog";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { startAldoDirectory } from "./directory";
import { isAldoCloud } from "./api";

const FIRST_VIEW_MAX_MS = 500;
const FADE_MS = 150;

let splash: HTMLElement | null = null;
const holds = new Set<object>();
const unmounts: Array<() => void> = [];

/** Puts the splash over the page and takes it away once the first view can render. */
export function installAldoFirstView(): void {
  if (!isAldoCloud) return;
  startAldoDirectory();
  splash = document.getElementById("boot-shell");
  if (!splash) return;
  Object.assign(splash.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    transition: `opacity ${FADE_MS}ms ease-out`,
  });
  document.body.append(splash);
  // Starts the connection runtime (the directory's machines, their stored
  // threads) while the route's code loads, rather than once the app renders.
  unmounts.push(appAtomRegistry.mount(environmentCatalog.catalogValueAtom));
  let capped = false;
  window.setTimeout(() => {
    capped = true;
  }, FIRST_VIEW_MAX_MS);
  // Two frames in a row ready, so what made it ready has rendered under the splash.
  let readyFrames = 0;
  const watch = () => {
    if (splash === null) return;
    // Startup failed: the splash keeps its error and reload button (bootError.ts).
    if (splash.querySelector("#boot-error")) {
      stop();
      return;
    }
    readyFrames = ready() ? readyFrames + 1 : 0;
    if (readyFrames >= 2 || (capped && rendered())) reveal();
    else requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
}

function rendered(): boolean {
  return (document.getElementById("root")?.childElementCount ?? 0) > 0;
}

function ready(): boolean {
  return holds.size === 0 && rendered();
}

/** Stops waiting on the first view, leaving the splash as it is. */
function stop(): HTMLElement | null {
  const element = splash;
  splash = null;
  for (const unmount of unmounts.splice(0)) unmount();
  return element;
}

function reveal(): void {
  const element = stop();
  if (element === null) return;
  element.style.opacity = "0";
  element.style.pointerEvents = "none";
  window.setTimeout(() => element.remove(), FADE_MS);
}

/**
 * Keeps the splash up while `waiting`: for what the first view shows, so it
 * appears with its data rather than filling in after. Nothing once the app
 * is showing.
 */
export function useAldoFirstViewHold(waiting: boolean): void {
  useLayoutEffect(() => {
    if (!waiting || splash === null) return;
    const hold = {};
    holds.add(hold);
    return () => {
      holds.delete(hold);
    };
  }, [waiting]);
}
