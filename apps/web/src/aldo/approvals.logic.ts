// Approvals on the home screen (AldoApprovals.tsx): which wait on the user,
// what each asks in words, and how the ones they decided lately went.

import type { AldoApproval } from "./cloud";

const DAY = 24 * 60 * 60 * 1000;
const DECIDED_SHOWN = 5;

/** Waiting on the user (or being done right now), oldest first: the first asked is the first to answer. */
export function waitingApprovals(
  approvals: ReadonlyArray<AldoApproval> | undefined,
): ReadonlyArray<AldoApproval> {
  return (approvals ?? [])
    .filter((a) => a.status === "pending" || a.status === "sending")
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
  if (approval.kind === "confirm") return `${approval.title}?`;
  return approval.title;
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
