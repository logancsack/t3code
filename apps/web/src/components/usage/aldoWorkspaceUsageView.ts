import { isAldoCloud } from "../../aldo/cloud";
import type { AldoUsageAlertLevel, AldoWorkspaceUsage } from "../../state/aldoWorkspaceUsage";

const CREDITS = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const CENTS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const DAY_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatCredits(value: number): string {
  return CREDITS.format(value);
}

export function formatCents(cents: number): string {
  return CENTS.format(cents / 100);
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? DAY.format(date) : "—";
}

function formatDayTime(iso: string): string {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? DAY_TIME.format(date) : "—";
}

/** Copy the Aldo account page uses for the same alert levels, so both surfaces agree. */
export function aldoUsageAlertCopy(
  level: AldoUsageAlertLevel,
  usage?: AldoWorkspaceUsage,
): string | null {
  if (isAldoCloud) return aldoCloudAlertCopy(level, usage);
  switch (level) {
    case "included_warning":
      return "Included credits are running low. Add capacity to keep agents working without interruption.";
    case "included_exhausted":
      return "Included credits are used up. Add capacity to resume new work.";
    case "spend_warning":
      return "This cycle is close to its authorized usage limit.";
    case "spend_reached":
      return "Authorized usage for this cycle is used up. Add capacity to resume new work.";
    default:
      return null;
  }
}

/** What $10 of extra usage buys, when the gateway says what a credit costs. */
function extraUsagePrice(usage?: AldoWorkspaceUsage): string {
  const cents = usage?.bill?.extraCentsPerCredit;
  return cents && cents > 0
    ? `${formatCredits(Math.round(1000 / cents))} credits for $10`
    : "billed by the credit";
}

/** Aldo cloud: extra usage past the plan is allowed up to the limit set here. */
function aldoCloudAlertCopy(level: AldoUsageAlertLevel, usage?: AldoWorkspaceUsage): string | null {
  // Past the limit, a newer gateway keeps agents working one at a time (the economy lane).
  const economy = usage?.credits?.economyRemaining;
  const economyCopy =
    economy !== undefined && economy > 0
      ? `Agents keep working one at a time on the economy lane (${formatCredits(economy)} credits left, not billed); GPU and Windows computers wait.`
      : null;
  switch (level) {
    case "included_warning":
      return `This month's included credits are running low. Past them, agents keep working up to your extra usage limit, ${extraUsagePrice(usage)}.`;
    case "included_exhausted":
      return economyCopy
        ? `This month's included credits are used up, and extra usage is off. ${economyCopy} Set an extra usage limit to run more.`
        : "This month's included credits are used up, and extra usage is off. Set an extra usage limit to keep agents working.";
    case "spend_warning":
      return "Extra usage is close to your limit. Raise it to keep agents working.";
    case "spend_reached":
      return economyCopy
        ? `Your credits and extra usage limit are used up. ${economyCopy} Raise the limit to run more.`
        : "Your credits and extra usage limit are used up, so agents can't start. Raise the limit to keep going.";
    default:
      return null;
  }
}

export interface AldoUsageFact {
  readonly label: string;
  readonly value: string;
}

export function aldoUsageHardwareLabel(machine: AldoWorkspaceUsage["machine"]): string | null {
  if (!machine) return null;
  const rate =
    machine.creditsPerHour === 1 ? "1 credit/hour" : `${machine.creditsPerHour} credits/hour`;
  return `${machine.label} · ${rate}`;
}

/** The metric row under the credit meter, in display order. */
export function aldoUsageFacts(usage: AldoWorkspaceUsage): readonly AldoUsageFact[] {
  const facts: AldoUsageFact[] = [];
  if (usage.plan && usage.credits && usage.bill) {
    facts.push(
      {
        label: "Plan",
        value: `${usage.plan.name} · ${formatCredits(usage.plan.includedCredits)} included`,
      },
      { label: "Included left", value: formatCredits(usage.credits.includedRemaining) },
      {
        label: isAldoCloud ? "Extra usage left" : "Added capacity left",
        value: formatCredits(usage.credits.overageRemaining),
      },
      ...(usage.credits.economyRemaining !== undefined &&
      usage.credits.used >= usage.credits.authorized
        ? [{ label: "Economy lane left", value: formatCredits(usage.credits.economyRemaining) }]
        : []),
      {
        label: "Projected at renewal",
        value:
          usage.credits.projected === null
            ? "—"
            : `${formatCredits(usage.credits.projected)} credits`,
      },
      { label: "Estimated total", value: formatCents(usage.bill.estimatedCents) },
    );
  }
  const hardware = aldoUsageHardwareLabel(usage.machine);
  if (hardware) facts.push({ label: "Hardware", value: hardware });
  return facts;
}

/** Fraction of authorized credits already used, clamped for a meter. */
export function aldoUsageMeterFraction(
  credits: NonNullable<AldoWorkspaceUsage["credits"]>,
): number {
  if (credits.authorized <= 0) return credits.used > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, credits.used / credits.authorized));
}

/** "Updated Sep 3, 10:00 AM · Resets Sep 15", dropping whichever half is unknown. */
export function aldoUsageFootnote(usage: AldoWorkspaceUsage): string | null {
  const parts: string[] = [];
  if (usage.updatedAt) parts.push(`Updated ${formatDayTime(usage.updatedAt)}`);
  if (usage.period) {
    parts.push(
      usage.period.cancelAtPeriodEnd
        ? `Ends ${formatDay(usage.period.end)}`
        : `Resets ${formatDay(usage.period.end)}`,
    );
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Why there are no credit numbers to show, when there are none. */
export function aldoUsageUnmeteredCopy(usage: AldoWorkspaceUsage): string {
  if (isAldoCloud) {
    return usage.configured
      ? "Your account is complimentary, so compute isn't metered."
      : "You don't have a plan yet, so cloud agents can't start. Ask your Aldo admin for one.";
  }
  return usage.configured
    ? "This workspace is complimentary, so compute is not metered."
    : "Usage billing is not configured for this environment.";
}
