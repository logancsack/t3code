// The one-line summaries beside each page on a phone's list of settings
// (AldoSettingsHome): what's there now, in a few words. A summary whose data
// hasn't loaded, or couldn't, is null and shows nothing: never an unknown 0.

import type {
  AldoAccount,
  AldoAccountKind,
  AldoApp,
  AldoBriefSettings,
  AldoGitHostKind,
  AldoHeadsUps,
  AldoIntegration,
  AldoInstructions,
  AldoPhoneSettings,
  AldoSkill,
  AldoVaultItem,
} from "./accountApi";
import type { AldoMemoryItem } from "./assistantApi";
import type { AldoHomeUsage, AldoPolicyView } from "./homeApi";

const SUBSCRIPTIONS: ReadonlyArray<readonly [AldoAccountKind | "antigravity", string]> = [
  ["claude", "Claude"],
  ["codex", "ChatGPT"],
  ["grok", "Grok"],
  ["muse", "Muse Code"],
  ["antigravity", "Antigravity"],
];

const CODE_HOSTS: ReadonlyArray<readonly [AldoAccountKind | AldoGitHostKind, string]> = [
  ["github", "GitHub"],
  ["gitlab", "GitLab"],
  ["bitbucket", "Bitbucket"],
  ["azure", "Azure DevOps"],
];

type Accounts = Partial<Record<AldoAccountKind | AldoGitHostKind | "antigravity", AldoAccount>>;

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

function listed(names: ReadonlyArray<string>): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * Models: the subscriptions of theirs that run agents, or else Aldo's own
 * models where this Aldo runs agents on them (`ownModels`, undefined until
 * the plan is known).
 */
export function aldoModelsSummary(
  accounts: Accounts | undefined,
  ownModels: boolean | undefined,
): string | null {
  if (!accounts) return null;
  const connected = SUBSCRIPTIONS.filter(([kind]) => accounts[kind]?.connected).map(
    ([, name]) => name,
  );
  if (connected.length > 0) return listed(connected);
  if (ownModels === undefined) return null;
  return ownModels ? "Aldo’s models" : "None connected";
}

/**
 * Connections: how many there are, or the one that stopped working (it needs
 * the user). Null until accounts, integrations and apps have all answered,
 * since a count from part of them would be wrong. An Aldo without
 * integrations or apps answers null for them, which counts as none.
 */
export function aldoConnectionsSummary(input: {
  readonly accounts: Accounts | undefined;
  readonly integrations: ReadonlyArray<AldoIntegration> | null | undefined;
  readonly apps: { readonly apps: ReadonlyArray<AldoApp> } | null | undefined;
}): { readonly text: string; readonly broken: boolean } | null {
  if (!input.accounts || input.integrations === undefined || input.apps === undefined) return null;
  const connected: string[] = [];
  const broken: string[] = [];
  for (const [kind, name] of CODE_HOSTS) {
    if (input.accounts[kind]?.connected) connected.push(name);
  }
  for (const integration of input.integrations ?? []) {
    if (!integration.connected) continue;
    connected.push(integration.name);
    if (integration.error !== null) broken.push(integration.name);
  }
  for (const app of input.apps?.apps ?? []) {
    // A sign-in under way, or never finished, isn't one agents can use yet.
    if (app.status === "connecting") continue;
    connected.push(app.title);
    if (app.status === "failed") broken.push(app.title);
  }
  if (broken.length === 1) return { text: `${broken[0]} stopped working`, broken: true };
  if (broken.length > 1) return { text: `${broken.length} stopped working`, broken: true };
  if (connected.length === 0) return { text: "None yet", broken: false };
  return { text: `${connected.length} connected`, broken: false };
}

/** Vault: its keys and its logins. */
export function aldoVaultSummary(items: ReadonlyArray<AldoVaultItem> | undefined): string | null {
  if (!items) return null;
  const logins = items.filter((item) => item.kind === "login").length;
  const keys = items.length - logins;
  if (items.length === 0) return "Empty";
  const parts = [
    ...(keys > 0 ? [count(keys, "key", "keys")] : []),
    ...(logins > 0 ? [count(logins, "login", "logins")] : []),
  ];
  return parts.join(", ");
}

