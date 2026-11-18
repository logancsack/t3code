// The brief's time in settings (AldoNotificationSettings.tsx BriefRow): a
// choice of times through the morning, or off. A time set another way (by
// telling Aldo "send it at 7:45") is among the choices too. Pure, so it's
// tested on its own.

import type { AldoPolicyOption } from "./policy.logic";

/** Every half hour from 5 to 10 in the morning. */
const CHOICES = Array.from({ length: 11 }, (_, i) => 5 * 60 + i * 30);
export const BRIEF_OFF = "off";

/** "7:30 AM", as this device writes times. */
export function briefTimeLabel(minute: number): string {
  return new Date(Date.UTC(2000, 0, 1, Math.floor(minute / 60), minute % 60)).toLocaleTimeString(
    [],
    { hour: "numeric", minute: "2-digit", timeZone: "UTC" },
  );
}

/** The choices, in order of the day, with the one set now among them, then Off. */
export function briefTimeOptions(minute: number): ReadonlyArray<AldoPolicyOption> {
  const minutes = CHOICES.includes(minute) ? CHOICES : [...CHOICES, minute].sort((a, b) => a - b);
  return [
    ...minutes.map((m) => ({ value: String(m), label: briefTimeLabel(m) })),
    { value: BRIEF_OFF, label: "Off" },
  ];
}
