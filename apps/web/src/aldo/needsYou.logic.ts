// One list for Home's chip and picker, independent of which messages are loaded.
import {
  aldoChatDecisions,
  aldoDecisions,
  chatDecisionOf,
  decisionAt,
  decisionThread,
  decisionTitle,
  pausedInChat,
  putAway,
} from "./decisions.logic";
import { isPausedMidTurn } from "./home.logic";
import type { AldoChatDecision, AldoHome, AldoHomeConversation, AldoHomeTarget } from "./homeApi";
import { parseAldoPlans, planCardState, planPutOff } from "./plans.logic";
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
  /** The thread it belongs to, when it has one. */
  readonly thread?: AldoHomeTarget | null;
  /** Set while the user has hidden it from Aldo's conversation (or put it off); it still waits. */
  readonly hidden?: AldoChatDecision;
  /** What dismissing it names (an Aldo that can't dismiss has none, and no way to). */
  readonly decision?: AldoChatDecision;
}

/** The dismissal a hidden item carries, or nothing. */
const hiddenBy = (decision: AldoChatDecision | undefined) => ({
  ...(decision ? { decision } : {}),
  ...(decision?.dismissed ? { hidden: decision } : {}),
});

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
          thread: conversation.thread,
          ...hiddenBy(conversation.chatDecision),
          selector: `[data-aldo-computer-request=${JSON.stringify(key)}]`,
        };
      }),
  );
}

/**
 * What waits on the user now, for the chip, its list and the header: the
 * decisions and paused threads they haven't hidden or put off, computer
 * requests, and plans waiting for their Start. Decided approvals kept for the
 * conversation's history, `answered` keys the read hasn't caught up with, and
 * plans that start on their own, have started or couldn't start don't wait.
 * `withHidden`: also what they hid from Aldo's conversation or put off, each
 * with its `hidden` dismissal: it all still waits in its thread. What they
 * dismissed from Needs you (`decision.cleared`) is in neither.
 */
export function pendingNeedsYou(
  home: AldoHome,
  now: number,
  answered: ReadonlyArray<string> = [],
  withHidden = false,
): ReadonlyArray<NeedsYouItem> {
  return needsYouItems(home, now, answered, withHidden).filter((item) => !item.decision?.cleared);
}

/** What the user dismissed from Needs you and it still waits, oldest first: listed to restore. */
export function dismissedNeedsYou(
  home: AldoHome,
  now: number,
  answered: ReadonlyArray<string> = [],
): ReadonlyArray<NeedsYouItem> {
  return needsYouItems(home, now, answered, true).filter((item) => item.decision?.cleared);
}

function needsYouItems(
  home: AldoHome,
  now: number,
  answered: ReadonlyArray<string>,
  withHidden: boolean,
): ReadonlyArray<NeedsYouItem> {
  const computers = computerRequests(home).filter(
    (c) => !putAway(c.conversation, now) && (withHidden || !c.conversation.chatDecision?.dismissed),
  );
  const asksForComputer = (ref: string) => computers.some((c) => c.conversation.ref === ref);
  const decisions = (withHidden ? aldoDecisions(home, now, true) : aldoChatDecisions(home, now))
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
      thread: decisionThread(d),
      ...hiddenBy(chatDecisionOf(d)),
    }));
  const plans = parseAldoPlans(home.plans)
    .filter((p) => !p.error && !planPutOff(p, now) && planCardState(p, { now }).kind === "waiting")
    .map((p) => ({
      key: `home-plan:${p.id}`,
      title: p.goal,
      kind: "Plan",
      at: p.proposedAt,
      selector: `[data-aldo-plan=${JSON.stringify(p.id)}]`,
      thread: p.thread,
      ...hiddenBy(p.chatDecision),
    }));
  const paused = (
    withHidden
      ? home.conversations.filter((c) => isPausedMidTurn(c) && !putAway(c, now))
      : pausedInChat(home, now)
  )
    .filter((c) => !asksForComputer(c.ref))
    .map((c) => ({
      key: `paused:${c.ref}`,
      title: c.title,
      kind: "Paused thread",
      at: c.stateAt ?? c.at,
      selector: `[data-aldo-paused=${JSON.stringify(c.ref)}]`,
      thread: c.thread,
      ...hiddenBy(c.chatDecision),
    }));
  return [...plans, ...decisions, ...computers, ...paused]
    .filter((item) => !answered.includes(item.key))
    .sort((a, b) => a.at.localeCompare(b.at));
}
