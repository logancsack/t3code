// What a card at the end of Aldo's conversation (AldoUpNext.tsx) leaves once
// it's answered: a line saying what was done, where it was done, so the
// conversation keeps it rather than the card just vanishing (receipts.ts).
// It says only what happened: a card that had already moved on says that.
// Pure, so it's tested on its own.

import type { AldoChoice } from "./decide";
import type { AldoDecision } from "./decisions.logic";

/**
 * What was done, as a line: "Sent “Reply to Dana”", "Merged #231 Virtualize
 * the sidebar". `said` is what Aldo said it did (its own approvals), which is
 * told over what was asked for: a discard whose draft couldn't be deleted says so.
 */
export function receiptText(
  decision: AldoDecision,
  choice: AldoChoice,
  said: string | null = null,
): string {
  switch (decision.kind) {
    case "aldo-approval": {
      const a = decision.approval;
      const discard = choice.kind === "aldo" && choice.decision === "discard";
      if (said) return discard ? `“${a.title}”: ${said}` : said;
      if (discard) return `Discarded “${a.title}”`;
      if (a.kind === "email") return `Sent “${a.title}”`;
      if (a.kind === "event") return `Added “${a.title}” to your calendar`;
      if (a.kind === "start") return `Started “${a.title}”`;
      return `${a.approveLabel}: ${a.title}`;
    }
    case "merge":
      return `Merged #${decision.pullRequest.number} ${decision.pullRequest.title}`;
    case "plan":
      return choice.kind === "plan" && choice.changes
        ? `Asked for changes to the plan for ${decision.conversation.title}`
        : `Approved the plan for ${decision.conversation.title}`;
    case "question": {
      if (choice.kind !== "answer") break;
      const picked = Object.values(choice.answers ?? {})
        .flatMap((a) => (Array.isArray(a) ? a : [a]))
        .join(", ");
      const answer = picked || choice.text;
      return answer
        ? `Answered “${answer}” for ${decision.conversation.title}`
        : `Answered ${decision.conversation.title}`;
    }
    case "approval":
      if (choice.kind !== "decision") break;
      return `${choice.label} · ${decision.conversation.title}`;
    default:
      break;
  }
  return `Done · ${"conversation" in decision ? decision.conversation.title : "it"}`;
}

/**
 * What a card that had already moved on leaves: that, not what the user
 * chose, since nothing was done; with what Aldo said of it, where it said.
 */
export function movedOnText(decision: AldoDecision, said: string | null = null): string {
  const what =
    decision.kind === "merge"
      ? `#${decision.pullRequest.number} ${decision.pullRequest.title}`
      : decision.kind === "aldo-approval"
        ? `“${decision.approval.title}”`
        : decision.kind === "payment"
          ? `${decision.payment.total} at ${decision.payment.merchant}`
          : decision.conversation.title;
  return said ? `${what}: ${said}` : `${what} had already moved on`;
}
