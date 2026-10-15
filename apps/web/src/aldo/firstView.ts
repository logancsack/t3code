// The app's first view appears whole. Opening it showed it in pieces: the
// sidebar said "No projects yet" until the machines' threads had loaded, the
// home screen's setup card changed as the accounts and the directory came in,
// and the account at the foot of the sidebar filled in last. Now the boot
// splash (index.html's, moved out of React's root so the first render doesn't
// clear it) stays over the page until the first directory read's machines are
// in the catalog with their stored threads loaded, the app has rendered, and
// nothing on screen is still waiting for what it shows (useAldoFirstViewHold);
// then it fades out. A first view that isn't ready in FIRST_VIEW_MAX_MS shows
// as it is. A boot error shown on the splash stays.

import { isEnvironmentShellStateLoaded } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { useLayoutEffect } from "react";

import { environmentCatalog } from "../connection/catalog";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentShell } from "../state/shell";
import { aldoMachinesListed, isAldoCloud, startAldoDirectory } from "./cloud";

const FIRST_VIEW_MAX_MS = 8_000;
const FADE_MS = 150;

let splash: HTMLElement | null = null;
let listed: ReadonlyArray<EnvironmentId> | null = null;
const holds = new Set<object>();
const unmounts: Array<() => void> = [];

/** Puts the splash over the page and takes it away once the first view is whole. */
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
  void aldoMachinesListed().then((environmentIds) => {
    listed = environmentIds;
    // Kept loaded while the splash waits on them, as the sidebar keeps them after.
    for (const environmentId of environmentIds) {
      unmounts.push(appAtomRegistry.mount(environmentShell.stateValueAtom(environmentId)));
    }
  });
  window.setTimeout(reveal, FIRST_VIEW_MAX_MS);
  // Two frames in a row ready, so what made it ready has rendered under the splash.
  let readyFrames = 0;
  const watch = () => {
    if (splash === null) return;
    readyFrames = ready() ? readyFrames + 1 : 0;
    if (readyFrames >= 2) reveal();
    else requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
}

function ready(): boolean {
  if (listed === null || holds.size > 0) return false;
  if (document.getElementById("root")?.childElementCount === 0) return false;
  const catalog = appAtomRegistry.get(environmentCatalog.catalogValueAtom);
  return listed.every(
    (environmentId) =>
      catalog.entries.has(environmentId) &&
      isEnvironmentShellStateLoaded(
        appAtomRegistry.get(environmentShell.stateValueAtom(environmentId)),
      ),
  );
}

function reveal(): void {
  const element = splash;
  if (element === null || element.querySelector("#boot-error")) return;
  splash = null;
  for (const unmount of unmounts.splice(0)) unmount();
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
