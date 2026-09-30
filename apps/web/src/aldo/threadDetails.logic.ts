// What this browser does with Aldo's answer for a thread whose machine isn't
// connected (see threadDetails.ts). Pure, so it's tested on its own.

/** Aldo's answer: its copy's sequence (null when it has none), and the copy when it's newer than ours. */
export interface AldoThreadDetailResponse {
  readonly sequence: number | null;
  readonly detail: unknown;
}

/**
 * The copy to open the thread with (only one newer than the cached one), and
 * whether neither Aldo nor this browser has any, so only its machine can show it.
 */
export function readAldoThreadDetail(
  cachedSequence: number | null,
  response: AldoThreadDetailResponse,
): { readonly detail: unknown; readonly missing: boolean } {
  const sequence = (response.detail as { snapshotSequence?: unknown } | null)?.snapshotSequence;
  const newer =
    typeof sequence === "number" && (cachedSequence === null || sequence > cachedSequence);
  return {
    detail: newer ? response.detail : null,
    missing: response.sequence === null && cachedSequence === null,
  };
}