/** About you: combined summary of memories, instructions and saved skills. */
export function aldoAboutYouSummary(input: {
  readonly memory: ReadonlyArray<AldoMemoryItem> | undefined;
  readonly instructions: ReadonlyArray<AldoInstructions> | undefined;
  readonly skills: ReadonlyArray<AldoSkill> | undefined;
}): string | null {
  if (
    input.memory === undefined &&
    input.instructions === undefined &&
    input.skills === undefined
  ) {
    return null;
  }
  const parts: string[] = [];
  if (input.memory && input.memory.length > 0) {
    parts.push(count(input.memory.length, "memory", "memories"));
  }
  const filledInstructions = (input.instructions ?? []).filter(
    (item) => item.text.trim().length > 0,
  );
  if (filledInstructions.length > 0) {
    parts.push(count(filledInstructions.length, "rule", "rules"));
  }
  if (input.skills && input.skills.length > 0) {
    parts.push(count(input.skills.length, "skill", "skills"));
  }
  if (parts.length > 0) return parts.slice(0, 2).join(", ");
  if (
    input.memory !== undefined &&
    input.instructions !== undefined &&
    input.skills !== undefined
  ) {
    return "Not set up";
  }
  return null;
}

/** Permissions: spending threshold at a glance. */
export function aldoPermissionsSummary(policy: AldoPolicyView | null | undefined): string | null {
  if (!policy) return null;
  const dollars = policy.everywhere.spendThreshold ?? policy.defaults?.spendThreshold ?? 0;
  if (dollars <= 0) return "Ask before spending";
  const label = Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
  return `Up to ${label}`;
}

/**
 * Phone: the number they call and text from, once it's verified (kept while
 * phones are unavailable, as the Phone page keeps it).
 */
export function aldoPhoneSummary(phone: AldoPhoneSettings | null | undefined): string | null {
  if (!phone) return null;
  if (phone.verified && phone.phone) return phone.phone;
  return phone.available ? "Not set up" : null;
}

/** Notifications & phone: verified phone number or quiet/brief summary. */
export function aldoNotificationsSummary(input: {
  readonly phone: AldoPhoneSettings | null | undefined;
  readonly brief: AldoBriefSettings | null | undefined;
  readonly headsUps: AldoHeadsUps | null | undefined;
}): string | null {
  if (input.phone?.verified && input.phone.phone) return input.phone.phone;
  const tuning = input.headsUps?.tuning;
  if (tuning && tuning.quietStart !== tuning.quietEnd) return "Quiet hours on";
  if (input.brief?.push) {
    const hours = Math.floor(input.brief.minute / 60) % 24;
    const mins = input.brief.minute % 60;
    const h12 = hours % 12 || 12;
    const suffix = hours >= 12 ? "PM" : "AM";
    const time =
      mins === 0 ? `${h12} ${suffix}` : `${h12}:${String(mins).padStart(2, "0")} ${suffix}`;
    return `Brief ${time}`;
  }
  if (input.phone !== undefined || input.brief !== undefined || input.headsUps !== undefined) {
    return "Push & email";
  }
  return null;
}

/** Preferences: light, dark or the device's, and which view. */
export function aldoAppearanceSummary(mode: string, simple: boolean): string {
  const theme = mode === "light" ? "Light" : mode === "dark" ? "Dark" : "System";
  return `${theme}, ${simple ? "simple" : "full"}`;
}

/** The plan's name, or that it ended or its payment failed: the account menu's line. */
export function aldoPlanLabel(usage: AldoHomeUsage | null | undefined): string | null {
  const plan = usage?.plan?.name;
  if (!usage || !plan) return null;
  const status = usage.period?.status;
  if (status === "canceled") return `${plan}, plan ended`;
  if (status === "past_due") return `${plan}, payment failed`;
  return plan;
}

/** The account's line: its plan with what's left, or that the plan ended. */
export function aldoAccountSummary(usage: AldoHomeUsage | null | undefined): string | null {
  const label = aldoPlanLabel(usage);
  if (!usage || label !== usage.plan?.name || !usage.metered || !usage.credits) return label;
  return `${label}, ${usage.credits.remaining.toLocaleString("en-US")} credits left`;
}

/** The plan's name when it has ended, for the banner that says so; null otherwise. */
export function aldoEndedPlan(
  usage:
    | {
        readonly plan: { readonly name: string } | null;
        readonly period: { readonly status: string } | null;
      }
    | null
    | undefined,
): string | null {
  if (!usage?.plan || usage.period?.status !== "canceled") return null;
  return usage.plan.name;
}
