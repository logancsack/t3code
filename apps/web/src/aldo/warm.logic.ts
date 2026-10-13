// When typing to Aldo on the home screen asks Aldo to warm a machine for the
// next thread it starts (see warm.ts). Pure, so it's tested on its own.

/** While the typing goes on, asked at most this often: each ask keeps the machine warm a few minutes more. */
export const ALDO_WARM_EVERY_MS = 60_000;

export interface AldoWarmState {
  /** When the last ask went (0: never). */
  readonly askedAt: number;
  /** This Aldo has no warm machines (it answered 404), so it isn't asked again. */
  readonly unsupported: boolean;
}

export const INITIAL_ALDO_WARM_STATE: AldoWarmState = { askedAt: 0, unsupported: false };

export interface AldoWarmInput {
  /** What's in the composer now. */
  readonly text: string;
  /** Whether new threads' machines start right away (preloadSettings.ts). */
  readonly newThreads: boolean;
  /** Whether this Aldo starts threads outside a repository, as its directory said. */
  readonly general: boolean;
  readonly now: number;
}

/**
 * Whether this keystroke asks: there are words in the composer, the user
 * hasn't turned off starting new threads' machines right away, Aldo can start
 * a thread in no repository (the kind a warm machine is for) and has warm
 * machines at all, and the last ask was a minute or more ago.
 */
export function aldoWarmDue(state: AldoWarmState, input: AldoWarmInput): boolean {
  if (state.unsupported || !input.newThreads || !input.general || !input.text.trim()) return false;
  return input.now - state.askedAt >= ALDO_WARM_EVERY_MS;
}

/**
 * Whether this keystroke would ask but for Aldo's directory not having said
 * (yet: it's still loading, or Aldo is out of reach) that it starts threads
 * outside a repository; the words are asked for once it does.
 */
export function aldoWarmAwaitsGeneral(state: AldoWarmState, input: AldoWarmInput): boolean {
  return !input.general && aldoWarmDue(state, { ...input, general: true });
}

/** The state as an ask goes out: the next waits its minute from now, whatever the answer. */
export function askingAldoWarm(state: AldoWarmState, now: number): AldoWarmState {
  return { ...state, askedAt: now };
}

/**
 * The state once Aldo answered an ask with `status` (null: no answer came). A
 * 404 is an Aldo without warm machines, not asked again; anything else, an
 * error included, changes nothing.
 */
export function answeredAldoWarm(state: AldoWarmState, status: number | null): AldoWarmState {
  return status === 404 ? { ...state, unsupported: true } : state;
}
