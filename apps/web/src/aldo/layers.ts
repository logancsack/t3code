// Aldo's layers: Home is the floor, a thread lies over it, and the sidebar (on a phone, its sheet)
// over either. Each layer is one history entry, so one Back takes one layer off and nothing needs
// a Home button.
//
//   [Home]  ->  [Home, thread]  ->  [Home, thread, sidebar]
//
// Choosing a thread replaces the layer above Home instead of piling on, so that stack is the
// deepest it gets. The router has no hook for this, so the history's push is wrapped (install).

import type { RouterHistory } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";

const INDEX = "__TSR_index";
const HOME = "/";

/** What the router's history says about each entry it has shown, by index: the one under the top. */
const seen = new Map<number, string>();
let routerHistory: RouterHistory | null = null;
let closing: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

type Location = RouterHistory["location"];

/** What the history keeps with an entry: the router's index, and the mark this file adds. */
const stateOf = (location: Location) => location.state as unknown as Record<string, unknown>;
const indexOf = (location: Location) => Number(stateOf(location)[INDEX] ?? 0);
const pathOf = (href: string) => href.split(/[?#]/)[0] ?? href;
const below = (location: Location) => seen.get(indexOf(location) - 1);

/** A thread (an Aldo environment's, or a draft of one): what lies over Home. */
export const isThreadPath = (pathname: string) =>
  /^\/aldo-[^/]+\/[^/]+$/.test(pathname) || pathname.startsWith("/draft/");

/** Whether the layers are installed: only in the browser's own history, in Aldo. */
export const aldoLayersActive = () => routerHistory !== null;

/** The sidebar is open when the entry on top is the one it pushed. */
export function aldoDrawerOnTop(): boolean {
  return Boolean(routerHistory && stateOf(routerHistory.location).aldoDrawer);
}

export function useAldoDrawerOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    aldoDrawerOnTop,
    () => false,
  );
}

function afterPop(task: () => void) {
  window.addEventListener("popstate", () => queueMicrotask(task), { once: true });
}

/** Takes the thread off: Back when Home is the entry under it, otherwise Home replaces it. */
function closeToHome(history: RouterHistory) {
  if (below(history.location) === HOME) history.back();
  else history.replace(HOME, {});
}

export function openAldoDrawer() {
  const history = routerHistory;
  if (!history || aldoDrawerOnTop()) return;
  history.push(history.location.href, { aldoDrawer: true });
}

/**
 * Closes the sidebar, unless a navigation follows in the same tick: choosing a row closes it and
 * then goes there, and that choice takes the sidebar's entry (push, below) rather than leaving
 * a second one behind.
 */
export function closeAldoDrawer() {
  const history = routerHistory;
  if (!history || !aldoDrawerOnTop() || closing) return;
  closing = setTimeout(() => {
    closing = null;
    if (!aldoDrawerOnTop()) return;
    // Opened here, the entry under it is the same place and Back removes it; reloaded onto it, it's replaced.
    if (below(history.location) === history.location.pathname) history.back();
    else history.replace(history.location.href, {});
  }, 0);
}

/** Closes what's on top: the sidebar if it's open, else the thread. */
export function closeAldoThread() {
  const history = routerHistory;
  if (!history) return;
  if (aldoDrawerOnTop()) closeAldoDrawer();
  else if (isThreadPath(history.location.pathname)) closeToHome(history);
}

/**
 * Opened straight onto a thread (a notification, a shared link): Home goes under it, so Back lands
 * there instead of leaving. Runs before the router's history reads the location.
 */
export function seedAldoHome() {
  const state = window.history.state as Record<string, unknown> | null;
  if (state?.[INDEX] || state?.aldoDrawer || !isThreadPath(window.location.pathname)) return;
  const here = window.location.pathname + window.location.search + window.location.hash;
  seen.set(0, HOME);
  window.history.replaceState({ [INDEX]: 0, key: "aldo-home" }, "", HOME);
  window.history.pushState({ [INDEX]: 1, key: "aldo-thread" }, "", here);
}

export function installAldoLayers(history: RouterHistory) {
  routerHistory = history;
  seen.set(indexOf(history.location), history.location.pathname);
  history.subscribe(({ location }) => {
    seen.set(indexOf(location), location.pathname);
    listeners.forEach((listener) => listener());
  });
  const { push, replace } = history;
  history.push = (path, state, options) => {
    const here = history.location;
    const target = pathOf(path);
    if ((state as Record<string, unknown> | undefined)?.aldoDrawer)
      return push(path, state, options);
    if (aldoDrawerOnTop()) {
      if (closing) clearTimeout(closing);
      closing = null;
      // Chosen from the sidebar where it already is: closing it is all there is to do.
      if (below(here) === target) {
        history.back();
        return;
      }
      // Chosen from the sidebar: its entry becomes the choice, and a thread under it makes way.
      if (isThreadPath(below(here) ?? "") && (isThreadPath(target) || target === HOME)) {
        afterPop(() => (target === HOME ? closeToHome(history) : replace(path, state, options)));
        history.back();
        return;
      }
      return replace(path, state, options);
    }
    if (isThreadPath(here.pathname)) {
      // Home from a thread closes it, and another thread takes its place.
      if (target === HOME) return closeToHome(history);
      if (isThreadPath(target)) return replace(path, state, options);
    }
    return push(path, state, options);
  };
}
