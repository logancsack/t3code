// The plan picker under a request sent before choosing a plan
// (planPicker.logic.ts): Aldo's words, then a card with the plans Aldo offers
// (name, price, what each includes), extra usage where Aldo's Checkout offers
// the choice, and "Continue to payment", which goes to Stripe Checkout and
// comes back to Home. Back, it says "You're on <plan>" while the request goes
// on its own (assistantSession.ts). The card looks like the rest of the
// conversation's (surface.ts).

import { CircleCheckIcon, CheckIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Switch } from "../components/ui/switch";
import { cn } from "~/lib/utils";
import { startAldoCheckout } from "./accountApi";
import { AldoApiError } from "./api";
import {
  noteAldoPickedPlan,
  resumeAldoKept,
  useAldoAssistant,
  type AldoPlanPick,
} from "./assistantSession";
import {
  checkoutFailureWords,
  extraUsageLabel,
  extraUsageOffer,
  pickerLines,
  sendingWords,
  type AldoPickerPlan,
} from "./planPicker.logic";
import { formatPlanPrice } from "./billing.logic";
import { FOCUS, PRIMARY, SECONDARY, SURFACE } from "./surface";
import { useAldoWorkspaceUsage } from "../state/aldoWorkspaceUsage";

/** The picker under the request it's for (`pick`, the session's). */
export function AldoPlanPicker(props: { readonly pick: AldoPlanPick }) {
  const { pick } = props;
  const needs = pick.needs;
  // On a plan now: what the rest of the page shows of it (credits, the plan's name) catches up.
  const { refresh } = useAldoWorkspaceUsage();
  const on = pick.stage === "on";
  useEffect(() => {
    if (on) refresh();
  }, [on, refresh]);
  return (
    <div className="flex flex-col gap-3 self-stretch" data-aldo-plan-picker={pick.stage}>
      {needs?.say ? (
        <p className="max-w-[94%] self-start whitespace-pre-wrap break-words text-[16px] leading-6 sm:text-[15px]">
          {needs.say}
        </p>
      ) : null}
      <article className={cn(SURFACE, "flex w-full flex-col gap-3.5 p-4 sm:p-5")}>
        {needs && pick.stage === "choose" ? (
          <Plans pick={pick} plans={needs.plans} note={needs.note} />
        ) : (
          <Status pick={pick} />
        )}
      </article>
    </div>
  );
}

