// The parts of the summon bar (AldoSummon.tsx) that don't touch the page: its
// shortcut, and what it offers. With nothing typed: things to say about the
// thread on screen, what needs the user elsewhere, and what's working. With
// words typed: ask Aldo, write them to the agent on screen, or jump to a
// thread whose title has them.

import { waitingApprovals } from "./approvals.logic";
import type { AldoOnScreen, AldoOpenTarget } from "./assistant.logic";
import type { AldoApproval, AldoHome, AldoHomeConversation, AldoHomePullRequest } from "./cloud";
import { boardFor, sameTarget } from "./home.logic";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** How to summon Aldo from anywhere. */
export const ALDO_SUMMON_LABEL = isMac ? "⌘I" : "Ctrl+I";

/** Mod+I: Aldo, over whatever's on screen. */
export function isSummonShortcut(
  event: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "key">,
): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === "i"
  );
}

/** A thread the bar can jump to, as the sidebar has it. */
export interface SummonThread extends AldoOpenTarget {
  readonly title: string;
  readonly updatedAt: string;
  readonly archived: boolean;
}

export type SummonRow =
  /** Ask Aldo the words typed. */
  | { readonly kind: "ask"; readonly key: string; readonly text: string }
  /** Write the words typed into the composer of the thread on screen. */
  | { readonly kind: "agent"; readonly key: string; readonly text: string; readonly title: string }
  /** Something to say to Aldo about the thread on screen. */
  | {
      readonly kind: "say";
      readonly key: string;
      readonly label: string;
      readonly text: string;
      readonly icon: "progress" | "review" | "opinion";
    }
  | { readonly kind: "merge"; readonly key: string; readonly pullRequest: AldoHomePullRequest }
  | { readonly kind: "needs"; readonly key: string; readonly conversation: AldoHomeConversation }
  | { readonly kind: "approval"; readonly key: string; readonly approval: AldoApproval }
  | { readonly kind: "working"; readonly key: string; readonly conversation: AldoHomeConversation }
  | { readonly kind: "thread"; readonly key: string; readonly thread: SummonThread };

export interface SummonSection {
  readonly title: string | null;
  readonly rows: ReadonlyArray<SummonRow>;
}

const NEEDS_YOU_ROWS = 5;
const WORKING_ROWS = 3;
const THREAD_ROWS = 6;

/** What the bar offers, by section, for what's typed and what's on screen. */
export function summonSections(input: {
  readonly query: string;
  readonly onScreen: AldoOnScreen | null;
  readonly home: AldoHome | null;
  readonly threads: ReadonlyArray<SummonThread>;
  readonly now: number;
}): ReadonlyArray<SummonSection> {
  const { onScreen, home } = input;
  const query = input.query.trim();
  const elsewhere = (target: AldoOpenTarget) => !onScreen || !sameTarget(target, onScreen);
  if (query) {
    const words = query.toLowerCase();
    const threads = input.threads
      .filter((t) => !t.archived && elsewhere(t) && t.title.toLowerCase().includes(words))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, THREAD_ROWS);
    return [
      {
        title: null,
        rows: [
          { kind: "ask", key: "ask", text: query },
          ...(onScreen
            ? [{ kind: "agent" as const, key: "agent", text: query, title: onScreen.title }]
            : []),
        ],
      },
      ...(threads.length > 0
        ? [
            {
              title: "Threads",
              rows: threads.map((thread) => ({
                kind: "thread" as const,
                key: `thread:${thread.environmentId}:${thread.threadId}`,
                thread,
              })),
            },
          ]
        : []),
    ];
  }
  const sections: SummonSection[] = [];
  if (onScreen) {
    const title = JSON.stringify(onScreen.title);
    const mergeable = (home?.pullRequests ?? []).filter(
      (pr) => sameTarget(pr.thread, onScreen) && pr.status === "watching" && pr.stage === "green",
    );
    sections.push({
      title: "For this thread",
      rows: [
        {
          kind: "say",
          key: "say:progress",
          label: "Where is it up to?",
          text: `Where is ${title} up to?`,
          icon: "progress",
        },
        ...mergeable.map((pullRequest) => ({
          kind: "merge" as const,
          key: `merge:${pullRequest.repo}#${pullRequest.number}`,
          pullRequest,
        })),
        {
          kind: "say",
          key: "say:review",
          label: "Review its changes",
          text: `Look over what ${title} changed, and tell me if anything looks off.`,
          icon: "review",
        },
        {
          kind: "say",
          key: "say:opinion",
          label: "Get a second opinion",
          text: `Start a thread with a different agent to review what ${title} did, and tell me what it finds.`,
          icon: "opinion",
        },
      ],
    });
  }
  if (home) {
    const board = boardFor(home.conversations, input.now);
    const needs: SummonRow[] = [
      ...waitingApprovals(home.approvals).map((approval) => ({
        kind: "approval" as const,
        key: `approval:${approval.id}`,
        approval,
      })),
      ...board.needsYou
        .filter((c) => elsewhere(c.thread))
        .map((conversation) => ({
          kind: "needs" as const,
          key: `needs:${conversation.ref}`,
          conversation,
        })),
    ];
    if (needs.length > 0)
      sections.push({
        title: onScreen ? "Needs you elsewhere" : "Needs you",
        rows: needs.slice(0, NEEDS_YOU_ROWS),
      });
    const working = board.working.filter((c) => elsewhere(c.thread)).slice(0, WORKING_ROWS);
    if (working.length > 0)
      sections.push({
        title: "Working",
        rows: working.map((conversation) => ({
          kind: "working" as const,
          key: `working:${conversation.ref}`,
          conversation,
        })),
      });
  }
  return sections;
}

/** The rows in the order the arrow keys move over them. */
export function summonRows(sections: ReadonlyArray<SummonSection>): ReadonlyArray<SummonRow> {
  return sections.flatMap((section) => section.rows);
}

/** Where the selection goes on ArrowUp/ArrowDown, wrapping around; null for other keys. */
export function moveSummonSelection(current: number, length: number, key: string): number | null {
  if (length === 0) return null;
  if (key === "ArrowDown") return (current + 1) % length;
  if (key === "ArrowUp") return (current - 1 + length) % length;
  return null;
}

/**
 * Words written to the agent on screen, after what's in its composer already
 * (on a line of their own), so a draft isn't lost.
 */
export function promptWith(draft: string, words: string): string {
  const before = draft.trimEnd();
  return before ? `${before}\n\n${words}` : words;
}
