// What waits on the user's one tap, on the home screen: an email an agent
// drafted in their mail (Send sends it as it stands), an event for their
// calendar (Add adds it and invites whoever is on it), or a thread Aldo
// suggests in a heads-up (Start it). Each shows what it is in full; under
// them, how the ones decided lately went. The same buttons are on the
// notification on their devices. Shown only when Aldo reports approvals.
// An email to a few named people or an event with no guests can also be
// always allowed: it's approved and becomes a rule, undone from the toast
// or the list under "How Aldo works for you" (AldoHomeBoard.tsx).

import { CalendarPlusIcon, CircleCheckBigIcon, MailIcon, SparklesIcon } from "lucide-react";
import { useMemo } from "react";

import { Badge } from "../components/ui/badge";
import { useNowMinute } from "../hooks/useNowMinute";
import { Button } from "../components/ui/button";
import { toastManager } from "../components/ui/toast";
import { requestConfirmDialog } from "../confirmDialog";
import { cn } from "~/lib/utils";
import { aldoApprovalRulesChanged } from "./AldoApprovalRules";
import { Section } from "./AldoHomeBoard";
import { ThreadLink } from "./AldoHomeInbox";
import { AgentMarkdown, Quoted } from "./AldoQuoted";
import { AldoApiError } from "./api";
import { removeAldoApprovalRule, type AldoApproval } from "./homeApi";
import { refreshAldoHome, sendAldoApproval, useAldoHomeFeed, useAldoHomeRead } from "./homeFeed";
import {
  APPROVAL_KIND_LABEL,
  approvalOutcome,
  approvalQuestion,
  decidedLately,
  threadApprovals,
  threadAwaitsApproval,
  waitingApprovals,
} from "./approvals.logic";
import { relativeTime } from "./home.logic";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const KIND_ICON = {
  email: MailIcon,
  event: CalendarPlusIcon,
  start: SparklesIcon,
  confirm: CircleCheckBigIcon,
} as const;

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
export function ApprovalCard(props: {
  readonly approval: AldoApproval;
  readonly now: number;
  readonly onActed: () => void;
  readonly inThread?: boolean;
}) {
  const a = props.approval;
  const Icon = KIND_ICON[a.kind];
  const sending = a.status === "sending";
  const decide = async (decision: "approve" | "discard" | "always") => {
    if (decision === "discard" && a.kind === "email") {
      const confirmed = await (requestConfirmDialog(
        "Discard this draft? It's deleted from your drafts, and isn't sent.",
        { variant: "destructive" },
      ) ?? Promise.resolve(true));
      if (!confirmed) return;
    }
    if (decision === "always") {
      const confirmed = await (requestConfirmDialog(
        `${a.always}, from now on? This one is approved now too, and you can undo the rule.`,
      ) ?? Promise.resolve(true));
      if (!confirmed) return;
    }
    try {
      const { message, rule } = await sendAldoApproval(a, decision);
      if (rule) toastAldoRule(message, rule);
      else toastManager.add({ type: "success", title: message });
    } catch (cause) {
      // A draft that changed since it was shown comes back as it is now, to look at again.
      const changed = cause instanceof AldoApiError && cause.status === 409;
      toastManager.add({
        type: changed ? "warning" : "error",
        title: changed ? "Look again" : "Couldn't do that",
        description: messageOf(cause),
      });
    } finally {
      props.onActed();
    }
  };
  return (
    <li className="list-none rounded-xl border border-border/60 bg-card/30 p-3.5">
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
            <Badge variant="warning" size="sm">
              {APPROVAL_KIND_LABEL[a.kind]}
            </Badge>
            {a.thread && !props.inThread ? (
              <ThreadLink target={a.thread} className="min-w-0 truncate hover:text-foreground">
                {a.kind === "start" ? "Started" : "From"} {a.threadTitle ?? "its thread"}
              </ThreadLink>
            ) : a.kind === "start" && !a.thread ? (
              <span>From Aldo</span>
            ) : null}
            <span>· {relativeTime(a.createdAt, props.now)}</span>
          </div>
          <p className="mt-1 font-medium text-sm">{approvalQuestion(a)}</p>
          {a.fields.length > 0 ? (
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
              {a.fields.map((f) => (
                <div key={f.label} className="contents">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="min-w-0 break-words">{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-0.5 text-muted-foreground text-xs">{a.summary}</p>
          )}
          {a.body ? (
            <div className="mt-2 flex flex-col gap-1 rounded-lg border border-border/50 bg-background/40 px-2.5 py-2">
              <ApprovalBody approval={a} lines={6} className="text-sm" />
            </div>
          ) : null}
          {a.failed && a.result ? (
            <p className="mt-2 text-destructive-foreground text-xs">{a.result}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={sending} onClick={() => void decide("approve")}>
              {sending ? "Working…" : a.approveLabel}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={sending}
              onClick={() => void decide("discard")}
            >
              {a.discardLabel}
            </Button>
            {a.always ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={sending}
                onClick={() => void decide("always")}
                aria-label={`${a.approveLabel}, and always allow: ${a.always}`}
              >
                Always allow…
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </li>
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
    <Quoted lines={props.lines} className={cn(!written && "whitespace-pre-wrap", props.className)}>
      {written ? <AgentMarkdown text={a.body} className={props.className} /> : a.body}
    </Quoted>
  );
}
