// An optional sound while Aldo is open: a soft chime when a thread finishes
// or needs the user (chime.logic.ts says when), off unless they turn it on
// in Settings → Notifications, per browser (every open tab follows). It's made here
// with Web Audio rather than shipped as a file. It listens only while the
// page shows, and not for the thread the user is looking at; notifications
// cover the rest.

import { useEffect, useSyncExternalStore } from "react";

import { chimeMemory, chimeNews, shouldChime, type ChimeMemory } from "./chime.logic";
import { type AldoHome } from "./homeApi";
import { useAldoHomeFeed } from "./homeFeed";
import { aldoOnScreen } from "./screen";

const STORAGE_KEY = "aldo:sound";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

let on = typeof window === "undefined" ? false : read();

function getAldoSound(): boolean {
  return on;
}

export function setAldoSound(next: boolean): void {
  on = next;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, "on");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Kept for this session only.
  }
  for (const listener of listeners) listener();
}

/** The setting changed in another tab or window of Aldo: this one follows. */
function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  const next = read();
  if (next === on) return;
  on = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function useAldoSound(): boolean {
  return useSyncExternalStore(subscribe, getAldoSound, () => false);
}

let audio: AudioContext | null = null;

/** The page's one audio context, made on first use; null where there's no Web Audio. */
function context(): AudioContext | null {
  if (audio) return audio;
  const Context =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  try {
    audio = new Context();
  } catch {
    return null;
  }
  return audio;
}

/**
 * Lets the page make sound: browsers allow it only after the user has done
 * something on it, so this runs on a click or a key (and turning the setting
 * on), before any chime is due.
 */
function unlock(): void {
  const ctx = context();
  if (ctx?.state === "suspended") void ctx.resume().catch(() => undefined);
}

/** A soft two-note chime, under a second, quiet. Silent where the browser won't play yet. */
export function playAldoChime(): void {
  // Before the user has done anything on the page, a browser would refuse (and say so in the console).
  if (!audio && navigator.userActivation?.hasBeenActive === false) return;
  const ctx = context();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  const start = ctx.currentTime + 0.02;
  const out = ctx.createGain();
  out.gain.value = 0.12;
  out.connect(ctx.destination);
  // Two sine notes a fifth apart (E5, B5), each with a quick rise and a long, gentle fall.
  for (const [frequency, delay] of [
    [659.25, 0],
    [987.77, 0.11],
  ] as const) {
    const at = start + delay;
    const tone = ctx.createOscillator();
    tone.type = "sine";
    tone.frequency.value = frequency;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(1, at + 0.015);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.7);
    tone.connect(envelope).connect(out);
    tone.start(at);
    tone.stop(at + 0.75);
  }
}

/** The thread the user is looking at: on screen in the page they're using. */
function watching() {
  if (document.visibilityState !== "visible" || !document.hasFocus()) return null;
  return aldoOnScreen();
}

/**
 * Plays the chime as Aldo's home read brings news, while the setting is on.
 * Mounted once, with the rest of what keeps the page in step (attentionBadge.ts).
 */
export function useAldoChime(): void {
  const enabled = useAldoSound();
  useEffect(() => {
    if (!enabled) return;
    const showing = () => document.visibilityState === "visible";
    let lastChimeAt: number | null = null;
    // What's already on the page is only remembered; so is the first read after the page comes back.
    const remember = (home: AldoHome | null) =>
      home && showing() ? chimeMemory(home.conversations) : null;
    let memory: ChimeMemory | null = remember(useAldoHomeFeed.getState().home);
    const stop = useAldoHomeFeed.subscribe((state, previous) => {
      if (!state.home || state.home === previous.home) return;
      const now = Date.now();
      const news = showing() ? chimeNews(memory, state.home.conversations, now, watching()) : [];
      memory = remember(state.home);
      if (!shouldChime(news.length, lastChimeAt, now)) return;
      lastChimeAt = now;
      playAldoChime();
    });
    const onHidden = () => {
      if (!showing()) memory = null;
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
    };
  }, [enabled]);
}
