// The words and numbers of the Goals page (AldoGoals.tsx), from what Aldo
// reports of a goal (goalsApi.ts). Everything is said plainly and nothing is
// made up: a measure with no reading says so, and progress is drawn only
// between a start and a target that are both numbers.

import type {
  AldoGoal,
  AldoGoalConversation,
  AldoGoalLimits,
  AldoGoalLogLine,
  AldoGoalMeasure,
  AldoGoalWaiting,
} from "./goalsApi";

export type GoalTone = "quiet" | "working" | "yours" | "good" | "bad";

/** Where a goal stands, in a few words. */
export function goalStatus(goal: Pick<AldoGoal, "status" | "endedWhy">): {
  readonly label: string;
  readonly tone: GoalTone;
} {
  switch (goal.status) {
    case "researching":
      return { label: "Researching", tone: "working" };
    case "awaiting_approval":
      return { label: "Needs your approval", tone: "yours" };
    case "running":
      return { label: "Running", tone: "good" };
    case "paused":
      return { label: "Paused", tone: "yours" };
    case "ended":
      switch (goal.endedWhy) {
        case "reached":
          return { label: "Reached", tone: "good" };
        case "stopped":
          return { label: "Stopped", tone: "quiet" };
        case "time":
          return { label: "Ended: out of time", tone: "quiet" };
        case "budget":
          return { label: "Ended: limit reached", tone: "quiet" };
        default:
          return { label: "Ended", tone: "quiet" };
      }
    default:
      return { label: "Not started", tone: "quiet" };
  }
}

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A day as people write it; a date alone is that calendar day wherever the reader is. */
export function goalDay(iso: string): string {
  const at = DAY_ONLY.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** The outcome in one line: what's true at the end, and by when. */
export function goalOutcome(goal: Pick<AldoGoal, "outcome">): string | null {
  const outcome = goal.outcome;
  if (!outcome?.text.trim()) return null;
  const text = outcome.text.trim().replace(/[.\s]+$/, "");
  const by = outcome.by?.trim();
  if (outcome.ongoing)
    return by ? `${text}. Ongoing, next decided ${goalDay(by)}.` : `${text}. Ongoing.`;
  return by ? `${text}, by ${goalDay(by)}.` : `${text}.`;
}

/** A measure's value as it's read: numbers grouped, anything else as written. */
export function goalValue(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number")
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return value;
}

/**
 * How far a measure has come from its start to its target, 0 to 1; null unless
 * all three are numbers and the target isn't the start. A target below the
 * start (bring a cost down) counts the same way, toward it.
 */
export function goalProgress(
  measure: Pick<AldoGoalMeasure, "start" | "target" | "latest">,
): number | null {
  const { start, target } = measure;
  const now = measure.latest?.value;
  if (typeof start !== "number" || typeof target !== "number" || typeof now !== "number")
    return null;
  if (target === start) return null;
  return Math.min(1, Math.max(0, (now - start) / (target - start)));
}

/** Under a measure: where it started, where it's read, when and by whom. */
export function goalMeasureNote(
  measure: AldoGoalMeasure,
  now: number,
  ago: (iso: string, now: number) => string,
): string {
  const parts: string[] = [];
  const start = goalValue(measure.start);
  if (start !== null) parts.push(`Started at ${start}`);
  if (measure.latest) parts.push(`read ${ago(measure.latest.at, now)}`);
  else parts.push(measure.readBy === "user" ? "you read this one" : "not read yet");
  if (measure.source.trim()) parts.push(`from ${measure.source.trim()}`);
  const line = parts.join(", ");
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
}

/** Who a conversation is in the goal: the lead, the check, or its workstream by name. */
export function goalPart(
  conversation: Pick<AldoGoalConversation, "role" | "workstream" | "name">,
): string {
  if (conversation.role === "lead") return "Lead";
  if (conversation.role === "check") return "Check";
  return conversation.name?.trim() || conversation.workstream?.trim() || "Workstream";
}

const WORKING = new Set(["working", "starting", "queued", "retrying"]);

/** What a goal's conversation is doing now. */
export function goalConversationState(
  conversation: Pick<AldoGoalConversation, "state" | "ended">,
): {
  readonly label: string;
  readonly tone: GoalTone;
} {
  if (conversation.ended) return { label: "Finished its part", tone: "quiet" };
  if (WORKING.has(conversation.state)) return { label: "Working", tone: "working" };
  switch (conversation.state) {
    case "waiting":
      return { label: "Needs you", tone: "yours" };
    case "paused":
      return { label: "Paused", tone: "quiet" };
    case "failed":
    case "error":
      return { label: "Stopped on an error", tone: "bad" };
    case "stopped":
    case "interrupted":
      return { label: "Stopped", tone: "quiet" };
    default:
      return { label: "Not working now", tone: "quiet" };
  }
}

/** A thing waiting on the user, said as what it is. */
export function goalWaitingKind(waiting: Pick<AldoGoalWaiting, "kind" | "minutes">): string {
  if (waiting.kind === "approval") return "A card to answer";
  if (waiting.kind === "question") return "A question for you";
  const minutes = waiting.minutes;
  if (typeof minutes !== "number" || !(minutes > 0)) return "A step for you";
  if (minutes < 60) return `A step for you, about ${Math.round(minutes)} min`;
  const hours = Math.round((minutes / 60) * 2) / 2;
  return `A step for you, about ${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/** Each thing waiting with a name of its own for the list: what it is and where, numbered when two read the same. */
export function goalWaitingKeyed<T extends AldoGoalWaiting>(
  waiting: ReadonlyArray<T>,
): ReadonlyArray<{ readonly key: string; readonly waiting: T }> {
  const seen = new Map<string, number>();
  return waiting.map((item) => {
    const base = `${item.kind}:${item.threadId ?? ""}:${item.t3ThreadId ?? ""}:${item.title}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { key: count === 0 ? base : `${base}#${count}`, waiting: item };
  });
}

