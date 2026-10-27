// What a thread's card says in Aldo's conversation (AldoLiveCard.tsx): its
// state in plain words, how long, what it did last, and the one thing to do
// about it, from Aldo's home read. A thread that stopped moving (paused when
// its computer slept, no word for an hour, or a message of the user's that
// hasn't reached it) says so and offers Continue. Pure, so it's tested on its
// own.

import { type AldoHome, type AldoHomeConversation } from "./homeApi";
import {
  elapsed,
  healthIssues,
  isPausedMidTurn,
  isStuck,
  needsYouKind,
  NEEDS_YOU_LABEL,
  relativeTime,
  sameTarget,
} from "./home.logic";

/** A user's own message held this long past its time hasn't gone: Aldo's retries each minute have failed. */
const UNSENT_MS = 5 * 60_000;

export interface Stalled {
  readonly kind: "paused" | "stuck" | "unsent";
  /** When it stopped moving, or when the held message was sent. */
  readonly since: string;
  /** The user's message that hasn't reached the agent. */
  readonly message?: string;
  /** What keeps it from carrying on, with the way to fix it: Continue would only stall again. */
  readonly blocked?: { readonly text: string; readonly label: string; readonly href: string };
}

/**
 * How a conversation has stopped moving, or null. A thread paused mid-turn
 * counts toward Needs you (it waits for a tap); the others are shown with
 * Continue, but long work and a retry that's under way don't ask for the user.
 */
export function stalledOf(
  home: Pick<AldoHome, "upcoming" | "usage" | "health">,
  c: AldoHomeConversation,
  now: number,
): Stalled | null {
  const held = home.upcoming.find(
    (d) =>
      d.kind === "message" &&
      d.held &&
      sameTarget(d.thread, c.thread) &&
      now - Date.parse(d.dueAt) > UNSENT_MS,
  );
  const base = held
    ? ({ kind: "unsent", since: held.createdAt, message: held.message } as const)
    : isPausedMidTurn(c)
      ? ({ kind: "paused", since: c.stateAt ?? c.at } as const)
      : isStuck(c, now)
        ? ({ kind: "stuck", since: c.at } as const)
        : null;
  if (!base) return null;
  const issue = healthIssues(home).find(
    (i) => (i.id === "plan" || i.id === "credits") && i.tone === "bad" && i.href,
  );
  return issue
    ? {
        ...base,
        blocked: {
          text: issue.text,
          label: issue.id === "credits" ? "Raise the limit" : "Fix your plan",
          href: issue.href!,
        },
      }
    : base;
}

/** A time of day, with the date unless it's today: "6:27 PM", "Oct 23, 6:27 PM". */
export function clockAt(iso: string, now: number): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return at.toDateString() === new Date(now).toDateString()
    ? time
    : `${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

export interface ThreadCardView {
  readonly tone: "quiet" | "attention" | "problem";
  readonly dot: "working" | "quiet" | "done" | "attention" | "problem";
  /** Its state and how long: "Paused mid-turn · 2 h". */
  readonly status: string;
  /** What happened and what's asked of the user; null: its last words, if it has any. */
  readonly body: string | null;
  /** The user's own message that hasn't reached it. */
  readonly quote?: string;
  /** The one thing to do. */
  readonly action: "continue" | "show" | "ask" | "fix" | null;
}

const ASKS: Partial<Record<ReturnType<typeof needsYouKind> & string, string>> = {
  question: "Question",
  approval: "Approval",
  handoff: "Needs you in its browser",
  plan: "Plan to approve",
  waiting: "Waiting on you",
};

/** A thread's card, as the home read has it. */
export function threadCardOf(
  home: Pick<AldoHome, "upcoming" | "usage" | "health">,
  c: AldoHomeConversation,
  now: number,
): ThreadCardView {
  const since = c.stateAt ?? c.at;
  const stalled = stalledOf(home, c, now);
  if (stalled) {
    const when = clockAt(stalled.since, now);
    const status = {
      paused: `Paused mid-turn · ${elapsed(stalled.since, now)}`,
      stuck: `No progress for ${elapsed(stalled.since, now)}`,
      unsent: `Your reply didn't start · ${elapsed(stalled.since, now)}`,
    }[stalled.kind];
    const body = stalled.blocked
      ? `${stalled.blocked.text} It can carry on once that's fixed.`
      : {
          paused: `Its computer went to sleep at ${when}, partway through a turn. Nothing is needed from you except whether to carry on.`,
          stuck: `Its computer is on, but it hasn't moved since ${when}. Nothing is needed from you except whether to nudge it.`,
          unsent: "It hasn't reached the agent. Nothing else is needed from you.",
        }[stalled.kind];
    return {
      tone: "attention",
      dot: "attention",
      status,
      body,
      ...(stalled.message ? { quote: stalled.message } : {}),
      action: stalled.blocked ? "fix" : "continue",
    };
  }
  const kind = needsYouKind(c);
  if (kind === "failed")
    return {
      tone: "problem",
      dot: "problem",
      status: `${NEEDS_YOU_LABEL.failed} · ${elapsed(c.at, now)}`,
      body: null,
      action: "ask",
    };
  if (kind)
    return {
      tone: "attention",
      dot: "attention",
      status: `${ASKS[kind] ?? NEEDS_YOU_LABEL[kind]} · ${elapsed(c.at, now)}`,
      body: null,
      action: "show",
    };
  const routine = c.routine ? "Routine run · " : "";
  switch (c.state) {
    case "starting":
      return {
        tone: "quiet",
        dot: "working",
        status: `${routine}Starting its computer`,
        body: null,
        action: null,
      };
    case "queued": {
      const { running, limit } = home.usage.agents;
      return {
        tone: "quiet",
        dot: "quiet",
        status: `${routine}Waiting for room`,
        body:
          limit === null
            ? "Your plan has no room for another agent right now. It starts as soon as one finishes."
            : `Your plan runs ${limit} agent${limit === 1 ? "" : "s"} at once and ${running === 1 ? "1 is" : `${running} are`} busy. It starts as soon as one finishes.`,
        action: null,
      };
    }
    case "retrying":
      return {
        tone: "quiet",
        dot: "working",
        status: `${routine}Taking longer than usual. Retrying.`,
        body: null,
        action: null,
      };
    case "working":
      return {
        tone: "quiet",
        dot: "working",
        status:
          Date.parse(since) > now - 60_000
            ? `${routine}${c.browsing ? "Working in the browser" : "Working"}`
            : `${routine}${c.browsing ? "Working in the browser" : "Working"} · ${elapsed(since, now)}`,
        body: null,
        action: null,
      };
    case "done":
      return {
        tone: "quiet",
        dot: "done",
        status: `${routine}Finished ${relativeTime(c.at, now)}`,
        body: null,
        action: null,
      };
    case "new":
      return { tone: "quiet", dot: "quiet", status: "Not started", body: null, action: null };
    case "unavailable":
      return {
        tone: "quiet",
        dot: "quiet",
        status: "History only",
        body: "Its model has been retired, so it can't carry on. You can still read it.",
        action: null,
      };
    default:
      return { tone: "quiet", dot: "quiet", status: "Idle", body: null, action: null };
  }
}
