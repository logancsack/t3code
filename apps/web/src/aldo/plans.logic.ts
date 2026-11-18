// The plan Aldo puts in front of the user before big work starts (Aldo's
// src/lib/assistant/plans.ts), as Home's read carries it (`plans`): what the
// card shows (AldoPlanCard.tsx), the answers it starts with, and the words
// for where it stands: open, counting down to starting on its own, waiting
// for the user's Start, or started. An older Aldo has no plans, and what
// doesn't read as one is left out. Pure, so it's tested on its own.

import type { AldoChatDecision, AldoHomeTarget } from "./homeApi";

export interface AldoPlanQuestion {
  readonly id: string;
  readonly question: string;
  readonly options: ReadonlyArray<string>;
  readonly recommended: string;
}

export interface AldoPlan {
  readonly id: string;
  readonly goal: string;
  readonly steps: ReadonlyArray<string>;
  /** What the agent does as the user, approved with Start. */
  readonly inYourName: string | null;
  /** What it costs, in words. */
  readonly cost: string;
  readonly costsMoney: boolean;
  /** What only the user can do. */
  readonly leftForYou: string | null;
  readonly questions: ReadonlyArray<AldoPlanQuestion>;
  readonly minutes: number;
  readonly status: "proposed" | "started";
  /** When it starts on its own with the recommended answers; null when it waits for Start. */
  readonly autoStartAt: string | null;
  readonly proposedAt: string;
  readonly startedAt: string | null;
  readonly startedBy: "user" | "aldo" | "auto" | null;
  /** What it started with, by question id. */
  readonly answers: Readonly<Record<string, string>> | null;
  readonly thread: AldoHomeTarget | null;
  /** Its thread's title. */
  readonly title: string | null;
  /** Why its last start didn't go, while it's open. */
  readonly error: string | null;
  /**
   * While the user has it put off ("Not now"), when it's back; null otherwise.
   * Absent from an Aldo that can't put plans off.
   */
  readonly deferredUntil?: string | null;
  /** Put off, and back now: it waits for the user's Start. */
  readonly back?: boolean;
  /** Whether the user dismissed it from Needs you; absent from an Aldo that can't dismiss. */
  readonly chatDecision?: AldoChatDecision;
}

const isText = (value: unknown): value is string => typeof value === "string";
const textOrNull = (value: unknown): string | null => (isText(value) && value ? value : null);
const timeOrNull = (value: unknown): string | null =>
  isText(value) && !Number.isNaN(Date.parse(value)) ? value : null;

function questionOf(value: unknown): AldoPlanQuestion | null {
  const q = value as Partial<Record<keyof AldoPlanQuestion, unknown>> | null;
  if (!q || !isText(q.id) || !isText(q.question) || !Array.isArray(q.options)) return null;
  const options = q.options.filter(isText);
  if (options.length < 2 || !isText(q.recommended) || !options.includes(q.recommended)) return null;
  return { id: q.id, question: q.question, options, recommended: q.recommended };
}

function targetOf(value: unknown): AldoHomeTarget | null {
  const t = value as Partial<AldoHomeTarget> | null;
  return t && isText(t.environmentId) && isText(t.threadId)
    ? { environmentId: t.environmentId, threadId: t.threadId }
    : null;
}

function answersOf(value: unknown): Readonly<Record<string, string>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value).filter((e): e is [string, string] => isText(e[1])),
  );
}

function decisionOf(value: unknown): AldoChatDecision | null {
  const d = value as Partial<AldoChatDecision> | null;
  return d && isText(d.id) && typeof d.dismissed === "boolean"
    ? {
        id: d.id,
        dismissed: d.dismissed,
        ...(d.cleared === true ? { cleared: true } : {}),
        ...(d.removed === true ? { removed: true } : {}),
      }
    : null;
}