function Plans(props: {
  readonly pick: AldoPlanPick;
  readonly plans: readonly AldoPickerPlan[];
  readonly note: string;
}) {
  const { pick, plans } = props;
  const [chosen, setChosen] = useState(
    () => plans.find((plan) => plan.name === pick.plan)?.id ?? plans[0]!.id,
  );
  const plan = plans.find((p) => p.id === chosen) ?? plans[0]!;
  const [extra, setExtra] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const replying = useAldoAssistant((s) => s.replying);
  const usage = useAldoWorkspaceUsage().state;
  // Offered only where Aldo's Checkout takes the choice (an older one keeps its own default).
  const offer = extraUsageOffer("usage" in usage ? usage.usage?.billing : null);
  const extraId = useId();
  // Back from Checkout with the browser's back button, the page can come back as it was left.
  useEffect(() => {
    const shown = (event: PageTransitionEvent) => {
      if (event.persisted) setStarting(false);
    };
    window.addEventListener("pageshow", shown);
    return () => window.removeEventListener("pageshow", shown);
  }, []);

  const pay = async () => {
    setStarting(true);
    setError(null);
    try {
      const url = await startAldoCheckout(plan.id, {
        resume: pick.requestId,
        ...(offer !== null && extra ? { extraUsage: true } : {}),
      });
      noteAldoPickedPlan(plan.name);
      // Stripe comes back to Home, which sends the request.
      window.location.assign(url);
    } catch (cause) {
      setStarting(false);
      // A plan's on already (paid in another tab): the request goes now.
      if (cause instanceof AldoApiError && cause.status === 409) {
        await resumeAldoKept();
        return;
      }
      // In words for people: an Aldo that failed sends the payment provider's own message.
      setError(checkoutFailureWords(cause instanceof AldoApiError ? cause : null));
    }
  };

  return (
    <>
      <header className="flex flex-col gap-3">
        <h4 className="text-balance font-semibold text-[16px] leading-[22px] tracking-[-0.01em]">
          Choose a plan to start
        </h4>
        {plans.length > 1 ? (
          <div
            role="radiogroup"
            aria-label="Plan"
            className="flex w-full gap-1 rounded-full bg-foreground/[0.05] p-1 dark:bg-white/[0.06]"
          >
            {plans.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={p.id === plan.id}
                onClick={() => setChosen(p.id)}
                className={cn(
                  FOCUS,
                  "h-9 min-w-0 flex-1 rounded-full px-3 font-medium text-[14px] transition-colors pointer-coarse:h-11",
                  p.id === plan.id
                    ? "bg-background text-foreground shadow-xs dark:bg-white/[0.12]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.name}
              </button>
            ))}
          </div>
        ) : null}
      </header>
      <div className="flex flex-col gap-2.5">
        <p className="font-semibold text-[28px] leading-8 tracking-[-0.02em] tabular-nums">
          {formatPlanPrice(plan.priceCents)}{" "}
          <span className="font-normal text-[14px] text-muted-foreground tracking-normal">
            a month
          </span>
        </p>
        <ul className="flex flex-col gap-1.5 text-[14px] leading-5">
          {pickerLines(plan).map((line) => (
            <li key={line} className="flex items-start gap-2">
              <CheckIcon
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-foreground/55"
                strokeWidth={1.75}
              />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
      {offer !== null ? (
        <div className="flex items-start gap-3 border-foreground/[0.07] border-t pt-3.5 dark:border-white/[0.08]">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <label htmlFor={extraId} className="font-medium text-[14px] leading-5">
              {extraUsageLabel(offer).label}
            </label>
            <p className="text-[13px] text-muted-foreground leading-[18px]">
              {extraUsageLabel(offer).hint}
            </p>
          </div>
          <Switch
            id={extraId}
            checked={extra}
            onCheckedChange={(checked) => setExtra(checked)}
            aria-label="Extra usage"
          />
        </div>
      ) : null}
      <footer className="flex flex-wrap items-center justify-between gap-3">
        <span className="min-w-0 flex-1 text-[13px] text-muted-foreground leading-[18px]">
          {props.note}
        </span>
        <button
          type="button"
          className={PRIMARY}
          disabled={starting || replying}
          onClick={() => void pay()}
        >
          {starting ? (
            <LoaderCircleIcon aria-hidden className="size-4 animate-spin" strokeWidth={1.75} />
          ) : null}
          Continue to payment
        </button>
      </footer>
      {error ? (
        <p role="alert" className="text-[13px] text-destructive-foreground leading-[18px]">
          {error}
        </p>
      ) : null}
    </>
  );
}

/** How the request stands once a plan's chosen: going (back from Checkout, confirming the plan first), sent, or waiting. */
function Status(props: { readonly pick: AldoPlanPick }) {
  const { pick } = props;
  const replying = useAldoAssistant((s) => s.replying);
  if (pick.stage === "on") {
    return (
      <p
        role="status"
        className="flex items-center gap-2 font-medium text-[14px] text-foreground leading-5"
      >
        <CircleCheckIcon aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
        {pick.plan ? `You’re on ${pick.plan}` : "Your plan is on"}
      </p>
    );
  }
  if (pick.stage === "waiting") {
    return (
      <footer className="flex flex-wrap items-center justify-between gap-3">
        <span
          role="status"
          className="min-w-0 flex-1 text-[13px] text-muted-foreground leading-[18px]"
        >
          {pick.note}
        </span>
        <button
          type="button"
          className={SECONDARY}
          disabled={replying}
          onClick={() => void resumeAldoKept()}
        >
          Check again
        </button>
      </footer>
    );
  }
  return (
    <p
      role="status"
      className="flex items-center gap-2 text-[14px] text-muted-foreground leading-5"
    >
      <LoaderCircleIcon aria-hidden className="size-4 shrink-0 animate-spin" strokeWidth={1.75} />
      {sendingWords(pick.checkoutSession)}
    </p>
  );
}
