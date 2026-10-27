// Home views, decisions, routines and their actions.

import { type AldoPullRequestStage, type AldoCheckCounts } from "./pullRequests.logic";
import { type AldoMachinePressure } from "./directory";
import { ALDO_READ_ANSWERS_WITHIN_MS, api, AldoApiError, threadIdForEnvironment } from "./api";

// ---------------------------------------------------------------------------
// The home screen: the user's agents' work in one read (Aldo's src/lib/home.ts)

export interface AldoHomeTarget {
  readonly environmentId: string;
  readonly threadId: string;
}

/** What a conversation is waiting on the user for, with its choices. */
export type AldoHomePending =
  | {
      readonly kind: "question";
      readonly requestId: string;
      readonly questions: ReadonlyArray<{
        readonly id: string;
        readonly header: string;
        readonly question: string;
        readonly options: ReadonlyArray<{ readonly label: string; readonly description: string }>;
        readonly multiSelect: boolean;
      }>;
    }
  | {
      readonly kind: "approval";
      readonly requestId: string;
      readonly summary: string;
      readonly detail?: string;
      readonly options: ReadonlyArray<{ readonly decision: string; readonly label: string }>;
    }
  | {
      /** What only the user can get past in its browser: its card is the handoff `requestId` in `handoffs`. */
      readonly kind: "handoff";
      readonly requestId: string;
      readonly summary: string;
    };

export interface AldoChatDecision {
  readonly id: string;
  readonly dismissed: boolean;
  /**
   * When one the user put off ("Not now") comes back, while it's put off;
   * null otherwise. Absent from an Aldo that can't put things off.
   */
  readonly until?: string | null;
  /** It's back from being put off. */
  readonly back?: boolean;
  /**
   * Dismissed from Needs you (it's also `dismissed`): it no longer counts anywhere and is
   * listed under Dismissed to restore. Absent from an Aldo that can't dismiss.
   */
  readonly cleared?: boolean;
}

export interface AldoHomeConversation {
  readonly chatDecision?: AldoChatDecision;
  readonly ref: string;
  readonly thread: AldoHomeTarget;
  readonly title: string;
  readonly repos: ReadonlyArray<string>;
  readonly branch: string;
  /** working, waiting, done, failed; starting, queued, retrying; new (nothing sent yet). */
  readonly state: string;
  /** What it last said, asked or failed with. */
  readonly summary?: string;
  /** Its machine: running, asleep, not created, failed. */
  readonly machine: string;
  readonly machineSizing?: "automatic";
  readonly model?: string;
  readonly at: string;
  /** When its machine last reported its state: `at` moves with its list's changes too (a rename, a pin). */
  readonly stateAt?: string;
  /** When it started: it was created, or its routine's latest run began (a newer Aldo). */
  readonly startedAt?: string;
  readonly pullRequests?: ReadonlyArray<{
    readonly repo: string;
    readonly number: number;
    readonly title: string;
    readonly stage: AldoPullRequestStage;
    readonly url: string;
  }>;
  readonly pending?: AldoHomePending;
  readonly plan?: { readonly id: string; readonly text: string };
  /** Computers requested by this conversation (older Aldo reads may omit the request time). */
  readonly computers?: ReadonlyArray<{
    readonly computer: string;
    readonly status: string;
    readonly why?: string;
    readonly askedAt?: string;
    readonly creditsPerHour: number;
  }>;
  readonly approvedPlan?: { readonly id: string; readonly at: string };
  readonly pressure?: AldoMachinePressure | null;
  /** The site its agent is working on in the browser, while it works there (a newer Aldo). */
  readonly browsing?: { readonly site: string; readonly at: string } | null;
  /** Snoozed until then (only while that's ahead), or settled: put away in the user's list. */
  readonly snoozedUntil?: string;
  readonly settled?: true;
  /** The routine whose run it is: each run is a conversation of its own (a newer Aldo). */
  readonly routine?: string;
}

