// Making a decision in a tap (decisions.logic.ts), from the brief's "Top of
// mind", the phone's Agents tab or going through them with Aldo: the page acts
// as the user would on the board, through the same routes, says how it went,
// and gives back what was chosen in words (for Aldo, on a call). The home
// read is refreshed after, so the decision leaves the page.

import { toastManager } from "../components/ui/toast";
import {
  AldoApiError,
  answerAldoThread,
  approveAldoPlan,
  decideAldoApproval,
  mergeAldoPullRequest,
} from "./cloud";
import type { AldoDecision } from "./decisions.logic";
import { refreshAldoHome } from "./homeFeed";

export type AldoChoice =
  /** A question's answer: a choice per question, or the user's own words. */
  | {
      readonly kind: "answer";
      readonly answers?: Record<string, string | ReadonlyArray<string>>;
      readonly text?: string;
    }
  /** A thread's approval: the option chosen. */
  | { readonly kind: "decision"; readonly decision: string; readonly label: string }
  | { readonly kind: "plan" }
  /** One of Aldo's approvals: an email to send, an event to add, a thread to start. */
  | { readonly kind: "aldo"; readonly decision: "approve" | "discard" }
  | { readonly kind: "merge" };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What the user chose, as words for Aldo ("answered 80%", "merged it"). */
export function choiceWords(decision: AldoDecision, choice: AldoChoice): string {
  switch (choice.kind) {
    case "answer": {
      const picked = Object.values(choice.answers ?? {})
        .flatMap((a) => (Array.isArray(a) ? a : [a]))
        .join(", ");
      return `answered ${picked || `"${choice.text ?? ""}"`}`;
    }
    case "decision":
      return `chose "${choice.label}"`;
    case "plan":
      return "approved the plan";
    case "aldo":
      return decision.kind === "aldo-approval"
        ? `chose "${choice.decision === "approve" ? decision.approval.approveLabel : decision.approval.discardLabel}"`
        : choice.decision;
    case "merge":
      return "merged it";
  }
}

/**
 * Acts on a decision as the user chose; true when it's done (or had already
 * moved on, which leaves it decided all the same). Failing, it says why.
 */
export async function decideAldo(decision: AldoDecision, choice: AldoChoice): Promise<boolean> {
  try {
    if (choice.kind === "aldo" && decision.kind === "aldo-approval") {
      const { message } = await decideAldoApproval(decision.approval.id, choice.decision);
      toastManager.add({ type: "success", title: message });
    } else if (choice.kind === "merge" && decision.kind === "merge") {
      const pr = decision.pullRequest;
      await mergeAldoPullRequest(pr.environmentId, pr);
      toastManager.add({ type: "success", title: `Merged ${pr.repo}#${pr.number}` });
    } else if (choice.kind === "plan" && decision.kind === "plan") {
      await approveAldoPlan(decision.conversation.thread, decision.plan.id);
      toastManager.add({ type: "success", title: "The agent is carrying out the plan" });
    } else if (choice.kind === "answer" && decision.kind === "question") {
      await answerAldoThread(decision.conversation.thread, {
        requestId: decision.pending.requestId,
        ...(choice.answers ? { answers: choice.answers } : {}),
        ...(choice.text ? { text: choice.text } : {}),
      });
      toastManager.add({ type: "success", title: "Answered" });
    } else if (choice.kind === "decision" && decision.kind === "approval") {
      await answerAldoThread(decision.conversation.thread, {
        requestId: decision.pending.requestId,
        decision: choice.decision,
      });
      toastManager.add({ type: "success", title: "Decision sent" });
    } else {
      return false;
    }
    return true;
  } catch (cause) {
    // The thread moved on (answered elsewhere, or it asks something else now): decided all the same.
    const movedOn = cause instanceof AldoApiError && cause.status === 409;
    toastManager.add({
      type: movedOn ? "warning" : "error",
      title: movedOn ? "It moved on" : "Couldn't do that",
      description: messageOf(cause),
    });
    return movedOn && decision.kind !== "aldo-approval";
  } finally {
    void refreshAldoHome();
  }
}
