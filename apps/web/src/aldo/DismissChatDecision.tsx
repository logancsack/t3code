import { useState } from "react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { toastManager } from "../components/ui/toast";
import { cn } from "~/lib/utils";
import { NotNowMenu } from "./AldoNotNow";
import { dismissAldoChatDecision, type AldoChatDecision } from "./homeApi";
import { type aldoHiddenFromChat } from "./decisions.logic";
import { refreshAldoHome, setAldoChatDecisionDismissed } from "./homeFeed";
import { backWhen } from "./notNow.logic";
import { tapAldoPlan } from "./planApi";
import { planPutOff, type AldoPlan } from "./plans.logic";
import { FOCUS } from "./surface";

const NOT_NOW_BUTTON = cn(
  FOCUS,
  "shrink-0 whitespace-nowrap rounded-full px-3 py-2 text-[12px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-50 data-popup-open:bg-foreground/[0.05] data-popup-open:text-foreground",
);

/**
 * Separate from deciding: no receipt, answer or message is sent to the thread.
 * "Not now" puts it off until a time (an Aldo that can, `until` in its read),
 * or hides it with no reminder; on an older Aldo, it hides it.
 */
export function DismissChatDecision(props: {
  readonly decision: AldoChatDecision | undefined;
  readonly title: string;
  readonly restore?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const decision = props.decision;
  // Older servers do not advertise dismissal support.
  if (!decision) return null;
  const putOff = async (until: Date) => {
    setBusy(true);
    try {
      await dismissAldoChatDecision(decision.id, true, until);
      setAldoChatDecisionDismissed(decision.id, true, until);
      // Put off already: a read that fails now only leaves the page a moment behind.
      await refreshAldoHome().catch(() => undefined);
      const toast = toastManager.add({
        type: "info",
        title: `Back ${backWhen(until, new Date())}`,
        description: "Still waiting in the thread. Nothing was answered.",
        actionProps: {
          children: "Undo",
          onClick: () => {
            toastManager.close(toast);
            void dismissAldoChatDecision(decision.id, false).then(
              () => {
                setAldoChatDecisionDismissed(decision.id, false);
                return refreshAldoHome();
              },
              () => toastManager.add({ type: "error", title: "Couldn't bring it back" }),
            );
          },
        },
      });
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Couldn't put it off",
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setBusy(false);
    }
  };
  const dismiss = async () => {
    setBusy(true);
    try {
      await dismissAldoChatDecision(decision.id, !props.restore);
      setAldoChatDecisionDismissed(decision.id, !props.restore);
      await refreshAldoHome().catch(() => undefined);
      const toast = toastManager.add({
        type: "info",
        title: props.restore ? "Shown in Aldo chat" : "Hidden from Aldo chat",
        description: "Still waiting in the thread. No answer was sent.",
        actionProps: {
          children: props.restore ? "Hide again" : "Undo",
          onClick: () => {
            toastManager.close(toast);
            void dismissAldoChatDecision(decision.id, Boolean(props.restore)).then(
              () => {
                setAldoChatDecisionDismissed(decision.id, Boolean(props.restore));
                return refreshAldoHome();
              },
              () => toastManager.add({ type: "error", title: "Couldn't show the prompt again" }),
            );
          },
        },
      });
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: props.restore ? "Couldn't show the prompt" : "Couldn't hide the prompt",
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setBusy(false);
    }
  };
  if (!props.restore && decision.until !== undefined)
    return (
      <NotNowMenu
        label={`Not now: ${props.title}`}
        busy={busy}
        className={NOT_NOW_BUTTON}
        onPutOff={(until) => void putOff(until)}
        onHide={() => void dismiss()}
      >
        {busy ? "Putting off…" : "Not now"}
      </NotNowMenu>
    );
  // One put off comes back now; one hidden shows again.
  const early = props.restore && Boolean(decision.until);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={
              props.restore
                ? early
                  ? `Bring back ${props.title} in Aldo chat now`
                  : `Show ${props.title} in Aldo chat again`
                : `Not now: hide ${props.title} from Aldo chat`
            }
            disabled={busy}
            aria-busy={busy || undefined}
            className={NOT_NOW_BUTTON}
            onClick={() => void dismiss()}
          />
        }
      >
        {busy
          ? props.restore
            ? "Showing…"
            : "Hiding…"
          : props.restore
            ? early
              ? "Show now"
              : "Show again"
            : "Not now"}
      </TooltipTrigger>
      <TooltipPopup>
        {props.restore ? "Show in Aldo chat again" : "Hide from Aldo chat without answering"}
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * What the user put off or hid from Aldo's conversation (under Aldo's name,
 * AldoPresence.tsx): what's put off, prompts and plans, each with when it's
 * back and a way to bring it back now; then what's hidden, to show again.
 */
export function AldoHiddenFromChat(props: {
  readonly items: ReturnType<typeof aldoHiddenFromChat>;
  readonly plans?: ReadonlyArray<AldoPlan>;
  readonly now: number;
}) {
  const now = new Date(props.now);
  const putOff = props.items.filter((item) => item.chatDecision.until);
  const plans = (props.plans ?? []).filter((plan) => planPutOff(plan, props.now));
  const hidden = props.items.filter((item) => !item.chatDecision.until);
  const line = "flex items-center gap-2 ps-1.5";
  const back = (until: string, what?: string) => (
    <span className="block truncate text-[12px] text-muted-foreground tabular-nums">
      {what ? `${what} · back` : "Back"} {backWhen(new Date(until), now)}
    </span>
  );
  return (
    <>
      {putOff.length + plans.length > 0 ? (
        <section className="flex flex-col gap-0.5">
          <h3 className="px-1.5 font-medium text-[12px] text-muted-foreground">
            Put off
            <span className="font-normal"> · nothing goes ahead meanwhile</span>
          </h3>
          <ul className="flex flex-col">
            {putOff.map((item) => (
              <li key={item.chatDecision.id} className={cn(line, "py-1")}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{item.title}</span>
                  {back(item.chatDecision.until!)}
                </span>
                <DismissChatDecision decision={item.chatDecision} title={item.title} restore />
              </li>
            ))}
            {plans.map((plan) => (
              <li key={plan.id} className={cn(line, "py-1")}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{plan.goal}</span>
                  {back(plan.deferredUntil!, "Plan")}
                </span>
                <ShowPlanNow plan={plan} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {hidden.length > 0 ? (
        <section className="flex flex-col gap-0.5">
          <h3 className="px-1.5 font-medium text-[12px] text-muted-foreground">
            Hidden from chat
            <span className="font-normal"> · still waiting in their threads</span>
          </h3>
          <ul className="flex flex-col">
            {hidden.map((item) => (
              <li key={item.chatDecision.id} className={line}>
                <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                <DismissChatDecision decision={item.chatDecision} title={item.title} restore />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/** A plan put off, back now: at the conversation's end, waiting for the user's Start. */
function ShowPlanNow(props: { readonly plan: AldoPlan }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Show the plan ${props.plan.goal} now`}
      disabled={busy}
      aria-busy={busy || undefined}
      className={NOT_NOW_BUTTON}
      onClick={() => {
        setBusy(true);
        void tapAldoPlan(props.plan.id, { action: "hold", until: null })
          .then(
            () => refreshAldoHome().catch(() => undefined),
            (cause: unknown) =>
              toastManager.add({
                type: "error",
                title: "Couldn't bring the plan back",
                description: cause instanceof Error ? cause.message : String(cause),
              }),
          )
          .finally(() => setBusy(false));
      }}
    >
      {busy ? "Showing…" : "Show now"}
    </button>
  );
}
