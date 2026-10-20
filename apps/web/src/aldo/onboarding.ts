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

/** What the user told the welcome; null while it isn't known, and for an account never asked. */
export function useAldoInterests(): ReadonlyArray<AldoInterest> | null {
  useEffect(loadAldoOnboarding, []);
  return useAldoOnboarding((s) => s.onboarding?.interests ?? null);
}

let latest = 0;

/**
 * Keeps what they'll hand Aldo first (empty for a skip), which ends the
 * welcome: shown at once, then as Aldo kept it. Says whether it saved. A
 * failed save keeps the answer for this page (the welcome doesn't come back
 * until the next visit), or with `revert` puts back what was there.
 */
export async function saveAldoOnboarding(
  interests: ReadonlyArray<AldoInterest>,
  options: { readonly revert?: boolean } = {},
): Promise<boolean> {
  const before = useAldoOnboarding.getState().onboarding;
  const ticket = ++latest;
  useAldoOnboarding.setState({
    onboarding: { onboardedAt: before?.onboardedAt ?? new Date().toISOString(), interests },
  });
  try {
    const saved = await saveAldoInterests(interests);
    // A later change supersedes this one's answer.
    if (saved && ticket === latest) useAldoOnboarding.setState({ onboarding: saved });
    return true;
  } catch {
    if (options.revert && ticket === latest) useAldoOnboarding.setState({ onboarding: before });
    return false;
  }
}
