// Transitions that keep the user's place: the row a thread opens from grows
// into the thread, and the handoff takeover grows out of what opened it and
// back. Both are view transitions (morph.css), only where the browser has
// them and motion isn't reduced; elsewhere the change simply happens. A
// thread's opening rides the router's own view transition, which starts once
// the thread's page is ready, so a click is never held up waiting for it.

import type { AnyRouter } from "@tanstack/react-router";
import { flushSync } from "react-dom";

import "./morph.css";

/** The one name both ends of a morph share, for the moment it runs. */
const NAME = "aldo-morph";
/** Long past the 200 ms the morph takes, once its new end is on the page. */
const SETTLE_MS = 600;
/** A navigation that never rendered (redirected, refused) lets go of the row anyway. */
const GIVE_UP_MS = 4_000;

const named = new Set<HTMLElement>();
let clearTimer: ReturnType<typeof setTimeout> | null = null;
/** Stops waiting for a thread's page to render. */
let stopWaiting: (() => void) | null = null;
/** The latest morph: an earlier one finishing late leaves its names alone. */
let latest = 0;

/** Whether this browser can morph, and the user hasn't asked for less motion. */
export function aldoCanMorph(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  if (typeof document.startViewTransition !== "function") return false;
  return !(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

function name(element: HTMLElement | null): void {
  if (!element) return;
  element.style.setProperty("view-transition-name", NAME);
  named.add(element);
}

function unname(element: HTMLElement): void {
  element.style.removeProperty("view-transition-name");
  named.delete(element);
}

function clear(): void {
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = null;
  stopWaiting?.();
  stopWaiting = null;
  for (const element of named) unname(element);
  delete document.documentElement.dataset.aldoMorph;
}

function clearIn(ms: number): void {
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(clear, ms);
}

/** What a link or button sits on: its row, the card it's on, or the bar's peek. */
export function aldoMorphSource(element: Element): HTMLElement | null {
  return element.closest<HTMLElement>(
    "li, [data-aldo-live-card], [data-aldo-handoff-card], [data-aldo-peek]",
  );
}

/**
 * Before the router opens a thread: names the row it opens from now, and the
 * thread's page once it renders (inside the router's view transition), so
 * one grows into the other. True when the navigation should ask the router
 * for a view transition.
 */
export function morphIntoThread(router: Pick<AnyRouter, "subscribe">, row: HTMLElement | null) {
  if (!row || !aldoCanMorph()) return false;
  clear();
  latest += 1;
  name(row);
  document.documentElement.dataset.aldoMorph = "";
  const stop = router.subscribe("onRendered", () => {
    stop();
    stopWaiting = null;
    // The thread's page, unless the row is still on it (a thread opened from within the page).
    const page =
      document.querySelector<HTMLElement>('[data-aldo-layer] main[data-slot="sidebar-inset"]') ??
      document.querySelector<HTMLElement>('main[data-slot="sidebar-inset"]');
    if (page && !page.contains(row)) {
      unname(row);
      name(page);
    }
    clearIn(SETTLE_MS);
  });
  stopWaiting = stop;
  clearIn(GIVE_UP_MS);
  return true;
}

/**
 * Makes a change in place (opening or closing something over the page) with
 * `from` growing into what `to` finds once it's made. Without a morph, it
 * just makes the change.
 */
export function aldoMorph(
  update: () => void,
  from: HTMLElement | null,
  to: () => HTMLElement | null,
): void {
  if (!aldoCanMorph()) {
    update();
    return;
  }
  clear();
  const mine = ++latest;
  name(from);
  document.documentElement.dataset.aldoMorph = "";
  try {
    const transition = document.startViewTransition(() => {
      // What it came from may stay on the page, under what opened: only one end keeps the name.
      if (from) unname(from);
      flushSync(update);
      if (latest === mine) name(to());
    });
    const done = () => {
      if (latest === mine) clear();
    };
    void transition.finished.then(done, done);
  } catch {
    clear();
    update();
  }
}

/**
 * Makes a change that moves `element` across the page (the composer, from the
 * empty page's middle to the foot of the conversation once something's said)
 * with it gliding there rather than jumping; the rest crossfades. Without a
 * morph, it just makes the change.
 */
export function aldoGlide(element: HTMLElement | null, update: () => void): void {
  if (!element || !aldoCanMorph()) {
    update();
    return;
  }
  const root = document.documentElement;
  const done = () => {
    element.style.removeProperty("view-transition-name");
    delete root.dataset.aldoGlide;
  };
  element.style.setProperty("view-transition-name", "aldo-glide");
  root.dataset.aldoGlide = "";
  try {
    const transition = document.startViewTransition(() => flushSync(update));
    void transition.finished.then(done, done);
  } catch {
    done();
    update();
  }
}
