// Goals, as Aldo keeps them (its src/lib/goal-page.ts): an outcome Aldo works
// toward for weeks from a plan the user approves once. The page only reads.
// An older Aldo has no goals at all: its 404 is "none", never an error.

import { ALDO_READ_ANSWERS_WITHIN_MS, AldoApiError, api } from "./api";

export type AldoGoalStatus = "researching" | "awaiting_approval" | "running" | "paused" | "ended";

export interface AldoGoalMeasure {
  readonly key: string;
  readonly name: string;
  /** An early sign that the work is landing, or the result itself. */
  readonly kind: "early" | "result";
  /** Where the number is read from, as the plan says. */
  readonly source: string;
  readonly start: number | string | null;
  readonly target: number | string | null;
  readonly readBy: "aldo" | "user" | null;
  /** The newest reading, when there is one. */
  readonly latest: { readonly value: number | string; readonly at: string } | null;
}

export interface AldoGoalConversation {
  readonly role: "lead" | "workstream" | "check";
  readonly workstream: string | null;
  /** The workstream's name from the plan. */
  readonly name: string | null;
  readonly threadId: string;
  readonly t3ThreadId: string;
  readonly title: string;
  readonly state: string;
  /** Its part in the goal is over. */
  readonly ended: boolean;
}

export interface AldoGoalWaiting {
  /** A card to answer, a conversation waiting on an answer, or a step the plan gives the user. */
  readonly kind: "approval" | "question" | "step";
  readonly title: string;
  readonly threadId?: string;
  readonly t3ThreadId?: string;
  readonly minutes?: number;
}

export interface AldoGoalLimits {
  readonly credits?: number;
  readonly modelUsd?: number;
  readonly moneyUsd?: number;
  readonly threadsAtOnce?: number;
}

export interface AldoGoal {
  readonly id: string;
  readonly title: string;
  readonly status: AldoGoalStatus | (string & {});
  readonly endedWhy: string | null;
  /** What the user wrote, exactly. */
  readonly words: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Since when it has been paused, and when it ended; an older Aldo says neither. */
  readonly pausedAt?: string | null;
  readonly endedAt?: string | null;
  readonly plan: { readonly version: number; readonly approvedAt: string } | null;
  /** A newer version than the one in force; put to the user once it has an approval card. */
  readonly proposed: {
    readonly version: number;
    readonly why: string;
    readonly approvalId?: string | null;
  } | null;
  readonly outcome: {
    readonly text: string;
    readonly by?: string;
    readonly ongoing?: boolean;
  } | null;
  readonly measures: ReadonlyArray<AldoGoalMeasure>;
  readonly conversations: ReadonlyArray<AldoGoalConversation>;
  readonly waiting: ReadonlyArray<AldoGoalWaiting>;
  readonly spending: {
    readonly modelUsd: number;
    readonly moneyUsd: number;
    readonly limits: AldoGoalLimits | null;
  };
}

export interface AldoGoalLogLine {
  readonly id: number;
  readonly kind: string;
  readonly text: string;
  /** Who wrote it, by their part in the goal; null for Aldo itself. */
  readonly by: { readonly role: string; readonly workstream: string | null } | null;
  readonly at: string;
}

const list = <T>(value: unknown): ReadonlyArray<T> => (Array.isArray(value) ? (value as T[]) : []);

/** A goal as this page draws it: every list is a list, whatever a newer or older Aldo left out. */
function goalFrom(raw: AldoGoal): AldoGoal {
  return {
    ...raw,
    measures: list<AldoGoalMeasure>(raw.measures),
    conversations: list<AldoGoalConversation>(raw.conversations),
    waiting: list<AldoGoalWaiting>(raw.waiting),
    spending: {
      modelUsd: Number(raw.spending?.modelUsd) || 0,
      moneyUsd: Number(raw.spending?.moneyUsd) || 0,
      limits: raw.spending?.limits ?? null,
    },
  };
}

const none = (cause: unknown) => cause instanceof AldoApiError && cause.status === 404;

/** The user's goals, the ones still going first; null from an Aldo that has no goals yet. */
export async function fetchAldoGoals(): Promise<ReadonlyArray<AldoGoal> | null> {
  try {
    // Cut off like Home's reads: one that never answers (a phone that slept, a changed network) would
    // otherwise hold every later look, which shares it (goals.ts).
    const body = await api<{ goals?: unknown }>("/api/goals", {
      answersWithin: ALDO_READ_ANSWERS_WITHIN_MS,
    });
    return list<AldoGoal>(body.goals).map(goalFrom);
  } catch (cause) {
    if (none(cause)) return null;
    throw cause;
  }
}

export interface AldoGoalRead {
  readonly goal: AldoGoal;
  /** Newest first. */
  readonly log: ReadonlyArray<AldoGoalLogLine>;
  /** Older lines remain. */
  readonly more: boolean;
}

/** One goal with a page of its log (`limit` lines before `before`); null when it isn't there. */
export async function fetchAldoGoal(
  id: string,
  page: { readonly before?: number; readonly limit?: number } = {},
): Promise<AldoGoalRead | null> {
  const asked = new URLSearchParams();
  if (page.before !== undefined) asked.set("before", String(page.before));
  if (page.limit !== undefined) asked.set("limit", String(page.limit));
  const query = asked.size ? `?${asked}` : "";
  try {
    const body = await api<{ goal?: AldoGoal; log?: unknown; more?: unknown }>(
      `/api/goals/${encodeURIComponent(id)}${query}`,
      { answersWithin: ALDO_READ_ANSWERS_WITHIN_MS },
    );
    if (!body.goal) return null;
    return {
      goal: goalFrom(body.goal),
      log: list<AldoGoalLogLine>(body.log),
      more: body.more === true,
    };
  } catch (cause) {
    if (none(cause)) return null;
    throw cause;
  }
}
