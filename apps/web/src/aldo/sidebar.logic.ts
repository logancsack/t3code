// The parts of Aldo's sidebar (AldoSidebar.tsx) that don't touch the page:
// which group each thread is in, by what it needs from the user rather than
// by project (waiting on you, working, landing, unread, earlier), what its
// one line says, and the order the thread shortcuts move through. A thread's
// state comes from its shell (T3's own status, unread and snooze rules) with
// what Aldo's home read adds: what it asks, its pull requests, its summary,
// and what isn't a thread at all (approvals, routines, reminders). As in T3's
// sidebar, snoozed outranks settled, and settled outranks pinned: a thread the
// user settled is with the earlier ones, whatever it last asked. Also as there,
// a thread counts as settled or snoozed only on a machine known to support it,
// whose menu can make it active or wake it again.

import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";

import {
  hasUnseenCompletion,
  resolveSidebarThreadStatus,
  resolveWorkingStartedAt,
  sortPinnedThreadsForSidebar,
} from "../components/Sidebar.logic";
import { waitingApprovals } from "./approvals.logic";
import type {
  AldoApproval,
  AldoHome,
  AldoHomeConversation,
  AldoHomeDelivery,
  AldoHomePullRequest,
  AldoRoutine,
} from "./cloud";
import { modelName, sameTarget, WORKING_STATES } from "./home.logic";
import { aldoStartReason } from "./threadStart.logic";

/** What a thread is doing, as its row shows it. */
export type AldoSidebarKind =
  | "approval"
  | "question"
  | "plan"
  | "failed"
  | "waiting"
  | "merge"
  | "working"
  | "monitoring"
  | "starting"
  | "landing"
  | "unread"
  | "done";

const WAITING_KINDS: ReadonlySet<AldoSidebarKind> = new Set([
  "approval",
  "question",
  "plan",
  "failed",
  "waiting",
  "merge",
]);
const WORKING_KINDS: ReadonlySet<AldoSidebarKind> = new Set(["working", "monitoring", "starting"]);

export interface AldoSidebarRow {
  /** The thread's scoped key (environment and T3 thread), as T3's stores key it. */
  readonly key: string;
  readonly shell: EnvironmentThreadShell;
  readonly kind: AldoSidebarKind;
  /** Its one line: what it asks, what it's doing, or what it last said. */
  readonly detail: string;
  readonly repo: string;
  /** When it got to where it is, for the row's time. */
  readonly at: string;
  /** How far along its plan is (0 to 1), while it has one. */
  readonly progress: number | null;
  readonly unread: boolean;
  readonly conversation: AldoHomeConversation | null;
  /** The pull request it's about: the one ready to merge, or landing. */
  readonly pullRequest: AldoHomePullRequest | null;
}

export type AldoScheduledItem =
  | { readonly kind: "routine"; readonly key: string; readonly routine: AldoRoutine }
  | { readonly kind: "delivery"; readonly key: string; readonly delivery: AldoHomeDelivery };

export interface AldoSidebarList {
  readonly pinned: ReadonlyArray<AldoSidebarRow>;
  /** Approvals that aren't a thread's (an email to send, an event to add). */
  readonly approvals: ReadonlyArray<AldoApproval>;
  readonly waiting: ReadonlyArray<AldoSidebarRow>;
  readonly working: ReadonlyArray<AldoSidebarRow>;
  readonly landing: ReadonlyArray<AldoSidebarRow>;
  readonly unread: ReadonlyArray<AldoSidebarRow>;
  readonly earlier: ReadonlyArray<AldoSidebarRow>;
  readonly snoozed: ReadonlyArray<AldoSidebarRow>;
  readonly scheduled: ReadonlyArray<AldoScheduledItem>;
}

export function aldoThreadKey(environmentId: string, threadId: string): string {
  return `${environmentId}:${threadId}`;
}

