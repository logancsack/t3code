import { isAldoCloud } from "../../aldo/api";
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

const MB = 1024 ** 2;
const GB = 1024 ** 3;

/** "1.2 GB", or "340 MB" under a gigabyte (Aldo counts a GB as 1024³ bytes). */
export function formatBytes(bytes: number): string {
  return bytes >= GB ? `${CREDITS.format(bytes / GB)} GB` : `${CREDITS.format(bytes / MB)} MB`;
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
  // Past the limit, a newer gateway keeps agents on the user's own subscriptions working one at a time (the economy lane).
  const economy = usage?.credits?.economyRemaining;
  const economyCopy =
    economy !== undefined && economy > 0
      ? `Agents on your own AI subscriptions keep working one at a time on the economy lane (${formatCredits(economy)} credits left, not billed); GPU and Windows computers wait.`
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

function aldoUsageHardwareLabel(machine: AldoWorkspaceUsage["machine"]): string | null {
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
      ...(usage.credits.aiIncluded !== undefined && usage.credits.aiRemaining !== undefined
        ? [
            {
              label: "Aldo's models left",
              value: `${formatCredits(usage.credits.aiRemaining)} of ${formatCredits(usage.credits.aiIncluded)}`,
            },
          ]
        : []),
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
  const prime = usage.prime;
  if (prime) {
    const of = (use: { readonly used: number; readonly included: number }) =>
      `${formatCredits(use.used)} of ${formatCredits(use.included)}`;
    facts.push(
      { label: "Aldo's deep asks", value: of(prime.deepAsks) },
      { label: "Voice minutes", value: of(prime.voiceMinutes) },
      { label: "Texts with Aldo", value: of(prime.texts) },
      { label: "Quick replies", value: `${prime.quickReplies.usedPercent}% of fair use` },
    );
  }
  if (usage.storage) {
    facts.push({
      label: "Storage",
      value: `${formatBytes(usage.storage.usedBytes)} of ${formatBytes(usage.storage.includedBytes)}`,
    });
  }
  const hardware = aldoUsageHardwareLabel(usage.machine);
  if (hardware) facts.push({ label: "Hardware", value: hardware });
  return facts;
}

/** What a stopped Windows computer's kept disk costs, and when it goes if the plan can't pay for it. */
export function aldoWindowsDiskCopy(disk: NonNullable<AldoWorkspaceUsage["windowsDisk"]>): string {
  const rate =
    disk.creditsPerHour === 1 ? "1 credit" : `${formatCredits(disk.creditsPerHour)} credits`;
  const kept = `Your Windows computer's disk is kept for next time, at ${rate} an hour.`;
  return disk.deletedOn
    ? `${kept} Your plan can't pay for it now, so it's deleted on ${disk.deletedOn} unless it has room by then.`
    : kept;
}

/** Fraction of authorized credits already used, clamped for a meter. */
export function aldoUsageMeterFraction(
  credits: NonNullable<AldoWorkspaceUsage["credits"]>,
): number {
  if (credits.authorized <= 0) return credits.used > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, credits.used / credits.authorized));
}

type AldoUsageCredits = NonNullable<AldoWorkspaceUsage["credits"]>;

/**
 * What of the plan's own credits is used, from what's left of them
 * (`includedRemaining`; `remaining` can count extra usage's too), so the two
 * add up to what it includes, and what extra usage has added past them (its
 * limit's credits, `authorized` less the plan's, less what's left of it).
 */
function planCreditsUse(credits: AldoUsageCredits) {
  const included = Math.max(0, credits.included);
  const left = Math.min(included, Math.max(0, credits.includedRemaining));
  const extraLimit = Math.max(0, credits.authorized - credits.included);
  return {
    included,
    left,
    used: included - left,
    extraUsed: Math.max(0, extraLimit - Math.max(0, credits.overageRemaining)),
  };
}

