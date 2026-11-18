// Local presence reactions, driven by real exchanges and successful decisions.
import { create } from "zustand";

export const SUCCESS_MS = 900;
export const useAldoPresenceReactions = create<{
  readonly reading: boolean;
  readonly successAt: number;
  readonly acknowledgedAt: number;
}>(() => ({ reading: false, successAt: 0, acknowledgedAt: 0 }));

export function setAldoReading(reading: boolean): void {
  if (useAldoPresenceReactions.getState().reading !== reading)
    useAldoPresenceReactions.setState({ reading });
}

export function completeAldo(): void {
  useAldoPresenceReactions.setState({ successAt: Date.now() });
}

export function acknowledgeAldo(): void {
  useAldoPresenceReactions.setState((s) => ({
    acknowledgedAt: Math.max(Date.now(), s.acknowledgedAt + 1),
  }));
}