export interface AldoHomePullRequest {
  readonly chatDecision?: AldoChatDecision;
  readonly environmentId: string;
  readonly thread: AldoHomeTarget | null;
  readonly threadTitle: string;
  readonly repo: string;
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly status: "watching" | "merged" | "closed" | "stopped";
  readonly stage: AldoPullRequestStage;
  readonly checks: AldoCheckCounts | null;
  readonly deploy: AldoCheckCounts | null;
  readonly followups: number;
  readonly reviewsExhausted: boolean;
  readonly greenSince: string | null;
  /** When Aldo merges it on its own, if nothing changes (the workspace's policy says so). */
  readonly mergesAt: string | null;
  readonly mergedAt: string | null;
  readonly updatedAt: string;
  /** The conversation checking it's live once it merged (a newer Aldo). */
  readonly check?: AldoHomeTarget;
}

export interface AldoHomeDelivery {
  readonly id: string;
  readonly kind: "reminder" | "message" | "notice" | "routine";
  readonly thread: AldoHomeTarget;
  readonly threadTitle: string;
  readonly message: string;
  readonly dueAt: string;
  readonly createdAt: string;
  /** Due, but its thread couldn't take it yet. */
  readonly held: boolean;
}

export interface AldoHomeAction {
  readonly id: string;
  readonly tool: string;
  readonly title: string | null;
  readonly asked: string;
  readonly failed: boolean;
  readonly error: string | null;
  readonly thread: AldoHomeTarget | null;
  readonly at: string;
  /** It undid what its tool's name says (unpinned, unsnoozed, unsettled); an older Aldo doesn't say. */
  readonly reverse?: boolean;
}

export interface AldoHomeUsage {
  readonly configured: boolean;
  readonly metered: boolean;
  readonly plan: {
    readonly id: string;
    readonly name: string;
    readonly includedCredits: number;
  } | null;
  readonly period: { readonly status: string; readonly start: string; readonly end: string } | null;
  readonly credits: {
    readonly used: number;
    readonly included: number;
    readonly authorized: number;
    readonly remaining: number;
    readonly projected: number | null;
  } | null;
  readonly bill: {
    readonly estimatedCents: number;
    readonly projectedCents: number | null;
    readonly spendLimitCents: number;
  } | null;
  readonly alert: string;
  readonly agents: { readonly running: number; readonly limit: number | null };
}

export interface AldoPolicy {
  readonly merge?: "auto" | "approve";
  readonly mergeMethod?: Record<string, string>;
  readonly spendThreshold?: number;
  readonly reviews?: "all" | "important";
  readonly onProviderLimit?: "wait" | "switch";
  readonly modelRouting?: { readonly paidFallback?: "never" | "authorized" };
  readonly contextBudget?: number;
  readonly mediaRouting?: "auto" | "ask";
  /** A kind of media's tool, in the user's words; null clears the user's own for a workspace. */
  readonly mediaDefaults?: Readonly<Record<string, string | null>>;
  /** Accounts in your name: sign up when asked (the default), ask first, or never and write the steps. */
  readonly accounts?: "when_asked" | "ask_first" | "never";
  /** Publishing for you: publish when asked (the default), or show each one first. */
  readonly publishing?: "when_asked" | "show_first";
}

/**
 * What the user decided agents may do (Settings → Permissions): their own
 * answers, and each workspace's that are its own (a workspace's answer is
 * used over theirs), with every repository they've worked in.
 */
export interface AldoPolicyView {
  readonly everywhere: AldoPolicy;
  readonly workspaces: ReadonlyArray<{
    readonly repos: ReadonlyArray<string>;
    readonly policy: AldoPolicy;
  }>;
  readonly repos: ReadonlyArray<string>;
  /** The rules this Aldo takes (its policy's keys); an older one doesn't say, and has none of the newer rules. */
  readonly rules?: ReadonlyArray<string>;
}

/** A rule to clear (["merge"]), or one entry of a rule kept by repository or kind of media. */
export type AldoPolicyPath = readonly [string] | readonly [string, string];

function isPolicyView(value: unknown): value is AldoPolicyView {
  const view = value as Partial<AldoPolicyView> | null;
  return (
    view !== null &&
    typeof view === "object" &&
    typeof view.everywhere === "object" &&
    view.everywhere !== null &&
    Array.isArray(view.workspaces) &&
    Array.isArray(view.repos)
  );
}

/** Which rules Aldo takes is said only by a list of their names; anything else says nothing. */
function withRules(view: AldoPolicyView): AldoPolicyView {
  const { rules, ...rest } = view;
  return Array.isArray(rules) && rules.every((rule) => typeof rule === "string") ? view : rest;
}

