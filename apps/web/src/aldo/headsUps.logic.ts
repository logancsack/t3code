// Heads-ups in settings (AldoNotificationSettings.tsx HeadsUpsRow): quiet
// hours, how often Aldo reads the user's other apps, and what they want to
// hear about or not. Pure, so it's tested on its own.

import type { AldoHeadsUpsTuning } from "./accountApi";
import { briefTimeLabel } from "./briefSettings.logic";
import type { AldoPolicyOption } from "./policy.logic";

/** What Aldo keeps of what they want to hear about, or not. */
export const HEADS_UP_TOPIC_CHARS = 500;

/** Every half hour of the day. */
const QUIET_CHOICES = Array.from({ length: 48 }, (_, i) => i * 30);

/** The quiet hours' choices, every half hour, with the one set now among them. */
export function quietTimeOptions(minute: number): ReadonlyArray<AldoPolicyOption> {
  const minutes = QUIET_CHOICES.includes(minute)
    ? QUIET_CHOICES
    : [...QUIET_CHOICES, minute].sort((a, b) => a - b);
  return minutes.map((m) => ({ value: String(m), label: briefTimeLabel(m) }));
}

const APPS_EVERY_CHOICES = [2, 4, 8];

/** How often Aldo reads their other apps: every 2, 4 or 8 hours, or never. */
export function appsEveryOptions(hours: number): ReadonlyArray<AldoPolicyOption> {
  const choices =
    hours === 0 || APPS_EVERY_CHOICES.includes(hours)
      ? APPS_EVERY_CHOICES
      : [...APPS_EVERY_CHOICES, hours].sort((a, b) => a - b);
  return [
    ...choices.map((h) => ({ value: String(h), label: `Every ${h} hours` })),
    { value: "0", label: "Never" },
  ];
}

/** "Linear", "Linear and Notion", "Linear, Notion and 2 more". */
function namesSaid(names: ReadonlyArray<string>): string {
  if (names.length <= 2) return names.join(" and ");
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** What the other-apps line says under its choice; null when no app is connected. */
export function appsNote(tuning: AldoHeadsUpsTuning): string | null {
  if (tuning.apps.length === 0) return null;
  const names = namesSaid(tuning.apps);
  return tuning.appsEvery === 0
    ? `Aldo won't read ${names}.`
    : `Aldo reads only what's new in ${names}.`;
}

/** Said beside quiet hours that start and end at the same time. */
export function quietHoursNote(tuning: AldoHeadsUpsTuning): string | null {
  return tuning.quietStart === tuning.quietEnd ? "The same time: never quiet." : null;
}

/** A topic as Aldo keeps it: spaces collapsed, trimmed. */
export function topicSaid(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Which of what they typed differs from what's saved, ready to send. */
export function topicsChange(
  saved: Pick<AldoHeadsUpsTuning, "tell" | "skip">,
  draft: Pick<AldoHeadsUpsTuning, "tell" | "skip">,
): { tell?: string; skip?: string } {
  const tell = topicSaid(draft.tell);
  const skip = topicSaid(draft.skip);
  return {
    ...(tell !== saved.tell ? { tell } : {}),
    ...(skip !== saved.skip ? { skip } : {}),
  };
}
