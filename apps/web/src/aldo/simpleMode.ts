// Simple mode: a narrow rail in place of the sidebar with Aldo's conversation,
// what needs the user and the Library (AldoSimpleRail.tsx), for people who
// talk to Aldo and never open a thread. Off unless the user turns it on (in
// Settings → General, or their account), and kept per device. Which place
// the home screen shows lasts the page; it opens on Aldo.

import { create } from "zustand";

import { isAldoCloud } from "./api";
import { homeShowsConversation, simpleModeFrom, type AldoSimplePlace } from "./simpleMode.logic";

const KEY = "aldo:simple";

function stored(): boolean {
  try {
    return simpleModeFrom(window.localStorage.getItem(KEY));
  } catch {
    return false;
  }
}

export const useAldoSimple = create<{ readonly on: boolean; readonly place: AldoSimplePlace }>(
  () => ({
    on: isAldoCloud && typeof window !== "undefined" && stored(),
    place: "aldo",
  }),
);

export function useAldoSimpleMode(): boolean {
  return useAldoSimple((s) => s.on);
}

export function setAldoSimpleMode(on: boolean): void {
  useAldoSimple.setState({ on, place: "aldo" });
  try {
    if (on) window.localStorage.setItem(KEY, "on");
    else window.localStorage.removeItem(KEY);
  } catch {
    // Private mode: the choice lasts this page.
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