/** One plan from Home's read, or null when it doesn't read as one. */
export function parseAldoPlan(value: unknown): AldoPlan | null {
  const p = value as Partial<Record<keyof AldoPlan, unknown>> | null;
  if (!p || typeof p !== "object") return null;
  if (!isText(p.id) || !isText(p.goal) || !isText(p.cost) || !Array.isArray(p.steps)) return null;
  if (p.status !== "proposed" && p.status !== "started") return null;
  const proposedAt = timeOrNull(p.proposedAt);
  if (!proposedAt) return null;
  const minutes = typeof p.minutes === "number" && p.minutes > 0 ? Math.round(p.minutes) : null;
  if (minutes === null) return null;
  const questions = Array.isArray(p.questions) ? p.questions.map(questionOf) : [];
  // A question that doesn't read leaves the plan out: its Start would answer it unseen.
  if (questions.some((q) => q === null)) return null;
  const chatDecision = decisionOf(p.chatDecision);
  return {
    id: p.id,
    goal: p.goal,
    steps: p.steps.filter(isText),
    inYourName: textOrNull(p.inYourName),
    cost: p.cost,
    costsMoney: p.costsMoney === true,
    leftForYou: textOrNull(p.leftForYou),
    questions: questions as ReadonlyArray<AldoPlanQuestion>,
    minutes,
    status: p.status,
    autoStartAt: p.status === "proposed" ? timeOrNull(p.autoStartAt) : null,
    proposedAt,
    startedAt: p.status === "started" ? timeOrNull(p.startedAt) : null,
    startedBy:
      p.startedBy === "user" || p.startedBy === "aldo" || p.startedBy === "auto"
        ? p.startedBy
        : null,
    answers: answersOf(p.answers),
    thread: targetOf(p.thread),
    title: textOrNull(p.title),
    error: textOrNull(p.error),
    ...(p.deferredUntil === undefined ? {} : { deferredUntil: timeOrNull(p.deferredUntil) }),
    ...(p.back === true ? { back: true } : {}),
    ...(chatDecision ? { chatDecision } : {}),
  };
}

/** Whether a plan is put off now: hidden from the conversation until it's back. */
export function planPutOff(plan: Pick<AldoPlan, "status" | "deferredUntil">, now: number): boolean {
  return (
    plan.status === "proposed" &&
    Boolean(plan.deferredUntil) &&
    Date.parse(plan.deferredUntil!) > now
  );
}

/** Whether a plan is back from being put off: it waits for the user's Start, never starting on its own. */
export function planBack(
  plan: Pick<AldoPlan, "status" | "deferredUntil" | "back">,
  now: number,
): boolean {
  if (plan.status !== "proposed") return false;
  // Aldo says so (brought back early, or its time came), or its time came since the read.
  return (
    plan.back === true || (Boolean(plan.deferredUntil) && Date.parse(plan.deferredUntil!) <= now)
  );
}

/** Home's plans, newest first; none from an older Aldo. */
export function parseAldoPlans(value: unknown): ReadonlyArray<AldoPlan> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const plan = parseAldoPlan(item);
    return plan ? [plan] : [];
  });
}