/** How many things wait on the user, for a goal's row. */
export function goalNeedsYou(goal: Pick<AldoGoal, "waiting">): string | null {
  const count = goal.waiting.length;
  return count === 0 ? null : count === 1 ? "1 thing needs you" : `${count} things need you`;
}

const usd = (amount: number) =>
  amount.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });

/** What the goal has cost since it began. */
export function goalSpent(
  goal: Pick<AldoGoal, "spending">,
): ReadonlyArray<{ readonly label: string; readonly value: string }> {
  return [
    { label: "Model use", value: usd(goal.spending.modelUsd) },
    { label: "Money spent", value: usd(goal.spending.moneyUsd) },
  ];
}

/** The plan's weekly limits as one sentence, or null when it set none. */
export function goalLimits(limits: AldoGoalLimits | null): string | null {
  if (!limits) return null;
  const parts: string[] = [];
  if (typeof limits.credits === "number") parts.push(`${limits.credits.toLocaleString()} credits`);
  if (typeof limits.modelUsd === "number") parts.push(`${usd(limits.modelUsd)} of model use`);
  if (typeof limits.moneyUsd === "number") parts.push(`${usd(limits.moneyUsd)} spent`);
  const week = parts.length ? `The plan allows ${parts.join(", ")} a week` : "";
  const threads =
    typeof limits.threadsAtOnce === "number"
      ? `${limits.threadsAtOnce} ${limits.threadsAtOnce === 1 ? "thread" : "threads"} at once`
      : "";
  if (!week && !threads) return null;
  return week && threads
    ? `${week}, and ${threads}.`
    : week
      ? `${week}.`
      : `The plan allows ${threads}.`;
}

const KINDS: Record<string, string> = {
  result: "Result",
  measurement: "Reading",
  decision: "Decision",
  fact: "Fact",
  review: "Review",
  question: "Question",
  plan: "Plan",
  note: "Note",
};

/** A log line's kind, as a word. */
export function goalLogKind(line: Pick<AldoGoalLogLine, "kind">): string {
  return KINDS[line.kind] ?? "Note";
}

/** Who wrote a log line: their part in the goal, by the workstream's name when the plan has it. */
export function goalLogWriter(
  line: Pick<AldoGoalLogLine, "by">,
  goal: Pick<AldoGoal, "conversations">,
): string {
  const by = line.by;
  if (!by) return "Aldo";
  if (by.role === "lead") return "Lead";
  if (by.role === "check") return "Check";
  const named = goal.conversations.find(
    (c) => c.role === "workstream" && c.workstream === by.workstream,
  );
  return named?.name?.trim() || by.workstream?.trim() || "Workstream";
}

/** The day a log line belongs under: Today, Yesterday, or the date. */
export function goalLogDay(iso: string, now: number): string {
  const at = new Date(iso);
  const today = new Date(now);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(at)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return at.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(at.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Log lines under their days, in the order given (newest first). */
export function goalLogByDay<T extends Pick<AldoGoalLogLine, "at">>(
  lines: ReadonlyArray<T>,
  now: number,
): ReadonlyArray<{ readonly day: string; readonly lines: ReadonlyArray<T> }> {
  const days: { day: string; lines: T[] }[] = [];
  for (const line of lines) {
    const day = goalLogDay(line.at, now);
    const last = days.at(-1);
    if (last?.day === day) last.lines.push(line);
    else days.push({ day, lines: [line] });
  }
  return days;
}

/** The measure a goal's row leads with: the first result that has a reading, else the first result, else the first. */
export function goalHeadline(goal: Pick<AldoGoal, "measures">): AldoGoalMeasure | null {
  const results = goal.measures.filter((m) => m.kind === "result");
  return results.find((m) => m.latest) ?? results[0] ?? goal.measures[0] ?? null;
}

/**
 * A measure's now against its target: "1,240 of 5,000", "1,240", "No reading
 * yet". "Of" only where the reading counts up to the target; one that comes
 * down to it (a cost, a day of the month) or isn't a number is "11, aiming for 5".
 */
export function goalReading(measure: Pick<AldoGoalMeasure, "latest" | "target" | "start">): string {
  const now = goalValue(measure.latest?.value);
  const target = goalValue(measure.target);
  if (now === null)
    return target === null ? "No reading yet" : `No reading yet, aiming for ${target}`;
  if (target === null) return now;
  const countsUp =
    typeof measure.latest?.value === "number" &&
    typeof measure.target === "number" &&
    !(typeof measure.start === "number" && measure.target < measure.start);
  return countsUp ? `${now} of ${target}` : `${now}, aiming for ${target}`;
}
