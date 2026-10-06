// Paying for a plan through Stripe, on the Usage page (AldoBilling.tsx).
// Aldo's GET /api/usage says what the user can do (`billing`, which an older
// Aldo leaves out); this decides what the page offers for it, and says it.
// Pure, so it's tested on its own.

import type { AldoWorkspaceUsage, AldoWorkspaceUsageState } from "../state/aldoWorkspaceUsage";

export interface AldoBillingPlan {
  readonly id: string;
  readonly name: string;
  readonly priceCents: number;
  readonly credits: number;
  /** Agents at once. */
  readonly concurrent: number;
}

export interface AldoBilling {
  /** Stripe is set up on this Aldo. */
  readonly enabled: boolean;
  /** The current plan is a Stripe subscription (else set by an admin, complimentary, or none). */
  readonly managed: boolean;
  /** A downgrade that happens when the period ends. */
  readonly pendingPlan: string | null;
  /** The last payment didn't go through. */
  readonly pastDue: boolean;
  readonly plans: readonly AldoBillingPlan[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isAldoBillingPlan(value: unknown): value is AldoBillingPlan {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isCount(value.priceCents) &&
    isCount(value.credits) &&
    isCount(value.concurrent)
  );
}

export function isAldoBilling(value: unknown): value is AldoBilling {
  return (
    isRecord(value) &&
    typeof value.enabled === "boolean" &&
    typeof value.managed === "boolean" &&
    (value.pendingPlan === null || typeof value.pendingPlan === "string") &&
    typeof value.pastDue === "boolean" &&
    Array.isArray(value.plans) &&
    value.plans.every(isAldoBillingPlan)
  );
}

export interface AldoPlanOption {
  readonly plan: AldoBillingPlan;
  readonly current: boolean;
  /** The plan a pending downgrade switches to. */
  readonly pending: boolean;
  /** What choosing it does, when it can be chosen now. */
  readonly change: "upgrade" | "downgrade" | null;
}

export type AldoBillingView =
  /** No plan, or it ended: choose one and pay (Stripe Checkout). */
  | {
      readonly kind: "choose";
      readonly plans: readonly AldoBillingPlan[];
      /** The plan that ended, if one did. */
      readonly ended: string | null;
    }
  /** A Stripe subscription: switch, cancel or resume, and the billing portal. */
  | {
      readonly kind: "managed";
      readonly plan: { readonly id: string; readonly name: string };
      /** Its terms, unless Aldo no longer offers it. */
      readonly current: AldoBillingPlan | null;
      readonly periodEnd: string | null;
      /** A pending downgrade's plan, named by its id if Aldo no longer offers it. */
      readonly pending: { readonly id: string; readonly name: string } | null;
      readonly canceling: boolean;
      readonly pastDue: boolean;
      readonly options: readonly AldoPlanOption[];
    }
  /** Set by an admin: shown, not changed here. */
  | {
      readonly kind: "fixed";
      readonly plan: { readonly id: string; readonly name: string };
      readonly periodEnd: string | null;
    };

/**
 * What the Usage page offers for the user's plan, or null for nothing new: an
 * Aldo without billing, Stripe not set up, or a complimentary account.
 */
export function aldoBillingView(usage: AldoWorkspaceUsage): AldoBillingView | null {
  const billing = usage.billing;
  if (!billing?.enabled) return null;
  if (usage.configured && !usage.metered) return null;
  const plans = billing.plans.toSorted((left, right) => left.priceCents - right.priceCents);
  const ended = usage.period?.status === "canceled";
  if (!usage.configured || usage.plan === null || ended) {
    return { kind: "choose", plans, ended: ended ? (usage.plan?.name ?? null) : null };
  }
  const periodEnd = usage.period?.end ?? null;
  if (!billing.managed) return { kind: "fixed", plan: usage.plan, periodEnd };

  const currentId = usage.plan.id;
  const current = plans.find((plan) => plan.id === currentId) ?? null;
  const pending = billing.pendingPlan
    ? (plans.find((plan) => plan.id === billing.pendingPlan) ?? {
        id: billing.pendingPlan,
        name: billing.pendingPlan,
      })
    : null;
  const canceling = usage.period?.cancelAtPeriodEnd ?? false;
  // Ending or unpaid, the way back is Resume or a payment method, not another plan.
  const switchable = current !== null && !canceling && !billing.pastDue;
  return {
    kind: "managed",
    plan: usage.plan,
    current,
    periodEnd,
    pending,
    canceling,
    pastDue: billing.pastDue,
    options: plans.map((plan) => ({
      plan,
      current: plan.id === currentId,
      pending: plan.id === pending?.id,
      change:
        switchable && plan.id !== currentId && plan.id !== pending?.id
          ? aldoPlanChange(current, plan)
          : null,
    })),
  };
}

/** An upgrade (a pricier plan) starts now; a downgrade when the period ends. */
export function aldoPlanChange(
  from: AldoBillingPlan,
  to: AldoBillingPlan,
): "upgrade" | "downgrade" {
  return to.priceCents > from.priceCents ? "upgrade" : "downgrade";
}

const CREDITS = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** "$20", or "$19.50" when it isn't whole dollars. */
export function formatPlanPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** When the period ends: "on Oct 31", or "at the end of this period" when Aldo didn't say. */
export function onPeriodEnd(iso: string | null): string {
  const date = iso ? new Date(iso) : null;
  return date && Number.isFinite(date.getTime())
    ? `on ${DAY.format(date)}`
    : "at the end of this period";
}

/** A plan card's lines: price, credits, agents at once. */
export function aldoPlanTerms(plan: AldoBillingPlan): readonly string[] {
  return [
    `${formatPlanPrice(plan.priceCents)} a month`,
    `${CREDITS.format(plan.credits)} credits a month`,
    plan.concurrent === 1 ? "1 agent at once" : `${plan.concurrent} agents at once`,
  ];
}

export interface AldoBillingConfirmation {
  readonly title: string;
  readonly description: string;
  readonly confirm: string;
}

/** What the confirmation says an upgrade or a downgrade does. */
export function aldoPlanChangeCopy(
  from: AldoBillingPlan,
  to: AldoBillingPlan,
  periodEnd: string | null,
): AldoBillingConfirmation {
  if (aldoPlanChange(from, to) === "upgrade") {
    return {
      title: `Upgrade to ${to.name}?`,
      description: `${to.name} starts now with ${CREDITS.format(to.credits)} credits and ${aldoPlanTerms(to)[2]}. You're charged ${formatPlanPrice(to.priceCents)} today, minus the unused part of ${from.name}.`,
      confirm: `Upgrade to ${to.name}`,
    };
  }
  return {
    title: `Downgrade to ${to.name}?`,
    description: `Your plan becomes ${to.name} ${onPeriodEnd(periodEnd)}, with ${CREDITS.format(to.credits)} credits a month and ${aldoPlanTerms(to)[2]}. Until then you keep ${from.name}.`,
    confirm: `Downgrade to ${to.name}`,
  };
}

/** What the confirmation says canceling does. */
export function aldoCancelCopy(
  planName: string,
  periodEnd: string | null,
): AldoBillingConfirmation {
  return {
    title: "Cancel your plan?",
    description: `${planName} ends ${onPeriodEnd(periodEnd)}, and you aren't charged again. Until then you keep its credits; after that, cloud agents can't start until you choose a plan again.`,
    confirm: "Cancel plan",
  };
}

/**
 * The line under the heading: the plan, and when it renews (the notice for an
 * ending or switching plan says when). None for a first plan: the credits
 * above say why.
 */
export function aldoPlanSummary(view: AldoBillingView): string | null {
  switch (view.kind) {
    case "choose":
      return view.ended
        ? `Your ${view.ended} plan has ended, so cloud agents can't start. Choose a plan to keep going.`
        : null;
    case "fixed":
      return `${view.plan.name}, set by your Aldo admin. Renews ${onPeriodEnd(view.periodEnd)}.`;
    case "managed": {
      const parts = [view.plan.name];
      if (view.current) parts.push(`${formatPlanPrice(view.current.priceCents)} a month`);
      if (!view.canceling && !view.pending) parts.push(`Renews ${onPeriodEnd(view.periodEnd)}`);
      return parts.join(" · ");
    }
  }
}

/** What a plan change did, for its toast: Aldo says when it takes effect. */
export function aldoPlanChangedCopy(
  planName: string,
  effective: "now" | "period_end",
  periodEnd: string | null,
  kept: boolean,
): string {
  if (kept) return `You're staying on ${planName}`;
  return effective === "now"
    ? `You're on ${planName}`
    : `Your plan becomes ${planName} ${onPeriodEnd(periodEnd)}`;
}

const CHECKOUT_PARAM = "checkout";

/** Back from Stripe Checkout: /usage?checkout=done or =canceled. */
export function aldoCheckoutReturn(search: string): "done" | "canceled" | null {
  const value = new URLSearchParams(search).get(CHECKOUT_PARAM);
  return value === "done" || value === "canceled" ? value : null;
}

/** The query without Checkout's result, to put back in the address bar once it's read. */
export function withoutAldoCheckoutReturn(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(CHECKOUT_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

/**
 * The plan's name once a checkout has landed (Stripe tells Aldo a few seconds
 * after the user is back): a running plan that's a Stripe subscription, and
 * the one that was bought when this tab knows which (until then Aldo can
 * still show the plan the user had).
 */
export function aldoCheckedOutPlan(
  usage: AldoWorkspaceUsage | null,
  bought: string | null,
): string | null {
  if (!usage?.plan || usage.period?.status === "canceled") return null;
  if (bought !== null && usage.plan.id !== bought) return null;
  return usage.billing?.managed === false ? null : usage.plan.name;
}

/**
 * Billing actions wait for a summary that's current: while the page refreshes,
 * or after a refresh failed, the plan shown may not be the plan the user has.
 * And one request at a time.
 */
export function aldoBillingActionsEnabled(
  status: AldoWorkspaceUsageState["status"],
  busy: string | null,
): boolean {
  return status === "ready" && busy === null;
}
