// What waits on the user's one tap, on the home screen: an email an agent
// drafted in their mail (Send sends it as it stands), an event for their
// calendar (Add adds it and invites whoever is on it), or a thread Aldo
// suggests in a heads-up (Start it). Each shows what it is in full; under
// them, how the ones decided lately went. The same buttons are on the
// notification on their devices. Shown only when Aldo reports approvals.

import { CalendarPlusIcon, MailIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { toastManager } from "../components/ui/toast";
import { requestConfirmDialog } from "../confirmDialog";
import { cn } from "~/lib/utils";
import { Section } from "./AldoHomeBoard";
import { ThreadLink } from "./AldoHomeInbox";
import { AldoApiError, decideAldoApproval, type AldoApproval } from "./cloud";
import {
  APPROVAL_KIND_LABEL,
  approvalOutcome,
  approvalQuestion,
  decidedLately,
  waitingApprovals,
} from "./approvals.logic";
import { relativeTime } from "./home.logic";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const KIND_ICON = { email: MailIcon, event: CalendarPlusIcon, start: SparklesIcon } as const;

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
            <li key={a.id} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5">
              <Badge variant={a.status === "approved" ? "success" : "outline"} size="sm">
                {approvalOutcome(a)}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{a.title}</p>
                {a.result ? (
                  <p className="line-clamp-2 text-muted-foreground text-xs">{a.result}</p>
                ) : null}
              </div>
              <span className="shrink-0 text-muted-foreground text-xs">
                {a.decidedAt ? relativeTime(a.decidedAt, props.now) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

function ApprovalCard(props: {
  readonly approval: AldoApproval;
  readonly now: number;
  readonly onActed: () => void;
}) {
  const a = props.approval;
  const [busy, setBusy] = useState<"approve" | "discard" | null>(null);
  const [expanded, setExpanded] = useState(false);
  const Icon = KIND_ICON[a.kind];
  const sending = a.status === "sending";
  const decide = async (decision: "approve" | "discard") => {
    if (decision === "discard" && a.kind === "email") {
      const confirmed = await (requestConfirmDialog(
        "Discard this draft? It's deleted from your drafts, and isn't sent.",
        { variant: "destructive" },
      ) ?? Promise.resolve(true));
      if (!confirmed) return;
    }
    setBusy(decision);
    try {
      const { message } = await decideAldoApproval(a.id, decision);
      toastManager.add({ type: "success", title: message });
    } catch (cause) {
      // A draft that changed since it was shown comes back as it is now, to look at again.
      const changed = cause instanceof AldoApiError && cause.status === 409;
      toastManager.add({
        type: changed ? "warning" : "error",
        title: changed ? "Look again" : "Couldn't do that",
        description: messageOf(cause),
      });
    } finally {
      setBusy(null);
      props.onActed();
    }
  };
  return (
    <li className="rounded-xl border border-border/60 bg-card/30 p-3.5">
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
            <Badge variant="warning" size="sm">
              {APPROVAL_KIND_LABEL[a.kind]}
            </Badge>
            {a.thread ? (
              <ThreadLink target={a.thread} className="min-w-0 truncate hover:text-foreground">
                {a.kind === "start" ? "Started" : "From"} {a.threadTitle ?? "its thread"}
              </ThreadLink>
            ) : a.kind === "start" ? (
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
            <button
              type="button"
              className="mt-2 block w-full rounded-lg border border-border/50 bg-background/40 px-2.5 py-2 text-left"
              onClick={() => setExpanded((open) => !open)}
              aria-expanded={expanded}
            >
              <p className={cn("whitespace-pre-wrap text-sm", !expanded && "line-clamp-6")}>
                {a.body}
              </p>
            </button>
          ) : null}
          {a.failed && a.result ? (
            <p className="mt-2 text-destructive-foreground text-xs">{a.result}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy !== null || sending}
              onClick={() => void decide("approve")}
            >
              {busy === "approve" || sending ? "Working…" : a.approveLabel}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null || sending}
              onClick={() => void decide("discard")}
            >
              {busy === "discard" ? "Working…" : a.discardLabel}
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}
