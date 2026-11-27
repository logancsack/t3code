// Approvals on the home screen and in the thread that asked (AldoApprovals.tsx):
// which wait on the user, what each asks in words, and how the ones they
// decided lately went. A decision made from either place is held in the shared
// read until Aldo's has caught up, so both show one item in one state.

import type { TimelineEntry } from "../session-logic";
import {
  type AldoApproval,
  type AldoApprovalStatus,
  type AldoHome,
  type AldoHomeTarget,
} from "./homeApi";
import { sameTarget } from "./home.logic";

const DAY = 24 * 60 * 60 * 1000;
const DECIDED_SHOWN = 5;

/** Waiting on the user (or being done right now), oldest first: the first asked is the first to answer. */
export function waitingApprovals(
  approvals: ReadonlyArray<AldoApproval> | undefined,
  withCleared = false,
): ReadonlyArray<AldoApproval> {
  return (approvals ?? [])
    .filter((a) => a.status === "pending" || a.status === "sending")
    .filter((a) => withCleared || !a.chatDecision?.cleared)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** What the user decided in the last day (or what expired), newest first, a few. */
export function decidedLately(
  approvals: ReadonlyArray<AldoApproval> | undefined,
  now: number,
): ReadonlyArray<AldoApproval> {
  return (approvals ?? [])
    .filter(
      (a) =>
        a.status !== "pending" &&
        a.status !== "sending" &&
        a.decidedAt !== null &&
        now - Date.parse(a.decidedAt) < DAY,
    )
    .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))
    .slice(0, DECIDED_SHOWN);
}

/** What one asks, as a question: Send "Re: Thursday"? */
export function approvalQuestion(approval: Pick<AldoApproval, "kind" | "title">): string {
  if (approval.kind === "email") return `Send "${approval.title}"?`;
  if (approval.kind === "event") return `Add "${approval.title}" to your calendar?`;
  // As the agent put the step ("Buy the price sheet."), asked once.
  if (approval.kind === "confirm") return `${approval.title.replace(/[\s.!?…]+$/u, "")}?`;
  return approval.title;
}

/** One way to answer an approval, as its card shows it: what to tap, and what happens then. */
export interface ApprovalChoice {
  readonly decision: "approve" | "always" | "discard";
  readonly label: string;
  /** What happens, in a line under the label. */
  readonly detail: string;
  readonly primary?: true;
  /** Approving also saves this per-purchase limit, in US dollars (an "Always allow up to"). */
  readonly spendLimit?: number;
}

/** Whole dollars bare ("$15"), cents kept ("$12.50"). */
function dollarsShort(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/** Where a step happens, short: a web address as its site ("adp.com"), anything else as given. */
export function placeOf(where: string): string {
  const trimmed = where.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    return new URL(trimmed).hostname.replace(/^www\./, "");
  } catch {
    return trimmed;
  }
}

const CHANGE_IT = "You can change it in Settings → Permissions";

/**
 * The choices an approval offers, in order, each with what it does: once
 * (first), always where Aldo offers a rule, and no. A paid step's "always"
 * saves the per-purchase limit Aldo offered; an email's or event's, its rule.
 */
export function approvalChoices(
  a: Pick<
    AldoApproval,
    "kind" | "fields" | "approveLabel" | "discardLabel" | "always" | "allowUpTo"
  >,
): ReadonlyArray<ApprovalChoice> {
  const field = (label: string) => a.fields.find((f) => f.label === label)?.value;
  if (a.kind === "confirm") {
    const total = field("Total");
    const where = field("Where");
    // A free step's total says nothing worth a line.
    const paid = total !== undefined && /[1-9]/.test(total);
    const place = where ? placeOf(where) : undefined;
    const said =
      paid && total ? (place ? `${total} to ${place}` : total) : place ? `At ${place}` : "";
    const upTo =
      typeof a.allowUpTo === "number" && Number.isFinite(a.allowUpTo) && a.allowUpTo > 0
        ? a.allowUpTo
        : undefined;
    const always: ReadonlyArray<ApprovalChoice> = upTo
      ? [
          {
            decision: "approve",
            label: `Always allow up to ${dollarsShort(upTo)}`,
            detail: `Saves a rule. ${CHANGE_IT}`,
            spendLimit: upTo,
          },
        ]
      : [];
    return [
      {
        decision: "approve",
        label: upTo ? "Allow once" : "Allow",
        detail: upTo ? `${said || "This step"}, this task only` : said || "Just this step",
        primary: true,
      },
      ...always,
      { decision: "discard", label: "Don't allow", detail: "The agent carries on without it" },
    ];
  }
  const once: ApprovalChoice =
    a.kind === "email"
      ? {
          decision: "approve",
          label: a.approveLabel,
          detail: "Sends it now, exactly as shown",
          primary: true,
        }
      : a.kind === "event"
        ? {
            decision: "approve",
            label: a.approveLabel,
            detail: field("Invites")
              ? "Adds it to your calendar and invites them"
              : "Adds it to your calendar",
            primary: true,
          }
        : {
            decision: "approve",
            label: a.approveLabel,
            detail: "Starts a thread with this brief",
            primary: true,
          };
  const always: ReadonlyArray<ApprovalChoice> = a.always
    ? [{ decision: "always", label: "Always allow", detail: `${a.always}. ${CHANGE_IT}` }]
    : [];
  const no: ApprovalChoice = {
    decision: "discard",
    label: a.discardLabel,
    detail:
      a.kind === "email"
        ? "Deletes the draft. Nothing is sent"
        : a.kind === "event"
          ? "Nothing is added to your calendar"
          : "Nothing starts",
  };
  return [once, ...always, no];
}

