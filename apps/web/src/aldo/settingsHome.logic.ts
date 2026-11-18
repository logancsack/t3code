// The one-line summaries beside each page on a phone's list of settings
// (AldoSettingsHome): what's there now, in a few words. A summary whose data
// hasn't loaded, or couldn't, is null and shows nothing: never an unknown 0.

import type {
  AldoAccount,
  AldoAccountKind,
  AldoApp,
  AldoGitHostKind,
  AldoIntegration,
  AldoPhoneSettings,
  AldoVaultItem,
} from "./accountApi";
import type { AldoMemoryItem } from "./assistantApi";
import type { AldoHomeUsage } from "./homeApi";

const SUBSCRIPTIONS: ReadonlyArray<readonly [AldoAccountKind, string]> = [
  ["claude", "Claude"],
  ["codex", "ChatGPT"],
  ["grok", "Grok"],
  ["muse", "Muse Code"],
];

const CODE_HOSTS: ReadonlyArray<readonly [AldoAccountKind | AldoGitHostKind, string]> = [
  ["github", "GitHub"],
  ["gitlab", "GitLab"],
  ["bitbucket", "Bitbucket"],
  ["azure", "Azure DevOps"],
];

type Accounts = Partial<Record<AldoAccountKind | AldoGitHostKind, AldoAccount>>;

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

/** Personalization: what agents remember about them. */
export function aldoMemorySummary(items: ReadonlyArray<AldoMemoryItem> | undefined): string | null {
  if (!items) return null;
  return items.length === 0 ? "Nothing yet" : count(items.length, "memory", "memories");
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

/** Appearance: light, dark or the device's, and which layout. */
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
