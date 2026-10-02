import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_ROUTINE_FORM,
  routineLastResult,
  routineRequest,
  routineStatus,
} from "./routines.logic";

const form = { ...EMPTY_ROUTINE_FORM, title: " Morning briefing ", instruction: " Brief me. " };

describe("routineRequest", () => {
  it("asks for a name and what to do", () => {
    expect(routineRequest(EMPTY_ROUTINE_FORM)).toEqual({ ok: false, reason: "Give it a name." });
    expect(routineRequest({ ...EMPTY_ROUTINE_FORM, title: "x" })).toEqual({
      ok: false,
      reason: "Say what it should do.",
    });
  });

  it("builds each schedule", () => {
    expect(routineRequest(form)).toEqual({
      ok: true,
      title: "Morning briefing",
      instruction: "Brief me.",
      schedule: { every: "weekdays", at: ["08:00"] },
      webhook: false,
    });
    expect(
      routineRequest({ ...form, frequency: "week", days: ["fri", "mon"], time: "09:30" }),
    ).toMatchObject({
      schedule: { every: "week", days: ["mon", "fri"], at: ["09:30"] },
    });
    expect(routineRequest({ ...form, frequency: "month", dayOfMonth: 31 })).toMatchObject({
      schedule: { every: "month", day: 31, at: ["08:00"] },
    });
    expect(routineRequest({ ...form, frequency: "hours", hours: 3 })).toMatchObject({
      schedule: { every: "hours", hours: 3 },
    });
  });

  it("runs only from a webhook, or from both", () => {
    expect(routineRequest({ ...form, frequency: "webhook" })).toMatchObject({
      schedule: null,
      webhook: true,
    });
    expect(routineRequest({ ...form, frequency: "day", webhook: true })).toMatchObject({
      schedule: { every: "day", at: ["08:00"] },
      webhook: true,
    });
  });

  it("refuses what Aldo would", () => {
    expect(routineRequest({ ...form, frequency: "week", days: [] })).toMatchObject({ ok: false });
    expect(routineRequest({ ...form, time: "25:00" })).toMatchObject({ ok: false });
    expect(routineRequest({ ...form, frequency: "hours", hours: 0 })).toMatchObject({ ok: false });
    expect(routineRequest({ ...form, frequency: "month", dayOfMonth: 32 })).toMatchObject({
      ok: false,
    });
  });
});

describe("routineStatus", () => {
  const dueIn = () => "tomorrow 8:00 AM";
  it("says when it runs next, or why it doesn't", () => {
    const routine = {
      enabled: true,
      nextRunAt: "2026-10-03T12:00:00Z",
      schedule: null,
      webhook: null,
    };
    expect(routineStatus(routine, dueIn)).toBe("Next tomorrow 8:00 AM");
    expect(routineStatus({ ...routine, enabled: false }, dueIn)).toBe("Paused");
    expect(routineStatus({ ...routine, nextRunAt: null, webhook: "https://x" }, dueIn)).toBe(
      "Webhook",
    );
  });
});

describe("routineLastResult", () => {
  it("reads Aldo's note on the last run", () => {
    expect(routineLastResult({ lastResult: null })).toBeNull();
    expect(routineLastResult({ lastResult: "sent to its thread" })).toEqual({
      text: "Sent to its thread",
      failed: false,
    });
    expect(routineLastResult({ lastResult: "failed: Out of credits." })).toEqual({
      text: "Out of credits.",
      failed: true,
    });
    expect(routineLastResult({ lastResult: "skipped: the last run hasn't gone yet" })).toEqual({
      text: "The last run hasn't gone yet",
      failed: false,
    });
  });
});
