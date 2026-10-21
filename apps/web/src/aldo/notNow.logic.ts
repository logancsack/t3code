// "Not now" (AldoNotNow.tsx): when what waits on the user comes back, if they
// put it off. The choices are the ones people know from snoozing mail: later
// today, tomorrow morning, next week, or a time they pick, each saying when,
// in their time. It comes back then, once, and nothing goes ahead on its own
// meanwhile, nor after (Aldo's src/lib/not-now.ts).

/** When the mornings it offers start. */
const MORNING_HOUR = 8;
/** Before this, "tomorrow morning" is this morning still. */
const NIGHT_ENDS_HOUR = 5;
/** Later today is this long on, at the next half hour, and not past 9 PM. */
const LATER_MS = 3 * 60 * 60_000;
const LATEST_TODAY_HOUR = 21;
/** How far ahead it may be put off (Aldo refuses more). */
export const NOT_NOW_MAX_DAYS = 30;
const DAY_MS = 86_400_000;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export interface NotNowChoice {
  readonly key: "later" | "morning" | "next-week";
  readonly label: string;
  /** When, in a few words: "6:30 PM", "Mon 8:00 AM". */
  readonly when: string;
  readonly until: Date;
}

/** "6:30 PM", in the user's own time. */
export function clockTime(at: Date): string {
  const hour = at.getHours() % 12 || 12;
  return `${hour}:${String(at.getMinutes()).padStart(2, "0")} ${at.getHours() < 12 ? "AM" : "PM"}`;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const atMorning = (day: Date, addDays: number) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate() + addDays, MORNING_HOUR);

/** What "Not now" offers at `now`: later today while there's enough of it, the next morning, and next week's first. */
export function notNowChoices(now: Date): ReadonlyArray<NotNowChoice> {
  const choices: NotNowChoice[] = [];
  const later = new Date(now.getTime() + LATER_MS);
  later.setSeconds(0, 0);
  const minutes = later.getMinutes();
  if (minutes % 30 !== 0) later.setMinutes(minutes < 30 ? 30 : 60);
  const minutesIn = later.getHours() * 60 + later.getMinutes();
  if (sameDay(later, now) && minutesIn <= LATEST_TODAY_HOUR * 60) {
    choices.push({ key: "later", label: "Later today", when: clockTime(later), until: later });
  }
  const early = now.getHours() < NIGHT_ENDS_HOUR;
  const morning = atMorning(now, early ? 0 : 1);
  choices.push({
    key: "morning",
    label: early ? "This morning" : "Tomorrow morning",
    when: clockTime(morning),
    until: morning,
  });
  // The next Monday's (a week on, on a Monday).
  const monday = atMorning(now, (8 - now.getDay()) % 7 || 7);
  if (monday.getTime() !== morning.getTime()) {
    choices.push({
      key: "next-week",
      label: "Next week",
      when: `${WEEKDAYS[monday.getDay()]} ${clockTime(monday)}`,
      until: monday,
    });
  }
  return choices;
}

/** When it's back, after "Back": "at 6:30 PM", "tomorrow at 8:00 AM", "Mon at 8:00 AM", "Nov 3 at 8:00 AM". */
export function backWhen(until: Date, now: Date): string {
  const time = clockTime(until);
  if (sameDay(until, now)) return `at ${time}`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (sameDay(until, tomorrow)) return `tomorrow at ${time}`;
  if (until.getTime() - now.getTime() < 6 * DAY_MS) return `${WEEKDAYS[until.getDay()]} at ${time}`;
  return `${MONTHS[until.getMonth()]} ${until.getDate()} at ${time}`;
}

/** A time as a datetime-local field has it: "2026-10-21T18:30", in the user's own time. */
export function fieldTime(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** The time the user picked, or why it won't do. */
export function pickedTime(
  value: string,
  now: Date,
): { readonly until: Date } | { readonly error: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return { error: "Pick a day and a time." };
  const [, year, month, day, hour, minute] = match.map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const until = new Date(year, month - 1, day, hour, minute);
  if (until.getTime() < now.getTime() + 60_000) return { error: "Pick a time later than now." };
  if (until.getTime() > now.getTime() + NOT_NOW_MAX_DAYS * DAY_MS)
    return { error: `Pick a time within ${NOT_NOW_MAX_DAYS} days.` };
  return { until };
}
