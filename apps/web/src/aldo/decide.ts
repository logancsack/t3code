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
  fetchAldoHome,
  mergeAldoPullRequest,
} from "./cloud";
import { decisionOpen, type AldoDecision } from "./decisions.logic";
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

/** Whether the home read still has a decision waiting; true when it can't be read, so nothing's taken as settled. */
async function stillOpen(decision: AldoDecision): Promise<boolean> {
  try {
    const home = await fetchAldoHome();
    return home ? decisionOpen(home, decision.key, Date.now()) : true;
  } catch {
    return true;
  }
}

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

/** How a decision went: done as chosen, already settled some other way (nothing was done), or not done. */
export type AldoDecided = "done" | "moved-on" | "failed";

export interface AldoDecidedResult {
  readonly outcome: AldoDecided;
  /** What Aldo said happened, where it says (its own approvals): what's told, rather than what was asked. */
  readonly said: string | null;
}

/**
 * Acts on a decision as the user chose; true only when it's done as chosen.
 * Failing, it says why; done, it says so too, unless `quiet` (the card it was
 * on says it).
 */
export async function decideAldo(
  decision: AldoDecision,
  choice: AldoChoice,
  options: { readonly quiet?: boolean } = {},
): Promise<boolean> {
  return (await decideAldoOutcome(decision, choice, options)).outcome === "done";
}

/** decideAldo, telling done from moved on, with what Aldo said, so what's said after is only what happened. */
export async function decideAldoOutcome(
  decision: AldoDecision,
  choice: AldoChoice,
  options: { readonly quiet?: boolean } = {},
): Promise<AldoDecidedResult> {
  const done = (title: string, said: string | null = null): AldoDecidedResult => {
    if (!options.quiet) toastManager.add({ type: "success", title });
    return { outcome: "done", said };
  };
  const movedOn = (said: string): AldoDecidedResult => {
    // Quiet, the card says it moved on in the line it leaves.
    if (!options.quiet)
      toastManager.add({ type: "warning", title: "It had already moved on", description: said });
    return { outcome: "moved-on", said };
  };
  try {
    if (choice.kind === "aldo" && decision.kind === "aldo-approval") {
      const { approval, message } = await decideAldoApproval(decision.approval.id, choice.decision);
      // An approval decided before (elsewhere, or it expired or was withdrawn) is answered as it stands.
      const asked = choice.decision === "discard" ? "discarded" : "approved";
      return approval.status === asked ? done(message, message) : movedOn(message);
    }
    if (choice.kind === "merge" && decision.kind === "merge") {
      const pr = decision.pullRequest;
      await mergeAldoPullRequest(pr.environmentId, pr);
      return done(`Merged ${pr.repo}#${pr.number}`);
    }
    if (choice.kind === "plan" && decision.kind === "plan") {
      await approveAldoPlan(decision.conversation.thread, decision.plan.id);
      return done("The agent is carrying out the plan");
    }
    if (choice.kind === "answer" && decision.kind === "question") {
      await answerAldoThread(decision.conversation.thread, {
        requestId: decision.pending.requestId,
        ...(choice.answers ? { answers: choice.answers } : {}),
        ...(choice.text ? { text: choice.text } : {}),
      });
      return done("Answered");
    }
    if (choice.kind === "decision" && decision.kind === "approval") {
      await answerAldoThread(decision.conversation.thread, {
        requestId: decision.pending.requestId,
        decision: choice.decision,
      });
      return done("Decision sent");
    }
    return { outcome: "failed", said: null };
  } catch (cause) {
    // What a thread asked, answered elsewhere or replaced by what it asks now (the
    // thread's actions say 409), but a 409 is also "not now" (a plan while the
    // thread works), so it's moved on only once the home read no longer has it.
    // A merge's 409 is a refusal (checks, a draft), so it fails.
    const threadSaidNo =
      cause instanceof AldoApiError &&
      cause.status === 409 &&
      (decision.kind === "question" || decision.kind === "approval" || decision.kind === "plan");
    if (threadSaidNo && !(await stillOpen(decision))) return movedOn(messageOf(cause));
    toastManager.add({ type: "error", title: "Couldn't do that", description: messageOf(cause) });
    return { outcome: "failed", said: null };
  } finally {
    void refreshAldoHome();
  }
}