/** The user's rules for agents, or null from an Aldo that doesn't let them be edited here. */
export async function fetchAldoPolicy(): Promise<AldoPolicyView | null> {
  const body = await api<unknown>("/api/policy").catch((error: unknown) => {
    if (error instanceof AldoApiError && error.status === 404) return null;
    throw error;
  });
  // An older Aldo may answer with the web client's page instead of a 404.
  return isPolicyView(body) ? withRules(body) : null;
}

/**
 * Changes the user's own rules (no `repos`) or one workspace's: `clear` runs
 * first, so a rule cleared there is asked again, or follows the user's own.
 */
export async function editAldoPolicy(edit: {
  readonly repos?: ReadonlyArray<string>;
  readonly set?: AldoPolicy;
  readonly clear?: ReadonlyArray<AldoPolicyPath>;
}): Promise<AldoPolicyView> {
  const body = await api<unknown>("/api/policy", { method: "PATCH", body: JSON.stringify(edit) });
  if (!isPolicyView(body)) throw new Error("Aldo didn't say what the rules are now.");
  return withRules(body);
}

// ---------------------------------------------------------------------------
// Routines: standing instructions that run in a thread of their own on a
// schedule (in the user's time zone) or when their webhook is called.

export type AldoWeekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface AldoRoutineSchedule {
  readonly every: "day" | "weekdays" | "week" | "month" | "hours";
  /** Times of day, HH:MM (24-hour). */
  readonly at?: ReadonlyArray<string>;
  readonly days?: ReadonlyArray<AldoWeekday>;
  readonly day?: number;
  readonly hours?: number;
}

export interface AldoRoutine {
  readonly id: string;
  readonly title: string;
  readonly instruction: string;
  readonly schedule: AldoRoutineSchedule | null;
  /** When it runs, in words ("Weekdays at 07:00 (America/New_York)"). */
  readonly when: string;
  readonly timeZone: string;
  readonly repos: ReadonlyArray<string>;
  readonly enabled: boolean;
  /** Its webhook URL, when it has one: anything POSTed to it runs the routine. */
  readonly webhook: string | null;
  readonly nextRunAt: string | null;
  readonly lastRunAt: string | null;
  readonly lastResult: string | null;
  readonly createdBy: "user" | "aldo" | "agent";
  /** The thread its runs go to, once there is one. */
  readonly thread: AldoHomeTarget | null;
}

export interface AldoRoutineInput {
  readonly title?: string;
  readonly instruction?: string;
  readonly schedule?: AldoRoutineSchedule | null;
  readonly webhook?: boolean;
  readonly enabled?: boolean;
}

