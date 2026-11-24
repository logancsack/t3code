// The user's goals, kept for the page: read once when the app first asks (the
// account menu, which lists Goals only for an account that has one) and again
// whenever a Goals page asks. Not part of Home's poll: most accounts have none.

import { useEffect, useSyncExternalStore } from "react";

import { fetchAldoGoals, type AldoGoal } from "./goalsApi";

export interface AldoGoalsRead {
  /** The goals; null from an Aldo that has no goals yet; undefined until the first answer. */
  readonly goals: ReadonlyArray<AldoGoal> | null | undefined;
  /** Why the last read failed, when it did. */
  readonly error: string | null;
}

let read: AldoGoalsRead = { goals: undefined, error: null };
let reading: Promise<void> | null = null;
const listeners = new Set<() => void>();

const publish = (next: AldoGoalsRead) => {
  read = next;
  for (const listener of listeners) listener();
};

/** Reads the goals again; calls made while one is on its way share it. */
export function refreshAldoGoals(): Promise<void> {
  reading ??= fetchAldoGoals()
    .then(
      (goals) => publish({ goals, error: null }),
      // What was read before stays on screen; the page says the newer read failed only when it has nothing.
      (cause: unknown) =>
        publish({
          goals: read.goals,
          error: cause instanceof Error ? cause.message : String(cause),
        }),
    )
    .finally(() => {
      reading = null;
    });
  return reading;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The goals as last read, asked for once if nobody has yet. */
export function useAldoGoals(): AldoGoalsRead {
  const current = useSyncExternalStore(subscribe, () => read);
  useEffect(() => {
    if (read.goals === undefined && read.error === null) void refreshAldoGoals();
  }, []);
  return current;
}

/** How often an open Goals page looks again, while it's the tab in front. */
const ALDO_GOALS_EVERY_MS = 60_000;

/** Runs `look` now and every minute while the page is visible, and when it comes back to the front. */
export function useAldoGoalsWatch(look: () => void): void {
  useEffect(() => {
    look();
    const again = () => {
      if (document.visibilityState === "visible") look();
    };
    const timer = window.setInterval(again, ALDO_GOALS_EVERY_MS);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", again);
    };
  }, [look]);
}