/** "About 30 min", "About 1 hr", "About 3 hr", "About 2 days". */
export function aboutLabel(minutes: number): string {
  if (minutes < 60) return `About ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `About ${hours} hr`;
  const days = Math.round(hours / 24);
  return `About ${days} ${days === 1 ? "day" : "days"}`;
}

/** The Start button, named for what it does and how long that takes: "Start · About 30 min". */
export function startLabel(plan: Pick<AldoPlan, "minutes">): string {
  return `Start · ${aboutLabel(plan.minutes)}`;
}

/** "1:58": what's left of a countdown, never below 0:00. */
export function countdownWords(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** What each question is answered with: what the user picked, else the recommended. */
export function chosenAnswers(
  plan: Pick<AldoPlan, "questions">,
  picked: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    plan.questions.map((q) => {
      const pick = picked[q.id];
      return [q.id, pick !== undefined && q.options.includes(pick) ? pick : q.recommended];
    }),
  );
}

/** Whether the user picked anything but what Aldo recommended: then it waits for their Start. */
export function changedFromRecommended(
  plan: Pick<AldoPlan, "questions">,
  picked: Readonly<Record<string, string>>,
): boolean {
  const chosen = chosenAnswers(plan, picked);
  return plan.questions.some((q) => chosen[q.id] !== q.recommended);
}

/** What the card says of a plan, and what it lets the user do. */
export type AldoPlanCardState =
  /** Open, starting on its own at `at` if the user doesn't answer. */
  | { readonly kind: "countdown"; readonly at: number; readonly left: string }
  /** Its time is up: starting now (the server does it; the card asks it to). */
  | { readonly kind: "due" }
  /** Open, waiting for the user's Start, and why. */
  | { readonly kind: "waiting"; readonly why: string }
  | { readonly kind: "starting" }
  | { readonly kind: "started"; readonly summary: string };

/**
 * Where a plan stands for its card. `busy`: a Start is on its way. `held`:
 * the user changed an answer or asked to change the plan here, so it no
 * longer starts on its own (the server hears it too).
 */
export function planCardState(
  plan: AldoPlan,
  options: { readonly now: number; readonly busy?: boolean; readonly held?: boolean },
): AldoPlanCardState {
  if (plan.status === "started") return { kind: "started", summary: startedSummary(plan) };
  if (options.busy) return { kind: "starting" };
  if (plan.error) return { kind: "waiting", why: plan.error };
  if (plan.costsMoney)
    return { kind: "waiting", why: "It costs money, so it waits for your Start." };
  if (planBack(plan, options.now))
    return { kind: "waiting", why: "You put it off, so it waits for your Start." };
  const at = plan.autoStartAt ? Date.parse(plan.autoStartAt) : null;
  if (at === null || options.held) return { kind: "waiting", why: "It waits for your Start." };
  if (at <= options.now) return { kind: "due" };
  return { kind: "countdown", at, left: countdownWords(at - options.now) };
}

/** Words ending as a sentence does, for what Aldo wrote that may not. */
export function sentence(words: string): string {
  const text = words.trim();
  return !text || /[.!?…:;)"”’]$/.test(text) ? text : `${text}.`;
}

/** The plan's "In your name" inset: what it does as the user, then what it costs. */
export function inYourNameWords(plan: Pick<AldoPlan, "inYourName" | "cost">): string {
  return [plan.inYourName, plan.cost].flatMap((w) => (w ? [sentence(w)] : [])).join(" ");
}

/** The countdown's words: "Starts with these in 1:58 if you’re away." */
export function countdownNote(left: string, hasQuestions: boolean): string {
  return hasQuestions
    ? `Starts with these in ${left} if you’re away.`
    : `Starts in ${left} if you’re away.`;
}

/**
 * What a started plan says it started with: "Started with: logo reveals and
 * short promos · Logan Sack"; on its own, it says so.
 */
export function startedSummary(
  plan: Pick<AldoPlan, "questions" | "answers" | "startedBy">,
): string {
  const lead = plan.startedBy === "auto" ? "Started on its own" : "Started";
  const answers = plan.questions.map((q) => plan.answers?.[q.id] ?? q.recommended);
  return answers.length > 0 ? `${lead} with: ${answers.join(" · ")}` : lead;
}

/** How far this browser's clock may be from Aldo's: `from` is the browser's, a plan's times are Aldo's. */
const CLOCK_SKEW_MS = 5 * 60_000;

/**
 * Plans still waiting on the user, oldest first, for the conversation's end:
 * those proposed since `from` (the conversation's start, as what happened),
 * any still counting down to start on its own, which is never left unseen,
 * and any back from being put off. One put off is away until it's back.
 */
export function openPlans(
  plans: ReadonlyArray<AldoPlan>,
  from: string | null,
  now: number,
): ReadonlyArray<AldoPlan> {
  const start = from ? Date.parse(from) - CLOCK_SKEW_MS : -Infinity;
  return plans
    .filter(
      (p) =>
        p.status === "proposed" &&
        !planPutOff(p, now) &&
        (p.autoStartAt !== null || Date.parse(p.proposedAt) >= start || planBack(p, now)),
    )
    .toSorted((a, b) => a.proposedAt.localeCompare(b.proposedAt));
}

/** The newer of two copies of a plan: one that started stays started while the home read catches up. */
export function newerPlan(shown: AldoPlan, latest: AldoPlan | null): AldoPlan {
  return latest &&
    latest.id === shown.id &&
    latest.status === "started" &&
    shown.status !== "started"
    ? latest
    : shown;
}
