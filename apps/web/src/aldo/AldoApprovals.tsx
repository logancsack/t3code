// What waits on the user's one tap, on the home screen: an email an agent
// drafted in their mail (Send sends it as it stands), an event for their
// calendar (Add adds it and invites whoever is on it), or a thread Aldo
// suggests in a heads-up (Start it). Each shows what it is in full; under
// them, how the ones decided lately went. The same buttons are on the
// notification on their devices. Shown only when Aldo reports approvals.
// An email to a few named people or an event with no guests can also be
// always allowed: it's approved and becomes a rule, undone from the toast
// or the list under "How Aldo works for you" (AldoHomeBoard.tsx). A step an
// agent asked to take can be declined with why, in a tap ("Don't, because…"):
// the agent is told, and goes on from it, where Aldo offers reasons.

import { Fragment, lazy, Suspense, useMemo } from "react";

import { Badge } from "../components/ui/badge";
import { useNowMinute } from "../hooks/useNowMinute";
import { toastManager } from "../components/ui/toast";
import { cn } from "~/lib/utils";
import { aldoApprovalRulesChanged } from "./AldoApprovalRules";
import { Section } from "./AldoHomeBoard";
import { AgentMarkdown, Quoted } from "./AldoQuoted";
import { removeAldoApprovalRule, type AldoApproval } from "./homeApi";
import { refreshAldoHome, useAldoHomeFeed, useAldoHomeRead } from "./homeFeed";
import {
  approvalOutcome,
  decidedLately,
  threadApprovals,
  threadAwaitsApproval,
  waitingApprovals,
} from "./approvals.logic";
import { relativeTime } from "./home.logic";
import { addedWords, wordDiff } from "./diff.logic";
import type { ApprovalCardProps } from "./AldoApprovalCard";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function ApprovalsSection(props: {
  readonly approvals: ReadonlyArray<AldoApproval>;
  readonly now: number;
  readonly onActed: () => void;
}) {
  const waiting = waitingApprovals(props.approvals);
  const decided = decidedLately(props.approvals, props.now);
  if (waiting.length === 0 && decided.length === 0) return null;
  return (
    <Section title="Approve" count={waiting.length}>
      {waiting.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {waiting.map((a) => (
            <ApprovalCard key={a.id} approval={a} now={props.now} onActed={props.onActed} />
          ))}
        </ul>
      ) : null}
      {decided.length > 0 ? (
        <ul className="rounded-xl border border-border/60 bg-card/30 p-1.5">
          {decided.map((a) => (
            <DecidedApproval key={a.id} approval={a} now={props.now} />
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

/** An approval that isn't waiting any more: how it went, in a line. */
export function DecidedApproval(props: { readonly approval: AldoApproval; readonly now: number }) {
  const a = props.approval;
  return (
    <li className="flex list-none items-start gap-2.5 rounded-lg px-2 py-1.5">
      <Badge variant={a.status === "approved" ? "success" : "outline"} size="sm">
        {approvalOutcome(a)}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{a.title}</p>
        {a.result ? <p className="line-clamp-2 text-muted-foreground text-xs">{a.result}</p> : null}
        {a.reason ? (
          <p className="line-clamp-2 text-muted-foreground text-xs">You said: {a.reason}</p>
        ) : null}
      </div>
      <span className="shrink-0 text-muted-foreground text-xs">
        {a.decidedAt ? relativeTime(a.decidedAt, props.now) : null}
      </span>
    </li>
  );
}

/**
 * The approvals a thread's agent asked, for its timeline (session-logic.ts):
 * the same ones as on Home, from the same read.
 */
export function useAldoThreadApprovals(
  environmentId: string | null,
  threadId: string | null,
  enabled: boolean,
): ReadonlyArray<AldoApproval> {
  const { home } = useAldoHomeRead(enabled);
  return useMemo(
    () =>
      environmentId && threadId
        ? threadApprovals(home?.approvals, { environmentId, threadId })
        : [],
    [home?.approvals, environmentId, threadId],
  );
}

/** Whether an approval waits on the user in this thread (the sidebar's row says so); reads what's there. */
export function useAldoThreadAwaitsApproval(environmentId: string, threadId: string): boolean {
  return useAldoHomeFeed((feed) =>
    threadAwaitsApproval(feed.home?.approvals, { environmentId, threadId }),
  );
}

/** One of a thread's approvals where it was asked: the card while it waits, a line once it's decided. */
export function AldoThreadApproval(props: { readonly approval: AldoApproval }) {
  const now = Date.parse(`${useNowMinute()}:00Z`);
  const a = props.approval;
  return (
    <ul className="flex flex-col">
      {a.status === "pending" ? (
        <ApprovalCard approval={a} now={now} inThread onActed={() => void refreshAldoHome()} />
      ) : (
        <DecidedApproval approval={a} now={now} />
      )}
    </ul>
  );
}

/** What a decision that became a rule says, with Undo. */
export function toastAldoRule(
  message: string,
  rule: { readonly id: string; readonly text: string },
): void {
  aldoApprovalRulesChanged();
  const id = toastManager.add({
    type: "success",
    title: message,
    description: `Saved as a rule: ${rule.text}.`,
    timeout: 10_000,
    actionProps: {
      children: "Undo",
      onClick: () => {
        toastManager.close(id);
        void removeAldoApprovalRule(rule.id).then(
          () => {
            aldoApprovalRulesChanged();
            toastManager.add({ type: "info", title: "Agents will ask again next time." });
          },
          (cause: unknown) =>
            toastManager.add({
              type: "error",
              title: "Couldn't undo the rule",
              description: messageOf(cause),
            }),
        );
      },
    },
  });
}

/**
 * One approval in full, with its buttons (an item of a list). It's decided on
 * every card showing it at the tap (homeFeed.ts sendAldoApproval); in the thread
 * that asked (`inThread`) it doesn't link to that thread.
 */
const FullApprovalCard = lazy(() =>
  import("./AldoApprovalCard").then((m) => ({ default: m.ApprovalCard })),
);

export function ApprovalCard(props: ApprovalCardProps) {
  return (
    <Suspense
      fallback={
        <li className="list-none p-3.5 text-sm" role="status">
          Loading approval…
        </li>
      }
    >
      <FullApprovalCard key={props.approval.id} {...props} />
    </Suspense>
  );
}

/**
 * What an approval says: an agent's words (the brief of a thread to start, a
 * step's details) rendered; an email's or an event's text as it goes out.
 */
export function ApprovalBody(props: {
  readonly approval: AldoApproval;
  readonly lines: 3 | 6;
  readonly className: string;
}) {
  const a = props.approval;
  const written = a.kind === "start" || a.kind === "confirm";
  return (
    <>
      <Quoted
        lines={props.lines}
        className={cn(!written && "whitespace-pre-wrap", props.className)}
      >
        {written ? (
          <AgentMarkdown text={a.body} className={props.className} />
        ) : (
          <ApprovalText approval={a} />
        )}
      </Quoted>
      <RewriteNote approval={a} />
    </>
  );
}

/** The last few drafts' rewrites: a card's text and its note share one, and a long draft's takes a while. */
const rewrites = new Map<string, ReturnType<typeof wordDiff>>();

/** What Aldo rewrote, against what it said before (an Aldo that rewrites drafts). */
function useRewrite(a: AldoApproval) {
  const before = a.previous?.body;
  return useMemo(() => {
    if (before === undefined) return null;
    const key = `${before}\u0000${a.body}`;
    let runs = rewrites.get(key);
    if (!runs) {
      runs = wordDiff(before, a.body);
      if (rewrites.size >= 8) rewrites.delete(rewrites.keys().next().value!);
      rewrites.set(key, runs);
    }
    return runs;
  }, [before, a.body]);
}

/** An email's or an event's text as it goes out: one Aldo rewrote, the words it put in underlined. */
export function ApprovalText(props: { readonly approval: AldoApproval }) {
  const runs = useRewrite(props.approval);
  if (!runs) return <>{props.approval.body}</>;
  return runs.map((run, i) =>
    run.added ? (
      <ins
        // oxlint-disable-next-line react/no-array-index-key -- runs have no identity but their place
        key={i}
        className="text-inherit underline decoration-primary decoration-[1.5px] underline-offset-[3px]"
      >
        {run.text}
      </ins>
    ) : (
      // oxlint-disable-next-line react/no-array-index-key -- runs have no identity but their place
      <Fragment key={i}>{run.text}</Fragment>
    ),
  );
}

/** Under a text Aldo rewrote: that it did, so the underlines read as what's new, and what the subject was if it changed. */
export function RewriteNote(props: {
  readonly approval: AldoApproval;
  readonly className?: string;
}) {
  const a = props.approval;
  const runs = useRewrite(a);
  if (!runs || !a.previous) return null;
  const name = a.kind === "email" ? "subject" : "title";
  const retitled = a.previous.title !== a.title;
  let words =
    addedWords(runs) > 0
      ? "Aldo rewrote it. The new words in the text are underlined."
      : "Aldo rewrote it.";
  if (retitled)
    words =
      a.previous.body === a.body
        ? `Aldo changed the ${name} from “${a.previous.title}”.`
        : `${words} The ${name} was “${a.previous.title}”.`;
  return (
    <p className={cn("text-[12px] text-muted-foreground leading-[18px]", props.className)}>
      {words}
    </p>
  );
}