/**
 * The line beside "credits left", in words. Aldo cloud: "412 of your plan’s
 * 2,000 credits used this month", then any extra usage ("and 120 more on extra
 * usage"). A managed workspace's gateway counts what's left of all it
 * authorized, so it says that.
 */
export function aldoUsageUsedLine(credits: AldoUsageCredits, cloud = isAldoCloud): string {
  if (!cloud) {
    return `${formatCredits(credits.used)} of ${formatCredits(credits.authorized)} used this cycle`;
  }
  const plan = planCreditsUse(credits);
  const line =
    plan.included <= 0
      ? "Your plan has no credits this month"
      : plan.left <= 0
        ? `All ${formatCredits(plan.included)} of your plan’s credits used this month`
        : `${formatCredits(plan.used)} of your plan’s ${formatCredits(plan.included)} credits used this month`;
  const extra = formatCredits(plan.extraUsed);
  if (extra === "0") return line;
  return plan.included > 0
    ? `${line}, and ${extra} more on extra usage`
    : `${line}; ${extra} used on extra usage`;
}

/**
 * The meter under it: what of the plan's credits is used (Aldo cloud), or of
 * all authorized, with the line above as its words. With nothing to use
 * (none included or authorized), it reads as one of one: full, as "0 credits
 * left" says, never a range of zero to zero.
 */
export function aldoUsageMeter(
  credits: AldoUsageCredits,
  cloud = isAldoCloud,
): {
  readonly label: string;
  readonly value: number;
  readonly max: number;
  readonly fraction: number;
  readonly valueText: string;
} {
  const valueText = aldoUsageUsedLine(credits, cloud);
  if (!cloud) {
    const fraction = aldoUsageMeterFraction(credits);
    return credits.authorized > 0
      ? {
          label: "Credits used this cycle",
          value: Math.min(credits.used, credits.authorized),
          max: credits.authorized,
          fraction,
          valueText,
        }
      : { label: "Credits used this cycle", value: fraction, max: 1, fraction, valueText };
  }
  const plan = planCreditsUse(credits);
  return plan.included > 0
    ? {
        label: "Your plan’s credits used this month",
        value: plan.used,
        max: plan.included,
        fraction: plan.used / plan.included,
        valueText,
      }
    : { label: "Your plan’s credits used this month", value: 1, max: 1, fraction: 1, valueText };
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
    if (usage.configured) return "Your account is complimentary, so compute isn't metered.";
    return usage.billing?.enabled
      ? "You don't have a plan yet, so agents can't start. Choose one below."
      : "You don't have a plan yet, so agents can't start. Ask your Aldo admin for one.";
  }
  return usage.configured
    ? "This workspace is complimentary, so compute is not metered."
    : "Usage billing is not configured for this environment.";
}

/** "about 900": a projection rounded to what it can promise. */
function roughly(credits: number): string {
  const step = credits >= 1000 ? 100 : credits >= 100 ? 10 : 1;
  return formatCredits(Math.max(0, Math.round(credits / step) * step));
}

/**
 * The usage page's first line, in words: "You've used 412 of 2,000 credits
 * this month; at this pace you'll have about 900 left." Null without credits
 * (an unmetered plan says so below).
 */
export function aldoUsageSentence(usage: AldoWorkspaceUsage): string | null {
  const credits = usage.credits;
  if (!credits) return null;
  const used = `You've used ${formatCredits(credits.used)} of ${formatCredits(credits.included)} credits this month`;
  if (credits.projected === null) return `${used}.`;
  if (credits.projected <= credits.included)
    return `${used}; at this pace you'll have about ${roughly(credits.included - credits.projected)} left.`;
  if (credits.projected <= credits.authorized)
    return `${used}; at this pace you'll go about ${roughly(credits.projected - credits.included)} over, within your extra usage limit.`;
  const economy = credits.economyRemaining;
  if (economy !== undefined && economy > 0)
    return `${used}; at this pace you'll use them up before the month ends, and agents on your own AI subscriptions then keep working one at a time on the economy lane.`;
  return `${used}; at this pace you'll run out before the month ends.`;
}
