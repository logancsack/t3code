// Simple mode: a narrow rail in place of the sidebar with Aldo's conversation,
// what needs the user and the Library (AldoSimpleRail.tsx), for people who
// talk to Aldo and never open a thread. The user turns it on or off (in
// Settings → General, or their account), kept per device; until they do, it
// follows what they told the welcome (onboarding.ts): on unless that was code,
// and off for an account that was never asked. Which place the home screen
// shows lasts the page; it opens on Aldo.

import { create } from "zustand";

import { isAldoCloud } from "./api";
import { loadAldoOnboarding, useAldoOnboarding } from "./onboarding";
import { aldoSimpleByDefault } from "./onboarding.logic";
import { homeShowsConversation, simpleModeFrom, type AldoSimplePlace } from "./simpleMode.logic";

const KEY = "aldo:simple";
/** What the welcome's answer made it, last time it was read here: so it doesn't flash in on each visit. */
const WELCOME_KEY = "aldo:simple:welcome";

/** Set on this page, where the device can't keep it (private mode). */
let chosen: boolean | null = null;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function current(): boolean {
  const choice = chosen === null ? read(KEY) : chosen ? "on" : "off";
  const onboarding = useAldoOnboarding.getState().onboarding;
  // Until the account's read (or where it couldn't be), as it was here last time.
  if (!onboarding) return simpleModeFrom(choice ?? read(WELCOME_KEY));
  return simpleModeFrom(choice, onboarding.interests);
}

export const useAldoSimple = create<{ readonly on: boolean; readonly place: AldoSimplePlace }>(
  () => ({
    on: isAldoCloud && typeof window !== "undefined" && current(),
    place: "aldo",
  }),
);

// The welcome's answer, once it's read or given, decides it until the user does.
if (isAldoCloud && typeof window !== "undefined") {
  useAldoOnboarding.subscribe(({ onboarding }, previous) => {
    if (!onboarding || onboarding.interests === previous.onboarding?.interests) return;
    try {
      if (aldoSimpleByDefault(onboarding.interests)) window.localStorage.setItem(WELCOME_KEY, "on");
      else window.localStorage.removeItem(WELCOME_KEY);
    } catch {
      // Private mode: it's read again next visit.
    }
    const on = current();
    if (on !== useAldoSimple.getState().on) useAldoSimple.setState({ on, place: "aldo" });
  });
  // With who's signed in, which the account menu reads anyway.
  loadAldoOnboarding();
}

export function useAldoSimpleMode(): boolean {
  return useAldoSimple((s) => s.on);
}

export function setAldoSimpleMode(on: boolean): void {
  useAldoSimple.setState({ on, place: "aldo" });
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
    chosen = null;
  } catch {
    // Private mode: the choice lasts this page.
    chosen = on;
  }
}

export function setAldoSimplePlace(place: AldoSimplePlace): void {
  useAldoSimple.setState({ place });
}

/** Shows Aldo's conversation on the home screen, which in simple mode is one of its places. */
export function showAldoConversation(): void {
  setAldoUnderTheHood(false);
  if (useAldoSimple.getState().on) setAldoSimplePlace("aldo");
}

/** Whether the home screen, when it's on the page, shows Aldo's conversation (and its composer). */
export function aldoHomeShowsConversation(): boolean {
  const { on, place } = useAldoSimple.getState();
  return !useAldoUnderTheHood.getState().open && homeShowsConversation({ simple: on, place });
}

// ---------------------------------------------------------------------------
// Whether the home screen shows what runs under Aldo's conversation
// (AldoUnderTheHood.tsx) in its place: opened from what Aldo's at, for this
// visit. Leaving the home screen, or showing the conversation, closes it.

export const useAldoUnderTheHood = create<{ readonly open: boolean }>(() => ({ open: false }));

export function setAldoUnderTheHood(open: boolean): void {
  useAldoUnderTheHood.setState({ open });
}
