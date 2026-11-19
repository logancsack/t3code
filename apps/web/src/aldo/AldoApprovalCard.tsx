// Full approval controls load when a card is shown, keeping first-run spending choices off the initial Home bundle.
import { CalendarPlusIcon, CircleCheckBigIcon, MailIcon, SparklesIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { toastManager } from "../components/ui/toast";
import { requestConfirmDialog } from "../confirmDialog";
import { ApprovalBody, toastAldoRule } from "./AldoApprovals";
import { ThreadLink } from "./AldoHomeInbox";
import { FOCUS, PRIMARY, SECONDARY } from "./surface";
import { AldoApiError } from "./api";
import { APPROVAL_KIND_LABEL, approvalQuestion } from "./approvals.logic";
import { relativeTime } from "./home.logic";
import type { AldoApproval } from "./homeApi";
import { sendAldoApproval } from "./homeFeed";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
// Keep unsaved spending choices across a refresh or failed request, without
// granting a rule before the server accepts the decision.
const limitDrafts = new Map<string, { choice: string; custom: string }>();
function keepLimitDraft(id: string, choice: string, custom: string): void {
  if (!limitDrafts.has(id) && limitDrafts.size >= 100)
    limitDrafts.delete(limitDrafts.keys().next().value!);
  limitDrafts.set(id, { choice, custom });
}
const KIND_ICON = {
  email: MailIcon,
  event: CalendarPlusIcon,
  start: SparklesIcon,
  confirm: CircleCheckBigIcon,
} as const;

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const acting = useRef(false);
  const sending = busy || a.status === "sending";
  const reasons = a.reasons ?? [];
  const limitId = useId();
  const [limitChoice, setLimitChoice] = useState(() => limitDrafts.get(a.id)?.choice ?? "");
  const [customLimit, setCustomLimit] = useState(() => limitDrafts.get(a.id)?.custom ?? "");
  const [limitTouched, setLimitTouched] = useState(false);
  const limitText = limitChoice === "custom" ? customLimit : limitChoice;
  const spendLimit = limitText.trim() === "" ? NaN : Number(limitText);
  const validLimit =
    Number.isFinite(spendLimit) &&
    spendLimit >= 0 &&
    Number(spendLimit.toFixed(2)) === spendLimit &&
    Number.isSafeInteger(Math.round(spendLimit * 100));
  // Saying why not: its choices take the buttons' place until one is picked, or Back.
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
  const decide = async (decision: "approve" | "discard" | "always", reason?: string) => {
    if (decision === "approve" && a.spendingLimit && !validLimit) {
      setLimitTouched(true);
      document.getElementById(limitChoice === "custom" ? `${limitId}-custom` : limitId)?.focus();
      return;
    }
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
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError(null);
    try {
      const {
        message,
        rule,
        approval: decided,
      } = a.spendingLimit && decision === "approve"
        ? await sendAldoApproval(a, decision, reason, spendLimit, { afterAccepted: true })
        : await sendAldoApproval(a, decision, reason, undefined, { afterAccepted: true });
      if (decided.status !== "pending") limitDrafts.delete(a.id);
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
      // A draft that changed since it was shown comes back as it is now, to look at again.
      setError(messageOf(cause));
      const changed = cause instanceof AldoApiError && cause.status === 409;
      toastManager.add({
        type: changed ? "warning" : "error",
        title: changed ? "Look again" : "Couldn't do that",
        description: messageOf(cause),
      });
    } finally {
      acting.current = false;
      setBusy(false);
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
              <p className="mt-1 font-medium text-sm">{approvalQuestion(a)}</p>
            </>
          ) : null}
          {a.fields.length > 0 ? (
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-sm">
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
          {a.spendingLimit && !sayingWhy ? (
            <div className="mt-3 flex flex-col gap-2">
              <label htmlFor={limitId} className="font-medium text-sm">
                For future spending, ask me above
              </label>
              <select
                id={limitId}
                aria-describedby={`${limitId}-help`}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={limitChoice}
                disabled={sending}
                onChange={(event) => {
                  setLimitChoice(event.target.value);
                  keepLimitDraft(a.id, event.target.value, customLimit);
                }}
                onBlur={() => setLimitTouched(true)}
              >
                <option value="">Choose a limit in US dollars</option>
                <option value="0">Ask every time</option>
                <option value="20">$20</option>
                <option value="50">$50</option>
                <option value="custom">Another amount…</option>
              </select>
              {limitChoice === "custom" ? (
                <label htmlFor={`${limitId}-custom`} className="flex flex-col gap-1 text-sm">
                  Custom limit (US$)
                  <Input
                    id={`${limitId}-custom`}
                    aria-label="Spending limit in US dollars"
                    aria-describedby={`${limitId}-help`}
                    aria-invalid={limitTouched && !validLimit}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={customLimit}
                    disabled={sending}
                    onChange={(event) => {
                      setCustomLimit(event.target.value);
                      keepLimitDraft(a.id, limitChoice, event.target.value);
                    }}
                    onBlur={() => setLimitTouched(true)}
                  />
                </label>
              ) : null}
              {limitTouched && !validLimit ? (
                <p role="alert" className="text-destructive-foreground text-xs">
                  {limitChoice === "custom"
                    ? "Use zero or a positive amount, with at most two decimal places."
                    : "Choose a spending limit before approving. You can choose to ask every time."}
                </p>
              ) : null}
              <p id={`${limitId}-help`} className="text-muted-foreground text-xs">
                Saved for your account when you approve this step. Zero means ask every time. Your
                other pause points still apply.
              </p>
            </div>
          ) : null}
          {sayingWhy ? (
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
                    onClick={() => void decide("discard", reason)}
                  >
                    {reason}
                  </button>
                ))}
                <button
                  type="button"
                  className={`${FOCUS} min-h-11 rounded-full px-3 text-sm text-muted-foreground hover:text-foreground`}
                  disabled={sending}
                  onClick={() => setSayingWhy(false)}
                >
                  Back
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className={PRIMARY}
                disabled={sending}
                onClick={() => void decide("approve")}
              >
                {sending
                  ? "Working…"
                  : a.spendingLimit
                    ? `${a.approveLabel} and save limit`
                    : a.approveLabel}
              </button>
              <button
                type="button"
                className={SECONDARY}
                disabled={sending}
                onClick={() => void decide("discard")}
              >
                {a.discardLabel}
              </button>
              {a.always ? (
                <button
                  type="button"
                  className={`${FOCUS} min-h-11 rounded-full px-3 text-sm text-muted-foreground hover:text-foreground`}
                  disabled={sending}
                  onClick={() => void decide("always")}
                  aria-label={`${a.approveLabel}, and always allow: ${a.always}`}
                >
                  Always allow…
                </button>
              ) : null}
              {reasons.length > 0 ? (
                <button
                  type="button"
                  ref={whyDoor}
                  className={`${FOCUS} min-h-11 rounded-full px-3 text-sm text-muted-foreground hover:text-foreground`}
                  disabled={sending}
                  onClick={() => setSayingWhy(true)}
                >
                  {a.discardLabel}, because…
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </Wrapper>
  );
}