/** A line of text, at most so long: summaries can run to paragraphs. */
function oneLine(text: string | null | undefined, max = 120): string {
  const line = (text ?? "").replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** What a thread is doing: T3's status first, then what Aldo's read knows. */
export function aldoSidebarKind(input: {
  readonly shell: EnvironmentThreadShell;
  readonly conversation: AldoHomeConversation | null;
  readonly ready: AldoHomePullRequest | null;
  readonly landing: AldoHomePullRequest | null;
  readonly lastVisitedAt: string | undefined;
  /** The user settled it (on a machine that supports settling). */
  readonly settled: boolean;
  readonly now: string;
}): AldoSidebarKind {
  const { shell, conversation: c } = input;
  const status = resolveSidebarThreadStatus(shell);
  // Settled: done with, unless it's running again (T3 unsettles it when it can).
  if (input.settled) {
    if (status === "working" || status === "monitoring") return status;
    return unseen(shell, input.lastVisitedAt, input.now) ? "unread" : "done";
  }
  if (status === "approval" || c?.pending?.kind === "approval") return "approval";
  if (status === "input" || c?.pending?.kind === "question") return "question";
  if (status === "failed" || c?.state === "failed") return "failed";
  // A thread Aldo is starting (or queued, or trying again) shows connecting until its machine has it.
  if (status === "working") {
    return c && c.state !== "working" && WORKING_STATES.has(c.state) ? "starting" : "working";
  }
  if (status === "monitoring") return "monitoring";
  if (c && WORKING_STATES.has(c.state)) return c.state === "working" ? "working" : "starting";
  if (c?.plan || shell.hasActionableProposedPlan) return "plan";
  if (input.ready) return "merge";
  if (input.landing) return "landing";
  if (c?.state === "waiting") return "waiting";
  if (unseen(shell, input.lastVisitedAt, input.now)) return "unread";
  return "done";
}

/** How long a thread the user never opened (on this device) counts as news once it's done. */
const UNSEEN_WITHOUT_VISIT_MS = 24 * 60 * 60 * 1000;

/**
 * Finished since the user last looked: T3's rule once they've opened it; a
 * thread never opened here (one Aldo started for them, say) is news for a day
 * after it finished, so a new device isn't all unread.
 */
function unseen(
  shell: EnvironmentThreadShell,
  lastVisitedAt: string | undefined,
  now: string,
): boolean {
  if (lastVisitedAt) return hasUnseenCompletion({ ...shell, lastVisitedAt });
  const completedAt = Date.parse(shell.latestTurn?.completedAt ?? "");
  return !Number.isNaN(completedAt) && Date.parse(now) - completedAt < UNSEEN_WITHOUT_VISIT_MS;
}

function detailFor(
  kind: AldoSidebarKind,
  shell: EnvironmentThreadShell,
  c: AldoHomeConversation | null,
  pr: AldoHomePullRequest | null,
): string {
  const summary = oneLine(c?.summary);
  switch (kind) {
    case "approval":
      return (
        oneLine(c?.pending?.kind === "approval" ? c.pending.summary : "") || "Waiting for your OK"
      );
    case "question":
      return (
        oneLine(c?.pending?.kind === "question" ? c.pending.questions[0]?.question : "") ||
        summary ||
        "Asks you"
      );
    case "plan":
      return "Plan to approve";
    case "failed":
      return summary ? `Failed: ${summary}` : "Stopped with an error";
    case "waiting":
      return summary || "Waiting on you";
    case "merge":
      return pr ? `#${pr.number} ready to merge` : "Ready to merge";
    case "landing":
      return pr ? `#${pr.number} merged · deploying` : "Merged · deploying";
    case "working":
    case "monitoring": {
      const model = modelName(c?.model);
      return (
        oneLine(shell.planProgress?.step) ||
        `${kind === "monitoring" ? "Watching" : "Working"}${model ? ` · ${model}` : ""}`
      );
    }
    case "starting": {
      const stage =
        c?.state === "queued" ? "Queued" : c?.state === "retrying" ? "Retrying" : "Starting";
      // Aldo tries again on its own: the refusal's advice to try again isn't the user's.
      const reason = aldoStartReason(summary);
      return reason ? `${stage}: ${reason}` : stage;
    }
    case "unread":
    case "done":
      return summary || "Done";
  }
}

const byAtAsc = (a: AldoSidebarRow, b: AldoSidebarRow) => a.at.localeCompare(b.at);
const byAtDesc = (a: AldoSidebarRow, b: AldoSidebarRow) => b.at.localeCompare(a.at);

/** Every thread in its group, and what isn't a thread, for the sidebar. */
export function aldoSidebarList(input: {
  readonly shells: ReadonlyArray<EnvironmentThreadShell>;
  readonly home: AldoHome | null;
  readonly lastVisitedAt: (key: string) => string | undefined;
  readonly repoOf: (shell: EnvironmentThreadShell) => string;
  /** Narrows threads to a project (approvals and what's scheduled stay). */
  readonly inScope?: (shell: EnvironmentThreadShell) => boolean;
  /** Whether the thread's machine takes settling and snoozing (both, when not given). */
  readonly supports?: (shell: EnvironmentThreadShell) => {
    readonly settlement: boolean;
    readonly snooze: boolean;
  };
  readonly now: string;
}): AldoSidebarList {
  const { home } = input;
  const pinned: EnvironmentThreadShell[] = [];
  const rows: AldoSidebarRow[] = [];
  const snoozed: AldoSidebarRow[] = [];
  const settledRows: AldoSidebarRow[] = [];
  const pinnedKeys = new Set<string>();
  for (const shell of input.shells) {
    if (shell.archivedAt !== null) continue;
    if (input.inScope && !input.inScope(shell)) continue;
    const key = aldoThreadKey(shell.environmentId, shell.id);
    const target = { environmentId: shell.environmentId, threadId: shell.id };
    const conversation = home?.conversations.find((c) => sameTarget(c.thread, target)) ?? null;
    const prs = home?.pullRequests.filter((pr) => sameTarget(pr.thread, target)) ?? [];
    // Ready for the user to merge: green, and not one Aldo merges on its own (mergesAt).
    const ready =
      prs.find((pr) => pr.status === "watching" && pr.stage === "green" && pr.mergesAt === null) ??
      null;
    const landing =
      prs.find((pr) => pr.stage === "deploying" || pr.stage === "deploy-failed") ?? null;
    const lastVisitedAt = input.lastVisitedAt(key);
    const supports = input.supports?.(shell) ?? { settlement: true, snooze: true };
    const settled = supports.settlement && shell.settledOverride === "settled";
    const kind = aldoSidebarKind({
      shell,
      conversation,
      ready,
      landing,
      lastVisitedAt,
      settled,
      now: input.now,
    });
    const pullRequest = kind === "merge" ? ready : kind === "landing" ? landing : null;
    const progress =
      shell.planProgress && shell.planProgress.totalSteps > 0
        ? Math.min(1, shell.planProgress.completedSteps / shell.planProgress.totalSteps)
        : null;
    const row: AldoSidebarRow = {
      key,
      shell,
      kind,
      detail: detailFor(kind, shell, conversation, pullRequest),
      repo: input.repoOf(shell),
      // Working: since its turn began; otherwise when it last moved.
      at:
        (WORKING_KINDS.has(kind) ? resolveWorkingStartedAt(shell) : null) ??
        (conversation && conversation.at > shell.updatedAt ? conversation.at : shell.updatedAt),
      progress: WORKING_KINDS.has(kind) ? progress : null,
      unread: kind === "unread",
      conversation,
      pullRequest,
    };
    // Snoozed until it wakes (or raises its hand), then settled, then pinned, as T3 has it.
    if (supports.snooze && effectiveSnoozed(shell, { now: input.now })) snoozed.push(row);
    else if (settled) settledRows.push(row);
    else if (shell.pinnedAt != null) {
      pinned.push(shell);
      pinnedKeys.add(key);
      rows.push(row);
    } else rows.push(row);
  }
  const pinnedOrder = sortPinnedThreadsForSidebar(pinned).map((shell) =>
    aldoThreadKey(shell.environmentId, shell.id),
  );
  const rowByKey = new Map(rows.map((row) => [row.key, row]));
  const loose = rows.filter((row) => !pinnedKeys.has(row.key));
  return {
    pinned: pinnedOrder.flatMap((key) => {
      const row = rowByKey.get(key);
      return row ? [row] : [];
    }),
    approvals: waitingApprovals(home?.approvals),
    // Waited longest first; the rest, what moved last first.
    waiting: loose.filter((row) => WAITING_KINDS.has(row.kind)).toSorted(byAtAsc),
    working: loose.filter((row) => WORKING_KINDS.has(row.kind)).toSorted(byAtDesc),
    landing: loose.filter((row) => row.kind === "landing").toSorted(byAtDesc),
    unread: loose.filter((row) => row.kind === "unread").toSorted(byAtDesc),
    earlier: [...loose.filter((row) => row.kind === "done"), ...settledRows].toSorted(byAtDesc),
    snoozed: snoozed.toSorted((a, b) =>
      (a.shell.snoozedUntil ?? "").localeCompare(b.shell.snoozedUntil ?? ""),
    ),
    scheduled: scheduledItems(home),
  };
}

/** Routines that will run, then what's due to be sent, soonest first. */
function scheduledItems(home: AldoHome | null): ReadonlyArray<AldoScheduledItem> {
  if (!home) return [];
  const routines: AldoScheduledItem[] = (home.routines ?? [])
    .filter((routine) => routine.enabled && routine.nextRunAt)
    .toSorted((a, b) => (a.nextRunAt ?? "").localeCompare(b.nextRunAt ?? ""))
    .map((routine) => ({ kind: "routine", key: `routine:${routine.id}`, routine }));
  const deliveries: AldoScheduledItem[] = home.upcoming
    .toSorted((a, b) => a.dueAt.localeCompare(b.dueAt))
    .map((delivery) => ({ kind: "delivery", key: `delivery:${delivery.id}`, delivery }));
  return [...routines, ...deliveries];
}

/** Threads whose titles have the words, in the order they show. */
export function searchAldoSidebar(
  list: AldoSidebarList,
  query: string,
): ReadonlyArray<AldoSidebarRow> {
  const words = query.trim().toLowerCase();
  if (!words) return [];
  return [
    ...list.pinned,
    ...list.waiting,
    ...list.working,
    ...list.landing,
    ...list.unread,
    ...list.earlier,
    ...list.snoozed,
  ].filter((row) => row.shell.title.toLowerCase().includes(words));
}

/**
 * The threads the shortcuts move through (⌘1–9, previous and next), top to
 * bottom as they show: folded groups count only when open.
 */
export function aldoSidebarOrder(
  list: AldoSidebarList,
  open: { readonly earlier: number; readonly snoozed: boolean },
): ReadonlyArray<string> {
  return [
    ...list.pinned,
    ...list.waiting,
    ...list.working,
    ...list.landing,
    ...list.unread,
    ...list.earlier.slice(0, open.earlier),
    ...(open.snoozed ? list.snoozed : []),
  ].map((row) => row.key);
}

/** A project's label in a word: the repository's name, or General. */
export function repoLabel(name: string | null | undefined): string {
  const value = (name ?? "").trim();
  if (!value || value === "aldo:general" || value.toLowerCase() === "general") return "General";
  return value.split("/").at(-1) ?? value;
}
