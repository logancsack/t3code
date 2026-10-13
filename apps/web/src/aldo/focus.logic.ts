// One device rings. While a thread's conversation is on screen, with the page
// visible, focused and in use, the page tells Aldo so through the thread's
// touch (`{ thread, focused: true }`, at least once a minute: Aldo counts it
// for 90 seconds), and says `focused: false` once, as soon as it isn't
// (another window or tab, the page hidden or closed, another thread, or the
// page left alone). While that's fresh, Aldo sends notifications about the
// conversation quietly: no phone rings for what's in front of the user.
// What to say, given what was said last; focus.ts listens and sends.

/** How often it's said again while the conversation stays on screen. */
export const ALDO_FOCUS_REFRESH_MS = 45_000;

/** A page nobody has used for this long is left alone: the devices ring again. */
export const ALDO_FOCUS_IDLE_MS = 5 * 60_000;

export interface AldoFocusTarget {
  /** The machine whose touch carries it. */
  readonly environmentId: string;
  /** The conversation (its T3 thread id). */
  readonly thread: string;
}

export interface AldoFocusReport {
  readonly to: AldoFocusTarget;
  readonly focused: boolean;
}

/** The last report sent, and when. */
export interface AldoFocusSent extends AldoFocusReport {
  readonly at: number;
}

export interface AldoFocusNow {
  /** The conversation on screen, or null (off a thread, or the page going away). */
  readonly onScreen: AldoFocusTarget | null;
  /** `document.visibilityState === "visible"`. */
  readonly visible: boolean;
  /** `document.hasFocus()`. */
  readonly focused: boolean;
  /** Since the user last used the page. */
  readonly idleMs: number;
  readonly at: number;
}

function same(a: AldoFocusTarget, b: AldoFocusTarget): boolean {
  return a.environmentId === b.environmentId && a.thread === b.thread;
}

/**
 * What to tell Aldo now, in order, and what's been said last after it: a
 * conversation that stopped being on screen is unfocused once, and one on
 * screen is focused when it wasn't, and again once the last report is
 * `ALDO_FOCUS_REFRESH_MS` old. Nothing otherwise.
 */
export function aldoFocusReports(
  last: AldoFocusSent | null,
  now: AldoFocusNow,
): { readonly send: ReadonlyArray<AldoFocusReport>; readonly last: AldoFocusSent | null } {
  const showing =
    now.onScreen !== null && now.visible && now.focused && now.idleMs < ALDO_FOCUS_IDLE_MS
      ? now.onScreen
      : null;
  const send: AldoFocusReport[] = [];
  let said = last;
  if (said?.focused && (showing === null || !same(said.to, showing))) {
    send.push({ to: said.to, focused: false });
    said = { to: said.to, focused: false, at: now.at };
  }
  if (
    showing !== null &&
    (said === null ||
      !said.focused ||
      !same(said.to, showing) ||
      now.at - said.at >= ALDO_FOCUS_REFRESH_MS)
  ) {
    send.push({ to: showing, focused: true });
    said = { to: showing, focused: true, at: now.at };
  }
  return { send, last: said };
}