export const APPROVAL_KIND_LABEL: Record<AldoApproval["kind"], string> = {
  email: "Email",
  event: "Event",
  start: "Suggestion",
  confirm: "Needs your yes",
};

/** How a decided one went, in a word for its badge. */
export function approvalOutcome(approval: Pick<AldoApproval, "kind" | "status">): string {
  if (approval.status === "expired") return "Expired";
  if (approval.status === "withdrawn") return "Withdrawn";
  if (approval.status === "sending")
    return approval.kind === "email"
      ? "Sending"
      : approval.kind === "event"
        ? "Adding"
        : approval.kind === "start"
          ? "Starting"
          : "Working";
  if (approval.status === "discarded")
    return approval.kind === "start"
      ? "Skipped"
      : approval.kind === "confirm"
        ? "Declined"
        : "Discarded";
  if (approval.kind === "email") return "Sent";
  if (approval.kind === "event") return "Added";
  if (approval.kind === "confirm") return "Approved";
  return "Started";
}

/** What the thread that asked shows: its approvals, oldest first, but not the ones the agent took back. */
export function threadApprovals(
  approvals: ReadonlyArray<AldoApproval> | undefined,
  thread: AldoHomeTarget,
): ReadonlyArray<AldoApproval> {
  return (approvals ?? [])
    .filter((a) => a.status !== "withdrawn" && sameTarget(a.thread, thread))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** A decision the user made from here, shown until Aldo's read says the same. */
export interface ApprovalHold {
  readonly status: AldoApprovalStatus;
  readonly result: string | null;
  /** When it was sent. */
  readonly at: string;
  /** Why not, as Aldo took it, when the user said. */
  readonly reason?: string;
  /** Until when a read that still has it waiting is taken as behind, once Aldo has answered; unset while it's on its way. */
  readonly until?: number;
}

/** By approval id. */
export type ApprovalHolds = Readonly<Record<string, ApprovalHold>>;

/** How long Aldo's read may stay behind a decision it took. */
export const APPROVAL_HOLD_MS = 2 * 60_000;

/**
 * What a tap shows at once: a step an agent takes itself is decided there and
 * then (Aldo only tells the agent); the rest are being carried out.
 */
export function heldStatus(
  approval: Pick<AldoApproval, "kind">,
  decision: "approve" | "discard" | "always",
): AldoApprovalStatus {
  if (approval.kind !== "confirm") return "sending";
  return decision === "discard" ? "discarded" : "approved";
}

/**
 * Aldo's read with the decisions made from here held in: each shows as decided
 * (its card gone, its line there) until a read has it decided too, or the hold
 * outlives APPROVAL_HOLD_MS. The same home comes back when nothing is held.
 */
export function withApprovalHolds(
  home: AldoHome,
  holds: ApprovalHolds,
  now: number,
): { readonly home: AldoHome; readonly holds: ApprovalHolds } {
  const ids = Object.keys(holds);
  if (ids.length === 0 || !home.approvals) return { home, holds };
  const kept: Record<string, ApprovalHold> = {};
  const approvals = home.approvals.map((a) => {
    const hold = holds[a.id];
    const waiting = a.status === "pending" || a.status === "sending";
    if (!hold || !waiting || (hold.until !== undefined && hold.until <= now)) return a;
    kept[a.id] = hold;
    // What a waiting one offers (a rule, reasons to tap) goes with the card.
    const { always: _always, reasons: _reasons, ...rest } = a;
    return {
      ...rest,
      status: hold.status,
      result: hold.result,
      failed: false,
      decidedAt: hold.at,
      ...(hold.reason ? { reason: hold.reason } : {}),
    };
  });
  const same = ids.length === Object.keys(kept).length;
  return {
    home: Object.keys(kept).length === 0 ? home : { ...home, approvals },
    holds: same ? holds : kept,
  };
}

/** A thread's timeline with its approvals in it, each where it was asked (the same entries back when it has none). */
export function withThreadApprovals(
  entries: ReadonlyArray<TimelineEntry>,
  approvals: ReadonlyArray<AldoApproval>,
): ReadonlyArray<TimelineEntry> {
  if (approvals.length === 0) return entries;
  const merged = [...entries];
  for (const approval of approvals) {
    const at = merged.findIndex((entry) => entry.createdAt > approval.createdAt);
    merged.splice(at < 0 ? merged.length : at, 0, {
      id: `aldo-approval:${approval.id}`,
      kind: "aldo-approval",
      createdAt: approval.createdAt,
      approval,
    });
  }
  return merged;
}

/** Whether an approval waits on the user in this thread: its sidebar row says so. */
export function threadAwaitsApproval(
  approvals: ReadonlyArray<AldoApproval> | undefined,
  thread: AldoHomeTarget,
): boolean {
  return (approvals ?? []).some((a) => a.status === "pending" && sameTarget(a.thread, thread));
}
