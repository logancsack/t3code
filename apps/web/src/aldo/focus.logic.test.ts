import { describe, expect, it } from "vite-plus/test";

import {
  ALDO_FOCUS_IDLE_MS,
  ALDO_FOCUS_REFRESH_MS,
  aldoFocusReports,
  type AldoFocusNow,
  type AldoFocusSent,
} from "./focus.logic";

const A = { environmentId: "aldo-a", thread: "t-a" };
const B = { environmentId: "aldo-b", thread: "t-b" };
const A2 = { environmentId: "aldo-a", thread: "t-a2" };

function now(fields: Partial<AldoFocusNow> = {}): AldoFocusNow {
  return { onScreen: A, visible: true, focused: true, idleMs: 0, at: 1_000_000, ...fields };
}

const focusedOnA: AldoFocusSent = { to: A, focused: true, at: 1_000_000 };

describe("aldoFocusReports", () => {
  it("says a conversation is on screen while the page is visible, focused and in use", () => {
    expect(aldoFocusReports(null, now())).toEqual({
      send: [{ to: A, focused: true }],
      last: { to: A, focused: true, at: 1_000_000 },
    });
  });

  it("says nothing new until the last report is getting old, then says it again", () => {
    expect(aldoFocusReports(focusedOnA, now({ at: 1_000_000 + 30_000 })).send).toEqual([]);
    const again = aldoFocusReports(focusedOnA, now({ at: 1_000_000 + ALDO_FOCUS_REFRESH_MS }));
    expect(again.send).toEqual([{ to: A, focused: true }]);
    expect(again.last?.at).toBe(1_000_000 + ALDO_FOCUS_REFRESH_MS);
    // Often enough that Aldo, which counts a report for 90 seconds, never sees it go stale.
    expect(ALDO_FOCUS_REFRESH_MS).toBeLessThanOrEqual(60_000);
  });

  it("says once that it isn't, when the page goes to the background, is hidden or closes", () => {
    for (const away of [
      now({ focused: false }),
      now({ visible: false }),
      now({ onScreen: null }),
      now({ idleMs: ALDO_FOCUS_IDLE_MS }),
    ]) {
      const result = aldoFocusReports(focusedOnA, away);
      expect(result.send).toEqual([{ to: A, focused: false }]);
      expect(aldoFocusReports(result.last, { ...away, at: away.at + 120_000 }).send).toEqual([]);
    }
  });

  it("says nothing while it isn't on screen, having said nothing before", () => {
    expect(aldoFocusReports(null, now({ visible: false })).send).toEqual([]);
    expect(
      aldoFocusReports({ to: A, focused: false, at: 0 }, now({ focused: false })).send,
    ).toEqual([]);
  });

  it("says it again as soon as the page is back", () => {
    expect(aldoFocusReports({ to: A, focused: false, at: 999_999 }, now()).send).toEqual([
      { to: A, focused: true },
    ]);
  });

  it("moves to another thread: the old one is unfocused, then the new one focused", () => {
    expect(aldoFocusReports(focusedOnA, now({ onScreen: B })).send).toEqual([
      { to: A, focused: false },
      { to: B, focused: true },
    ]);
    // Another conversation on the same machine is another conversation.
    expect(aldoFocusReports(focusedOnA, now({ onScreen: A2 })).send).toEqual([
      { to: A, focused: false },
      { to: A2, focused: true },
    ]);
  });
});
