// The Usage page's plan section in Aldo cloud: choose a plan and pay (Stripe
// Checkout), switch, cancel or resume, and Stripe's billing portal. What it
// offers is billing.logic.ts's; an Aldo without billing gets nothing new.

import { useEffect, useState, type ReactNode } from "react";

import { Button } from "../components/ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Spinner } from "../components/ui/spinner";
import { toastManager } from "../components/ui/toast";
import { cn } from "../lib/utils";
import {
  isAldoWorkspaceUsage,
  type AldoWorkspaceUsage,
  type AldoWorkspaceUsageState,
} from "../state/aldoWorkspaceUsage";
import {
  aldoBillingActionsEnabled,
  aldoBillingView,
  aldoCancelCopy,
  aldoCheckedOutPlan,
  aldoCheckoutReturn,
  aldoPlanChangeCopy,
  aldoPlanChangedCopy,
  aldoPlanSummary,
  aldoPlanTerms,
  onPeriodEnd,
  withoutAldoCheckoutReturn,
  type AldoBillingPlan,
} from "./billing.logic";
import {
  AldoApiError,
  aldoBillingPortalUrl,
  cancelAldoPlan,
  changeAldoPlan,
  fetchAldoCloudUsage,
  isAldoCloud,
  startAldoCheckout,
} from "./cloud";

const CHECKOUT_POLL_MS = 2_000;
const CHECKOUT_WAIT_MS = 30_000;

type Confirming =
  | { readonly kind: "change"; readonly from: AldoBillingPlan; readonly to: AldoBillingPlan }
  | { readonly kind: "cancel" };

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The plan this tab sent to Stripe Checkout, to wait for once it's back (Stripe's return URL doesn't say). */
const CHECKOUT_PLAN_KEY = "aldo:checkout-plan";

function rememberCheckoutPlan(plan: string | null): void {
  try {
    if (plan === null) sessionStorage.removeItem(CHECKOUT_PLAN_KEY);
    else sessionStorage.setItem(CHECKOUT_PLAN_KEY, plan);
  } catch {
    // No storage: the return waits for any running Stripe plan instead.
  }
}

function rememberedCheckoutPlan(): string | null {
  try {
    return sessionStorage.getItem(CHECKOUT_PLAN_KEY) || null;
  } catch {
    return null;
  }
}

/** Stripe Checkout's URL for a plan, remembering the plan for the way back. */
async function checkoutUrl(plan: string): Promise<string> {
  const url = await startAldoCheckout(plan);
  rememberCheckoutPlan(plan);
  return url;
}

/**
 * Back from Stripe Checkout (/usage?checkout=done): Stripe tells Aldo a few
 * seconds later, so this waits (up to CHECKOUT_WAIT_MS, however slow Aldo
 * answers) for the plan that was bought to show, says so, and refreshes the
 * page. Either way the query goes from the address bar.
 */
export function useAldoCheckoutReturn(onChanged: (() => void) | undefined): void {
  // Read once, before the effect cleans up (StrictMode runs effects twice).
  const [checkout] = useState(() => {
    const outcome = isAldoCloud ? aldoCheckoutReturn(window.location.search) : null;
    return outcome ? { outcome, bought: rememberedCheckoutPlan() } : null;
  });
  useEffect(() => {
    if (!checkout) return;
    const { pathname, search, hash } = window.location;
    window.history.replaceState(
      window.history.state,
      "",
      `${pathname}${withoutAldoCheckoutReturn(search)}${hash}`,
    );
    if (checkout.outcome !== "done") {
      rememberCheckoutPlan(null);
      return;
    }
    const controller = new AbortController();
    void (async () => {
      const deadline = Date.now() + CHECKOUT_WAIT_MS;
      for (;;) {
        const left = deadline - Date.now();
        if (left <= 0) break;
        const usage = await fetchAldoCloudUsage(
          AbortSignal.any([controller.signal, AbortSignal.timeout(left)]),
        ).catch(() => null);
        if (controller.signal.aborted) return;
        const plan = aldoCheckedOutPlan(
          isAldoWorkspaceUsage(usage) ? usage : null,
          checkout.bought,
        );
        if (plan) {
          rememberCheckoutPlan(null);
          toastManager.add({ type: "success", title: `You're on ${plan}` });
          onChanged?.();
          return;
        }
        if (Date.now() + CHECKOUT_POLL_MS >= deadline) break;
        await sleep(CHECKOUT_POLL_MS);
        if (controller.signal.aborted) return;
      }
      rememberCheckoutPlan(null);
      toastManager.add({
        type: "info",
        title: "Your plan is on its way",
        description: "Stripe hasn't confirmed it to Aldo yet. Refresh in a minute.",
      });
      onChanged?.();
    })();
    return () => controller.abort();
  }, [checkout, onChanged]);
}

