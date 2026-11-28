import { plainCardText } from "./plainCardText";
// Full approval controls load when a card is shown, keeping them off the initial Home bundle.
import { CalendarPlusIcon, CircleCheckBigIcon, MailIcon, SparklesIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "../components/ui/badge";
import { toastManager } from "../components/ui/toast";
import { requestConfirmDialog } from "../confirmDialog";
import { ApprovalChoices } from "./AldoApprovalChoices";
import { ApprovalBody, toastAldoRule } from "./AldoApprovals";
import { ThreadLink } from "./AldoHomeInbox";
import { FOCUS, SECONDARY } from "./surface";
import { AldoApiError } from "./api";
import {
  APPROVAL_KIND_LABEL,
  approvalChoices,
  approvalQuestion,
  placeSaysAll,
  type ApprovalChoice,
} from "./approvals.logic";
import { relativeTime } from "./home.logic";
import type { AldoApproval } from "./homeApi";
import { sendAldoApproval } from "./homeFeed";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const KIND_ICON = {
  email: MailIcon,
  event: CalendarPlusIcon,
  start: SparklesIcon,
  confirm: CircleCheckBigIcon,
} as const;
/**
 * A step's total and place are said in its first choice ("$12.00 to adp.com"), not again above it;
 * a web address with more than its site in it (a seller's page) stays, so the payee is never lost.
 */
const inChoice = (f: { label: string; value: string }) =>
  f.label === "Total" || (f.label === "Where" && placeSaysAll(f.value));
const QUIET_LINK = `${FOCUS} min-h-11 rounded-full px-3 text-sm text-muted-foreground hover:text-foreground`;

export type ApprovalCardProps = {
  readonly approval: AldoApproval;
  readonly now: number;
  readonly onActed: () => void;
  readonly inThread?: boolean;
  /** Home supplies the outer frame and heading. */
  readonly inline?: boolean;
};

export function ApprovalCard(props: ApprovalCardProps) {
  const a = props.approval;
  const Icon = KIND_ICON[a.kind];
  // The choice being sent, by its place; -1 for a reason (Don't allow, because…).
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const acting = useRef(false);
  const sending = busy !== null || a.status === "sending";
  const reasons = a.reasons ?? [];
  const choices = approvalChoices(a);
  const fields = a.kind === "confirm" ? a.fields.filter((f) => !inChoice(f)) : a.fields;
  const no = choices.find((c) => c.decision === "discard");
  // Saying why not: its choices take the rows' place until one is picked, or Back.
  const [sayingWhy, setSayingWhy] = useState(false);
  const whyDoor = useRef<HTMLButtonElement>(null);
  const firstReason = useRef<HTMLButtonElement>(null);
  const wasSayingWhy = useRef(false);
  useEffect(() => {
    // Focus follows the swap, so the keyboard stays where the choice is.
    if (sayingWhy) firstReason.current?.focus();
    else if (wasSayingWhy.current) whyDoor.current?.focus();
    wasSayingWhy.current = sayingWhy;
  }, [sayingWhy]);
  const decide = async (choice: ApprovalChoice, index: number, reason?: string) => {
    const { decision, spendLimit } = choice;
    if (decision === "discard" && a.kind === "email") {
      const confirmed = await (requestConfirmDialog(
        "Discard this draft? It's deleted from your drafts, and isn't sent.",
        { variant: "destructive" },
      ) ?? Promise.resolve(true));
      if (!confirmed) return;
    }
    if (acting.current) return;
    acting.current = true;
    setBusy(index);
    setError(null);
    try {
      const {
        message,
        rule,
        approval: decided,
      } = await sendAldoApproval(a, decision, reason, spendLimit, { afterAccepted: true });
      if (rule) toastAldoRule(message, rule);
      else {
        const expected = decision === "discard" ? "discarded" : "approved";
        if (decided.status === "pending") setError(message);
        toastManager.add({
          type: decided.status === expected ? "success" : "warning",
          title: message,
        });
      }
    } catch (cause) {
      // A card that changed since it was shown comes back as it is now, to look at again.
      const refresh =
        cause instanceof AldoApiError &&
        (cause.body as { decisionChanged?: boolean })?.decisionChanged;
      setError(refresh ? null : messageOf(cause));
      const changed = cause instanceof AldoApiError && cause.status === 409;
      toastManager.add({
        type: changed ? "warning" : "error",
        title: changed ? "Look again" : "Couldn't do that",
        description: messageOf(cause),
      });
    } finally {
      acting.current = false;
      setBusy(null);
      props.onActed();
    }
  };
  const Wrapper = props.inline ? "div" : "li";
  return (
    <Wrapper
      className={
        props.inline ? "min-w-0" : "list-none rounded-xl border border-border/60 bg-card/30 p-3.5"
      }
    >
      <div className="flex items-start gap-2.5">
        {!props.inline ? (
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : null}
        <div className="min-w-0 flex-1">
          {error ? (
            <p role="alert" className="mb-3 text-sm text-destructive-foreground">
              {error}
            </p>
          ) : null}
          {!props.inline ? (
            <>
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
              <p className="mt-1 font-semibold text-[15px] leading-5">{approvalQuestion(a)}</p>
            </>
          ) : null}
          {a.why ? (
            <p className="mt-0.5 text-[14px] text-muted-foreground leading-5">
              {plainCardText(a.why)}
            </p>
          ) : null}
          {fields.length > 0 ? (
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-sm">
              {fields.map((f) => (
                <div key={f.label} className="contents">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="min-w-0 break-words">{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : a.kind !== "confirm" ? (
            <p className="mt-0.5 text-muted-foreground text-xs">{plainCardText(a.summary)}</p>
          ) : null}
          {a.body ? (
            <div className="mt-2 flex flex-col gap-1 rounded-lg border border-border/50 bg-background/40 px-2.5 py-2">
              <ApprovalBody approval={a} lines={6} className="text-sm" />
            </div>
          ) : null}
          {a.failed && a.result ? (
            <p className="mt-2 text-destructive-foreground text-xs">{a.result}</p>
          ) : null}
          {sayingWhy && no ? (
            <div
              role="group"
              aria-label="Why not?"
              className="mt-3 flex flex-col gap-2"
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.stopPropagation();
                setSayingWhy(false);
              }}
            >
              <p className="text-muted-foreground text-xs">
                Why not? The agent is told, and goes on from there.
              </p>
              <div className="flex flex-wrap gap-2">
                {reasons.map((reason, i) => (
                  <button
                    type="button"
                    key={reason}
                    ref={i === 0 ? firstReason : undefined}
                    className={SECONDARY}
                    disabled={sending}
                    onClick={() => void decide(no, -1, reason)}
                  >
                    {reason}
                  </button>
                ))}
                <button
                  type="button"
                  className={QUIET_LINK}
                  disabled={sending}
                  onClick={() => setSayingWhy(false)}
                >
                  Back
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-1">
              <ApprovalChoices
                choices={choices}
                busy={busy}
                disabled={sending}
                onChoose={(choice, index) => void decide(choice, index)}
              />
              {reasons.length > 0 && no ? (
                <button
                  type="button"
                  ref={whyDoor}
                  className={`${QUIET_LINK} self-start`}
                  disabled={sending}
                  onClick={() => setSayingWhy(true)}
                >
                  {no.label}, and say why…
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </Wrapper>
  );
}
