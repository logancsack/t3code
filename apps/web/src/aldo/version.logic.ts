// When the tab asks Aldo which version it is, and what the answer means (see
// version.ts). Pure, so it's tested on its own.

/** How often a visible tab checks. */
export const ALDO_VERSION_CHECK_EVERY_MS = 10 * 60_000;
/** Coming back to the tab checks too, at most this often (a phone switches apps all the time). */
export const ALDO_VERSION_RECHECK_GAP_MS = 60_000;

export interface AldoVersionState {
  /** The version the tab loaded with: the first one Aldo reported. */
  readonly loaded: string | null;
  /** When the last check answered (0: never). */
  readonly checkedAt: number;
  /** The last check got no version: Aldo couldn't be reached, or predates /api/version. */
  readonly failed: boolean;
  /** Aldo has changed since the tab loaded. Nothing more to check. */
  readonly updated: boolean;
}

export const INITIAL_ALDO_VERSION_STATE: AldoVersionState = {
  loaded: null,
  checkedAt: 0,
  failed: false,
  updated: false,
};

/** Why the tab would check: its timer, or coming back into view. */
export type AldoVersionCheckReason = "interval" | "visible";

/**
 * Whether a check is due. After a failed one, not until the full interval has
 * passed, whatever the reason: an Aldo without the route is never asked often.
 */
export function aldoVersionCheckDue(
  state: AldoVersionState,
  now: number,
  reason: AldoVersionCheckReason,
): boolean {
  if (state.updated) return false;
  const gap =
    state.failed || reason === "interval"
      ? ALDO_VERSION_CHECK_EVERY_MS
      : ALDO_VERSION_RECHECK_GAP_MS;
  return now - state.checkedAt >= gap;
}

/**
 * The version in a /api/version response body, or null when it isn't one:
 * an older Aldo answers that path with its app page, or an error.
 */
export function parseAldoVersion(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const version = (body as { readonly version?: unknown }).version;
  return typeof version === "string" && version.length > 0 ? version : null;
}

/** Records a check's answer (null: none) made at `now`. */
export function recordAldoVersion(
  state: AldoVersionState,
  version: string | null,
  now: number,
): AldoVersionState {
  if (version === null) return { ...state, checkedAt: now, failed: true };
  if (state.loaded === null) return { ...state, checkedAt: now, failed: false, loaded: version };
  return { ...state, checkedAt: now, failed: false, updated: version !== state.loaded };
}