/** The plan section under the workspace's credits, when Aldo bills through Stripe. */
export function AldoBillingSection(props: {
  readonly usage: AldoWorkspaceUsage;
  /** The usage summary's state: billing actions wait while it isn't current. */
  readonly status: AldoWorkspaceUsageState["status"];
  readonly onChanged: (() => void) | undefined;
}) {
  const view = aldoBillingView(props.usage);
  /** The one request in flight, by the button that made it. */
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** What the confirmation asks, kept while it closes so its copy doesn't blank mid-animation. */
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Back from Stripe with the browser's back button, the page may be restored as it was left.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(null);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  if (!view) return null;
  const enabled = aldoBillingActionsEnabled(props.status, busy);
  const confirm = (next: Confirming) => {
    setError(null);
    setConfirming(next);
    setConfirmOpen(true);
  };
  const periodEnd = view.kind === "fixed" || view.kind === "managed" ? view.periodEnd : null;

  /** Runs one request at a time; a redirect leaves the button spinning while the page goes. */
  const run = async (key: string, action: () => Promise<string | void>) => {
    if (!enabled) return;
    setBusy(key);
    setError(null);
    try {
      const url = await action();
      if (url) {
        window.location.assign(url);
        return;
      }
      setBusy(null);
    } catch (cause) {
      setError(messageOf(cause));
      setBusy(null);
    }
  };

  const checkout = (plan: AldoBillingPlan) => run(`plan:${plan.id}`, () => checkoutUrl(plan.id));
  const portal = (key: string) => run(key, aldoBillingPortalUrl);
  const changePlan = (to: { readonly id: string; readonly name: string }, kept: boolean) =>
    run(kept ? "keep" : "confirm", async () => {
      let effective: "now" | "period_end";
      try {
        effective = await changeAldoPlan(to.id);
      } catch (cause) {
        // No Stripe subscription after all: pay for the plan instead.
        if (cause instanceof AldoApiError && cause.status === 409) return checkoutUrl(to.id);
        throw cause;
      }
      setConfirmOpen(false);
      toastManager.add({
        type: "success",
        title: aldoPlanChangedCopy(to.name, effective, periodEnd, kept),
      });
      props.onChanged?.();
    });
  const cancel = (resume: boolean) =>
    run(resume ? "resume" : "confirm", async () => {
      await cancelAldoPlan(resume);
      setConfirmOpen(false);
      toastManager.add({
        type: "success",
        title: resume ? "Your plan continues" : `Your plan ends ${onPeriodEnd(periodEnd)}`,
      });
      props.onChanged?.();
    });

  const summary = aldoPlanSummary(view);
  const spinner = (key: string) => (busy === key ? <Spinner className="size-3.5" /> : null);
  const copy =
    confirming?.kind === "change"
      ? aldoPlanChangeCopy(confirming.from, confirming.to, periodEnd)
      : confirming?.kind === "cancel"
        ? aldoCancelCopy(view.kind === "managed" ? view.plan.name : "Your plan", periodEnd)
        : null;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="aldo-plan-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="aldo-plan-heading" className="text-sm font-medium text-foreground">
          {view.kind === "choose" ? "Choose a plan" : "Plan"}
        </h2>
        {view.kind === "managed" ? (
          <div className="flex items-center gap-1.5">
            {view.canceling ? null : (
              <Button
                size="xs"
                variant="ghost"
                disabled={!enabled}
                onClick={() => confirm({ kind: "cancel" })}
              >
                Cancel plan
              </Button>
            )}
            <Button
              size="xs"
              variant="outline"
              disabled={!enabled}
              onClick={() => void portal("portal")}
            >
              {spinner("portal")}
              Manage billing
            </Button>
          </div>
        ) : null}
      </div>

      {view.kind === "managed" && view.pastDue ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning-foreground"
        >
          <span>Your last payment didn't go through. Agents can't start until it does.</span>
          <Button
            size="xs"
            variant="outline"
            disabled={!enabled}
            onClick={() => void portal("payment")}
          >
            {spinner("payment")}
            Update payment method
          </Button>
        </div>
      ) : null}

      {summary ? <p className="text-xs text-muted-foreground">{summary}</p> : null}

      {view.kind === "managed" && view.pending && !view.canceling ? (
        <Notice
          text={`Switches to ${view.pending.name} ${onPeriodEnd(view.periodEnd)}.`}
          action={`Keep ${view.plan.name}`}
          disabled={!enabled}
          spinning={busy === "keep"}
          onAction={() => void changePlan(view.plan, true)}
        />
      ) : null}
      {view.kind === "managed" && view.canceling ? (
        <Notice
          text={`Ends ${onPeriodEnd(view.periodEnd)}.`}
          action="Resume"
          disabled={!enabled}
          spinning={busy === "resume"}
          onAction={() => void cancel(true)}
        />
      ) : null}

      {view.kind === "choose" ? (
        <PlanGrid>
          {view.plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan}>
              <Button
                size="xs"
                disabled={!enabled}
                onClick={() => void checkout(plan)}
                className="self-start"
              >
                {spinner(`plan:${plan.id}`)}
                Choose {plan.name}
              </Button>
            </PlanCard>
          ))}
        </PlanGrid>
      ) : null}
      {view.kind === "managed" ? (
        <PlanGrid>
          {view.options.map((option) => (
            <PlanCard key={option.plan.id} plan={option.plan} current={option.current}>
              {option.current ? (
                <span className="text-xs text-muted-foreground">Current plan</span>
              ) : option.pending ? (
                <span className="text-xs text-muted-foreground">
                  Starts {onPeriodEnd(view.periodEnd)}
                </span>
              ) : option.change && view.current ? (
                <Button
                  size="xs"
                  variant={option.change === "upgrade" ? "default" : "outline"}
                  disabled={!enabled}
                  className="self-start"
                  onClick={() => confirm({ kind: "change", from: view.current!, to: option.plan })}
                >
                  {option.change === "upgrade" ? "Upgrade" : "Downgrade"}
                </Button>
              ) : null}
            </PlanCard>
          ))}
        </PlanGrid>
      ) : null}

      {view.kind === "choose" ? (
        <p className="text-xs text-muted-foreground">
          Past a plan's credits, extra usage is billed by the credit up to a limit you set. Past
          that, agents keep going one at a time, unbilled.
        </p>
      ) : null}
      {props.status === "error" ? (
        <p className="text-xs text-muted-foreground">
          Your plan couldn't be refreshed, so changing it waits. Refresh to try again.
        </p>
      ) : null}
      {error && !confirmOpen ? (
        <p className="text-xs text-destructive-foreground" role="alert">
          {error}
        </p>
      ) : null}

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (open || busy === "confirm") return;
          setConfirmOpen(false);
          setError(null);
        }}
        onOpenChangeComplete={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy?.title}</AlertDialogTitle>
            <AlertDialogDescription>{copy?.description}</AlertDialogDescription>
            {error && confirmOpen ? (
              <p className="text-sm text-destructive-foreground" role="alert">
                {error}
              </p>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="outline" size="sm" />}
              disabled={busy === "confirm"}
            >
              {confirming?.kind === "cancel" ? "Keep plan" : "Cancel"}
            </AlertDialogClose>
            <Button
              size="sm"
              variant={confirming?.kind === "cancel" ? "destructive" : "default"}
              disabled={!enabled}
              onClick={() => {
                if (confirming?.kind === "change") void changePlan(confirming.to, false);
                else if (confirming?.kind === "cancel") void cancel(false);
              }}
            >
              {spinner("confirm")}
              {copy?.confirm}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </section>
  );
}

function PlanGrid(props: { readonly children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-3">{props.children}</div>;
}

function PlanCard(props: {
  readonly plan: AldoBillingPlan;
  readonly current?: boolean;
  readonly children: ReactNode;
}) {
  const [price, ...terms] = aldoPlanTerms(props.plan);
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border px-3 py-3",
        props.current ? "border-foreground/40" : "border-border",
      )}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{props.plan.name}</span>
        <span className="text-base font-medium text-foreground tabular-nums">{price}</span>
        {terms.map((term) => (
          <span key={term} className="text-xs text-muted-foreground tabular-nums">
            {term}
          </span>
        ))}
      </div>
      {props.children}
    </div>
  );
}

function Notice(props: {
  readonly text: string;
  readonly action: string;
  readonly disabled: boolean;
  readonly spinning: boolean;
  readonly onAction: () => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 border border-border px-3 py-2 text-xs text-foreground"
      role="status"
    >
      <span>{props.text}</span>
      <Button size="xs" variant="outline" disabled={props.disabled} onClick={props.onAction}>
        {props.spinning ? <Spinner className="size-3.5" /> : null}
        {props.action}
      </Button>
    </div>
  );
}
