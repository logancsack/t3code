// Routines on the home screen (AldoRoutines.tsx): the new-routine form's
// choices as the schedule Aldo takes (cloud.ts AldoRoutineSchedule), and how a
// routine's state reads. Times are the user's own: Aldo keeps the browser's
// time zone and runs each routine in it.

import type { AldoRoutine, AldoRoutineSchedule, AldoWeekday } from "./cloud";

export const ALDO_WEEKDAYS: ReadonlyArray<{ readonly day: AldoWeekday; readonly short: string }> = [
  { day: "mon", short: "Mon" },
  { day: "tue", short: "Tue" },
  { day: "wed", short: "Wed" },
  { day: "thu", short: "Thu" },
  { day: "fri", short: "Fri" },
  { day: "sat", short: "Sat" },
  { day: "sun", short: "Sun" },
];

/** How often, as the form offers it; "webhook" runs only when its webhook is called. */
export type RoutineFrequency = "day" | "weekdays" | "week" | "month" | "hours" | "webhook";

export const ROUTINE_FREQUENCIES: ReadonlyArray<{
  readonly value: RoutineFrequency;
  readonly label: string;
}> = [
  { value: "day", label: "Every day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "week", label: "Every week" },
  { value: "month", label: "Every month" },
  { value: "hours", label: "Every few hours" },
  { value: "webhook", label: "Only when its webhook is called" },
];

export interface RoutineForm {
  readonly title: string;
  readonly instruction: string;
  readonly frequency: RoutineFrequency;
  /** HH:MM, 24-hour. */
  readonly time: string;
  readonly days: ReadonlyArray<AldoWeekday>;
  readonly dayOfMonth: number;
  readonly hours: number;
  readonly webhook: boolean;
}

export const EMPTY_ROUTINE_FORM: RoutineForm = {
  title: "",
  instruction: "",
  frequency: "weekdays",
  time: "08:00",
  days: ["mon"],
  dayOfMonth: 1,
  hours: 4,
  webhook: false,
};

/**
 * What the form asks Aldo for, or why it can't yet: a title, what to do, and
 * a schedule, a webhook, or both.
 */
export function routineRequest(form: RoutineForm):
  | {
      readonly ok: true;
      readonly title: string;
      readonly instruction: string;
      readonly schedule: AldoRoutineSchedule | null;
      readonly webhook: boolean;
    }
  | { readonly ok: false; readonly reason: string } {
  const title = form.title.trim();
  const instruction = form.instruction.trim();
  if (!title) return { ok: false, reason: "Give it a name." };
  if (!instruction) return { ok: false, reason: "Say what it should do." };
  const webhook = form.webhook || form.frequency === "webhook";
  if (form.frequency === "webhook")
    return { ok: true, title, instruction, schedule: null, webhook };
  if (form.frequency === "hours") {
    if (!Number.isInteger(form.hours) || form.hours < 1 || form.hours > 24) {
      return { ok: false, reason: "Every 1 to 24 hours." };
    }
    return {
      ok: true,
      title,
      instruction,
      schedule: { every: "hours", hours: form.hours },
      webhook,
    };
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.time)) return { ok: false, reason: "Pick a time." };
  if (form.frequency === "week") {
    if (form.days.length === 0) return { ok: false, reason: "Pick at least one day." };
    const days = ALDO_WEEKDAYS.map((w) => w.day).filter((day) => form.days.includes(day));
    return {
      ok: true,
      title,
      instruction,
      schedule: { every: "week", days, at: [form.time] },
      webhook,
    };
  }
  if (form.frequency === "month") {
    if (!Number.isInteger(form.dayOfMonth) || form.dayOfMonth < 1 || form.dayOfMonth > 31) {
      return { ok: false, reason: "A day of the month, 1 to 31." };
    }
    return {
      ok: true,
      title,
      instruction,
      schedule: { every: "month", day: form.dayOfMonth, at: [form.time] },
      webhook,
    };
  }
  return {
    ok: true,
    title,
    instruction,
    schedule: { every: form.frequency, at: [form.time] },
    webhook,
  };
}

/** A routine's state in a few words: paused, its next run, or that only its webhook runs it. */
export function routineStatus(
  routine: Pick<AldoRoutine, "enabled" | "nextRunAt" | "schedule" | "webhook">,
  dueIn: (iso: string) => string,
): string {
  if (!routine.enabled) return "Paused";
  if (routine.nextRunAt) return `Next ${dueIn(routine.nextRunAt)}`;
  return routine.webhook ? "Webhook" : "When you run it";
}

/** How its last run went, for the user: Aldo's note, without its "failed: " prefix. */
export function routineLastResult(
  routine: Pick<AldoRoutine, "lastResult">,
): { readonly text: string; readonly failed: boolean } | null {
  const result = routine.lastResult?.trim();
  if (!result) return null;
  const failed = result.startsWith("failed:");
  const text = result.replace(/^(failed|skipped):\s*/, "");
  return { text: text.charAt(0).toUpperCase() + text.slice(1), failed };
}
