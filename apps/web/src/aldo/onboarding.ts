// The welcome's state for this page (onboarding.logic.ts): read with who's
// signed in (requestAldoProfile), and changed by the welcome's answer
// (AldoWelcome.tsx) or later in Settings → General. Undefined until Aldo has
// said; null on an Aldo without the welcome, or when the account couldn't be
// read, so nothing it decides changes.

import { useEffect } from "react";
import { create } from "zustand";

import { isAldoCloud } from "./api";
import { requestAldoProfile, saveAldoInterests } from "./assistantApi";
import { type AldoInterest, type AldoOnboarding } from "./onboarding.logic";

export const useAldoOnboarding = create<{ readonly onboarding: AldoOnboarding | null | undefined }>(
  () => ({ onboarding: undefined }),
);

let loading = false;

/** Reads the welcome's state with who's signed in, once per page (nothing outside Aldo). */
export function loadAldoOnboarding(): void {
  if (!isAldoCloud || loading) return;
  loading = true;
  void requestAldoProfile().then((profile) => {
    // An answer given meanwhile stands.
    if (useAldoOnboarding.getState().onboarding === undefined)
      useAldoOnboarding.setState({ onboarding: profile?.onboarding ?? null });
  });
}

/** The welcome's state, read once it's needed. */
export function useAldoOnboardingState(): AldoOnboarding | null | undefined {
  useEffect(loadAldoOnboarding, []);
  return useAldoOnboarding((s) => s.onboarding);
}

/** What the user told the welcome: undefined until the account's read, null for an account never asked. */
export function useAldoInterests(): ReadonlyArray<AldoInterest> | null | undefined {
  useEffect(loadAldoOnboarding, []);
  return useAldoOnboarding((s) =>
    s.onboarding === undefined ? undefined : (s.onboarding?.interests ?? null),
  );
}

/** What Aldo last kept, while changes are on their way; what a failed one goes back to. */
let confirmed: AldoOnboarding | null | undefined;
let pending = 0;
/** Changes go one at a time, so Aldo keeps them in the order they were made. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Keeps what they'll hand Aldo first (empty for a skip), which ends the
 * welcome: shown at once, then as Aldo kept it once nothing else is on its
 * way. Says whether it saved. A failed save keeps the answer for this page
 * (the welcome doesn't come back until the next visit), or with `revert` puts
 * back what Aldo last kept.
 */
export async function saveAldoOnboarding(
  interests: ReadonlyArray<AldoInterest>,
  options: { readonly revert?: boolean } = {},
): Promise<boolean> {
  const before = useAldoOnboarding.getState().onboarding;
  if (pending === 0) confirmed = before;
  pending += 1;
  const shown: AldoOnboarding = {
    onboardedAt: before?.onboardedAt ?? new Date().toISOString(),
    interests,
  };
  useAldoOnboarding.setState({ onboarding: shown });
  const save = queue.then(() =>
    saveAldoInterests(interests).then(
      (saved) => {
        confirmed = saved ?? shown;
        return true;
      },
      () => false,
    ),
  );
  queue = save;
  const saved = await save;
  pending -= 1;
  // The last change to settle says what shows: Aldo's answer, or with `revert` what it kept.
  if (pending === 0 && (saved || options.revert))
    useAldoOnboarding.setState({ onboarding: confirmed });
  return saved;
}
