// One list for Home's chip and picker, independent of which messages are loaded.
import {
  aldoChatDecisions,
  decisionAt,
  decisionTitle,
  pausedInChat,
  putAway,
} from "./decisions.logic";
import type { AldoHome, AldoHomeConversation } from "./homeApi";
import { parseAldoPlans, planPutOff } from "./plans.logic";
import { aldoComputerName } from "./computer.logic";

const WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

export function inWords(count: number): string {
  return WORDS[count - 1] ?? String(count);
}

export function needsYouWords(count: number): string | null {
  if (count <= 0) return null;
  const words = inWords(count);
  return `${words[0]!.toUpperCase()}${words.slice(1)} ${count === 1 ? "needs" : "need"} you`;
}

export interface NeedsYouItem {
  readonly key: string;
  readonly title: string;
  readonly kind: string;
  readonly at: string;
  readonly selector: string;
}

export interface ComputerRequest extends NeedsYouItem {
  readonly conversation: AldoHomeConversation;
  readonly computer: NonNullable<AldoHomeConversation["computers"]>[number];
}

export function computerRequests(home: AldoHome): ReadonlyArray<ComputerRequest> {
  return home.conversations.flatMap((conversation) =>
    (conversation.computers ?? [])
      .filter((c) => c.status === "asked")
      .map((computer) => {
        const at = computer.askedAt ?? conversation.stateAt ?? conversation.at;
        const key = `computer:${conversation.ref}:${computer.computer}:${at}`;
        return {
          key,
          at,
          conversation,
          computer,
          title: `Start your ${aldoComputerName({ kind: computer.computer })}`,
          kind: "Computer request",
          selector: `[data-aldo-computer-request=${JSON.stringify(key)}]`,
        };
      }),
  );
}

/** Answered cards, dismissed cards and deferred plans never inflate the count. */
export function pendingNeedsYou(
  home: AldoHome,
  now: number,
  answered: ReadonlyArray<string> = [],
): ReadonlyArray<NeedsYouItem> {
  const computers = computerRequests(home).filter(
    (c) => !putAway(c.conversation, now) && !c.conversation.chatDecision?.dismissed,
  );
  const asksForComputer = (ref: string) => computers.some((c) => c.conversation.ref === ref);
  const decisions = aldoChatDecisions(home, now)
    .filter((d) => d.kind !== "waiting" || !asksForComputer(d.conversation.ref))
    .map((d) => ({
      key: d.key,
      title: decisionTitle(d),
      at: decisionAt(d, home),
      kind:
        d.kind === "aldo-approval"
          ? {
              email: "Email draft",
              event: "Calendar event",
              start: "Approval",
              confirm: "Approval",
            }[d.approval.kind]
          : {
              plan: "Plan",
              approval: "Approval",
              question: "Question",
              handoff: "Browser request",
              payment: "Payment",
              merge: "Pull request",
              failed: "Stopped thread",
              waiting: "Waiting thread",
            }[d.kind],
      selector: `[data-aldo-decision=${JSON.stringify(d.key)}]`,
    }));
  const plans = parseAldoPlans(home.plans)
    .filter((p) => p.status === "proposed" && !planPutOff(p, now))
    .map((p) => ({
      key: `home-plan:${p.id}`,
      title: p.goal,
      kind: "Plan",
      at: p.proposedAt,
      selector: `[data-aldo-plan=${JSON.stringify(p.id)}]`,
    }));
  const paused = pausedInChat(home, now)
    .filter((c) => !asksForComputer(c.ref))
    .map((c) => ({
      key: `paused:${c.ref}`,
      title: c.title,
      kind: "Paused thread",
      at: c.stateAt ?? c.at,
      selector: `[data-aldo-paused=${JSON.stringify(c.ref)}]`,
    }));
  return [...plans, ...decisions, ...computers, ...paused]
    .filter((item) => !answered.includes(item.key))
    .sort((a, b) => a.at.localeCompare(b.at));
}