export async function createAldoRoutine(input: AldoRoutineInput): Promise<AldoRoutine> {
  const { routine } = await api<{ routine: AldoRoutine }>("/api/routines", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return routine;
}

export async function updateAldoRoutine(id: string, input: AldoRoutineInput): Promise<AldoRoutine> {
  const { routine } = await api<{ routine: AldoRoutine }>(
    `/api/routines/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return routine;
}

export async function deleteAldoRoutine(id: string): Promise<void> {
  await api(`/api/routines/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Runs a routine now; says how it went ("started a thread for it", "skipped: ..."). */
export async function runAldoRoutine(id: string): Promise<string> {
  const { result } = await api<{ result: string }>(`/api/routines/${encodeURIComponent(id)}/run`, {
    method: "POST",
  });
  return result;
}

// ---------------------------------------------------------------------------
// Approvals: what waits on the user's one tap. An email an agent drafted in
// their mail (sent as it stands), an event for their calendar, or a thread
// Aldo suggests in a heads-up: Aldo does it when they approve. Or a step an
// agent takes itself once they say yes (`confirm`: paying, booking,
// cancelling, submitting, calling), with where, the total and the terms.

export type AldoApprovalStatus =
  | "pending"
  | "sending"
  | "approved"
  | "discarded"
  | "expired"
  | "withdrawn";

export interface AldoApproval {
  readonly chatDecision?: AldoChatDecision;
  readonly id: string;
  readonly kind: "email" | "event" | "start" | "confirm";
  readonly provider: "google" | "microsoft" | null;
  readonly title: string;
  /** One line: who it's to, or when. */
  readonly summary: string;
  /** What it is in full, labeled: To, Cc, Bcc, Attached; When, Invites, Where; Where, Total, Terms. */
  readonly fields: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  /** The email's text, the event's description, or what the thread would be asked. */
  readonly body: string;
  /**
   * An email Aldo rewrote for the user while it waits (an Aldo that rewrites
   * drafts): what it said before, and when it was rewritten. What's new is
   * underlined (diff.logic.ts), while its card keeps its original place in the conversation.
   */
  readonly previous?: { readonly title: string; readonly body: string };
  readonly revisedAt?: string;
  readonly approveLabel: string;
  readonly discardLabel: string;
  readonly status: AldoApprovalStatus;
  /** What was done, or why the last try failed (`failed`) while it waits. */
  readonly result: string | null;
  readonly failed: boolean;
  readonly thread: AldoHomeTarget | null;
  readonly threadTitle: string | null;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  /**
   * The rule "Always allow" would make of it, in plain words ("Agents can send
   * email to alex@example.com without asking"): only an email to a few named
   * people or an event with no guests, and only from an Aldo that has rules.
   */
  readonly always?: string;
}

/** A rule the user made with "Always allow": agents do what it covers exactly without asking. */
export interface AldoApprovalRule {
  readonly id: string;
  readonly kind: "email" | "event";
  readonly text: string;
  readonly createdAt: string;
}

/**
 * Approves or discards one; says what was done. Aldo refuses (409) an email
 * whose draft changed since it was shown. `always` approves it and saves its
 * rule (`rule`, when that worked).
 */
export async function decideAldoApproval(
  id: string,
  decision: "approve" | "discard" | "always",
): Promise<{
  readonly approval: Omit<AldoApproval, "threadTitle">;
  readonly message: string;
  readonly rule?: { readonly id: string; readonly text: string };
}> {
  return api(`/api/approvals/${encodeURIComponent(id)}`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}

/** The user's "Always allow" rules, oldest first; null where this Aldo has none. */
export async function fetchAldoApprovalRules(): Promise<ReadonlyArray<AldoApprovalRule> | null> {
  try {
    const { rules } = await api<{ rules?: ReadonlyArray<AldoApprovalRule> }>("/api/approval-rules");
    return Array.isArray(rules) ? rules : null;
  } catch (cause) {
    if (cause instanceof AldoApiError && cause.status === 404) return null;
    throw cause;
  }
}

/** Removes a rule (Undo, or the list of them): agents ask again from now on. */
export async function removeAldoApprovalRule(id: string): Promise<void> {
  await api(`/api/approval-rules/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Payments: an agent at a checkout asked to pay from the user's Link wallet.
// The user approves or declines it in Link (Aldo can't); approved, the agent
// types its one-time card into the checkout. Never the card here: only its
// last four digits.

export interface AldoPayment {
  readonly id: string;
  readonly merchant: string;
  /** The merchant's site, where the card works. */
  readonly site: string;
  /** "$35.00". */
  readonly total: string;
  readonly items: ReadonlyArray<{
    readonly name: string;
    readonly quantity: number | null;
    readonly price: string | null;
  }>;
  /** What the agent told Link it's buying, from whom and why. */
  readonly context: string;
  /**
   * Link's status: created, pending_approval, requires_action, approved,
   * submitted, succeeded, failed, denied, expired, canceled; or Aldo's own
   * disconnected; maybe more later.
   */
  readonly status: string;
  /** Link's page to approve or decline it, while it waits on the user. */
  readonly approvalUrl: string | null;
  /** When Link stops waiting for them, while it does. */
  readonly expiresAt: string | null;
  readonly cardLast4: string | null;
  readonly test: boolean;
  readonly thread: AldoHomeTarget | null;
  readonly threadTitle: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AldoHome {
  readonly at: string;
  readonly conversations: ReadonlyArray<AldoHomeConversation>;
  readonly pullRequests: ReadonlyArray<AldoHomePullRequest>;
  readonly upcoming: ReadonlyArray<AldoHomeDelivery>;
  /** What waits on the user's tap, then what they decided in the last day (an older Aldo leaves them out). */
  readonly approvals?: ReadonlyArray<AldoApproval>;
  /** The user's routines (an older Aldo leaves them out). */
  readonly routines?: ReadonlyArray<AldoRoutine>;
  /** What only the user can get past in an agent's browser, open now, newest first (a newer Aldo). */
  readonly handoffs?: ReadonlyArray<AldoHandoff>;
  /** Payments agents asked for from the user's Link wallet in the last day, newest first (a newer Aldo). */
  readonly payments?: ReadonlyArray<AldoPayment>;
  /** Plans Aldo proposed before big work, open and lately started (a newer Aldo; read with parseAldoPlans). */
  readonly plans?: unknown;
  readonly actions: ReadonlyArray<AldoHomeAction>;
  readonly usage: AldoHomeUsage;
  readonly spends: {
    readonly once: number;
    readonly monthly: number;
    readonly recent: ReadonlyArray<{
      readonly id: string;
      readonly what: string;
      readonly amount: number;
      readonly monthly: boolean;
      readonly approvedByUser: boolean;
      readonly stopped: boolean;
      readonly at: string;
    }>;
  };
  readonly health: {
    readonly providers: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly signedIn: boolean;
    }>;
    readonly connected: ReadonlyArray<string>;
    readonly environments: ReadonlyArray<{
      readonly repos: ReadonlyArray<string>;
      readonly status: "ready" | "building" | "failed" | "none";
      readonly at: string;
    }>;
  };
  readonly policy: {
    readonly everywhere: AldoPolicy;
    readonly workspaces: ReadonlyArray<{
      readonly repos: ReadonlyArray<string>;
      readonly policy: AldoPolicy;
    }>;
  };
}

// ---------------------------------------------------------------------------
// Handoffs: an agent in its browser met what only the user can get past (a
// captcha, a sign-in, a code sent to them, a number to match, a tap on
// another device, an ID check, payout details) and asked them. They do it in its browser and hand it back,
// type the code for Aldo to put in the page, or skip it.

export interface AldoHandoff {
  readonly id: string;
  /** captcha, sign_in, code, number_match, approve_on_device, identity, payout, other; maybe more later. */
  readonly kind: string;
  /** Why, as the agent put it ("OpenTable wants to check you're human"). */
  readonly reason: string;
  /** What to do, in a sentence, when the agent said ("Tick the box, then hand it back"). */
  readonly how: string | null;
  readonly site: string | null;
  readonly url: string | null;
  /** How long it usually takes, when the agent knew. */
  readonly seconds: number | null;
  /**
   * The site's own link to do it on a phone (an ID check or selfie's "continue
   * on your phone"), when the agent gave one; an older Aldo sends none.
   */
  readonly phoneUrl?: string | null;
  readonly thread: AldoHomeTarget;
  readonly threadTitle: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/**
 * The user's answer to a handoff: done (they got it past the check), skip, or
 * a code for Aldo to type into the page's focused field (never kept). Says
 * what happened; a code that couldn't be typed is refused (409, 502) saying
 * what to do instead, and the handoff stays open.
 */
export async function resolveAldoHandoff(
  id: string,
  answer:
    | { readonly decision: "done" | "skip" }
    | { readonly decision: "code"; readonly code: string },
): Promise<{ readonly outcome: string; readonly message: string }> {
  return api(`/api/handoffs/${encodeURIComponent(id)}`, {
    method: "POST",
    body: JSON.stringify(answer),
  });
}

/** The home screen's read; null where this Aldo doesn't have it (an older one answers with the web client's own page). */
/**
 * Aldo's read of the user's work. `active`: the page is in use (focus.ts), so
 * Aldo knows they're in it and holds back what they'd see here from their phone.
 */
export async function fetchAldoHome(
  options: { readonly active?: boolean } = {},
): Promise<AldoHome | null> {
  const body = await api<Partial<AldoHome>>("/api/home", {
    ...(options.active ? { headers: { "x-aldo-active": "1" } } : {}),
    answersWithin: ALDO_READ_ANSWERS_WITHIN_MS,
  });
  return Array.isArray(body.conversations) ? (body as AldoHome) : null;
}

/**
 * A POST that outlives the page: an answer's card is gone the moment it's
 * sent, so leaving or closing the app mustn't cancel it (the browser finishes
 * it, if it fits what it lets one carry).
 */
const postedKept = (body: unknown): RequestInit => {
  const json = JSON.stringify(body);
  return { method: "POST", body: json, keepalive: json.length < 20_000 };
};

/**
 * Answers the question or approval a conversation is waiting on, as the
 * user. `requestId` is the one the page showed: Aldo refuses (409) if the
 * thread has moved on to another. Says what happened.
 */
export async function answerAldoThread(
  target: AldoHomeTarget,
  answer: {
    readonly requestId: string;
    readonly answers?: Record<string, string | ReadonlyArray<string>>;
    readonly text?: string;
    readonly decision?: string;
  },
): Promise<string> {
  const { status } = await api<{ status: string }>(
    `/api/environments/${threadIdForEnvironment(target.environmentId)}/actions`,
    postedKept({ action: "answer", t3ThreadId: target.threadId, ...answer }),
  );
  return status;
}

/**
 * Has the agent carry out the plan it proposed (`planId`, the one the page
 * showed; refused if it proposes another now), or, with changes, asks for a
 * revised one.
 */

export async function approveAldoPlan(
  target: AldoHomeTarget,
  planId: string,
  changes?: string,
): Promise<string> {
  const { status } = await api<{ status: string }>(
    `/api/environments/${threadIdForEnvironment(target.environmentId)}/actions`,
    postedKept({ action: "approve_plan", t3ThreadId: target.threadId, planId, changes }),
  );
  return status;
}

/**
 * Carries on a thread that paused or stalled: its computer wakes and its agent
 * picks up where it stopped (or gets the message of the user's it was holding).
 * Refused (409) if the thread isn't paused, as Aldo reads it now.
 */
export async function continueAldoThread(target: AldoHomeTarget): Promise<string> {
  const { status } = await api<{ status: string }>(
    `/api/environments/${threadIdForEnvironment(target.environmentId)}/actions`,
    postedKept({ action: "continue", t3ThreadId: target.threadId }),
  );
  return status;
}

/** A thread's latest turns as Aldo keeps them (its last three: the messages, and what it waits on). */
export interface AldoConversationCopy {
  readonly state: string;
  readonly messages: ReadonlyArray<{
    readonly role: string;
    readonly text: string;
    readonly createdAt: string;
  }>;
}

/**
 * A thread's latest turns, from its machine while it runs, else Aldo's copy,
 * without waking it; null where Aldo has no copy yet (or can't say).
 */
export async function fetchAldoConversationCopy(
  target: AldoHomeTarget,
): Promise<AldoConversationCopy | null> {
  const path = `/api/environments/${threadIdForEnvironment(target.environmentId)}/conversation?t3ThreadId=${encodeURIComponent(target.threadId)}`;
  const body = await api<{ conversation?: Partial<AldoConversationCopy> }>(path).catch(
    (error: unknown) => {
      if (error instanceof AldoApiError && error.status === 404) return null;
      throw error;
    },
  );
  const copy = body?.conversation;
  return copy && Array.isArray(copy.messages)
    ? { state: typeof copy.state === "string" ? copy.state : "", messages: copy.messages }
    : null;
}

/** Sends a waiting delivery (a reminder, a message) now rather than when it's due. */
export async function sendAldoDeliveryNow(id: string): Promise<void> {
  await api(`/api/deliveries/${encodeURIComponent(id)}`, { method: "POST" });
}

/** Cancels a waiting delivery: it's never sent. */
export async function cancelAldoDelivery(id: string): Promise<void> {
  await api(`/api/deliveries/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Dismisses what waits in Needs you (or restores it, `cleared: false`): nothing is answered; the thread keeps waiting. */
export async function clearAldoDecisions(
  ids: ReadonlyArray<string>,
  cleared = true,
): Promise<void> {
  await api("/api/assistant/decisions/clear", {
    method: "POST",
    body: JSON.stringify({ ids, cleared }),
  });
}

/** Hides or restores only the home-chat prompt; the thread keeps waiting. With `until`, puts it off until then ("Not now"). */
export async function dismissAldoChatDecision(
  id: string,
  dismissed = true,
  until?: Date,
): Promise<void> {
  await api("/api/assistant/decisions/dismiss", {
    method: "POST",
    body: JSON.stringify({ id, dismissed, ...(until ? { until: until.toISOString() } : {}) }),
  });
}
