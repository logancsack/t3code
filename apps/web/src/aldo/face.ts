// What Aldo's face does besides what Aldo is at (presence.logic.ts): it looks
// down at what the user is writing, blinks once when something passes between
// them (the user sends, Aldo replies, the user comes back to it), and is
// pleased for a moment when something gets done (a card answered). At rest it's
// still.

import { create } from "zustand";

/** How long Aldo looks pleased. */
export const PLEASED_MS = 900;

export const useAldoFace = create<{
  readonly reading: boolean;
  readonly pleasedAt: number;
  /** The last blink: each one blinks the eyes once. */
  readonly blinkAt: number;
}>(() => ({ reading: false, pleasedAt: 0, blinkAt: 0 }));

/** The user is (or isn't) writing to Aldo. */
export function setAldoReading(reading: boolean): void {
  if (useAldoFace.getState().reading !== reading) useAldoFace.setState({ reading });
}

/** Something just got done. */
export function pleaseAldo(): void {
  useAldoFace.setState({ pleasedAt: Date.now() });
}

/** Something passed between the user and Aldo: it blinks, once. */
export function blinkAldo(): void {
  useAldoFace.setState({ blinkAt: Date.now() });
}
