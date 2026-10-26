// Aldo's settings: its pages in its nav's groups, which of T3's pages and rows
// it leaves out or moves to one of its own, for the settings nav and search (a
// search result must not lead to a page or row that isn't there), and the
// settings scope Aldo keeps.

import {
  validateSettingsScopeSearch,
  type SettingsScopeSearch,
} from "../components/settings/settingsScope";
import type { SettingsPath } from "../components/settings/settingsSearch";

/** Pages only Aldo has: T3's own nav and search leave them out. */
export const ALDO_SETTINGS_PATHS: ReadonlySet<string> = new Set([
  "/settings/account",
  "/settings/organization",
  "/settings/members",
  "/settings/running",
  "/settings/activity",
  "/settings/agents",
  "/settings/permissions",
  "/settings/instructions",
  "/settings/skills",
  "/settings/memory",
  "/settings/vault",
  "/settings/shared",
  "/settings/environments",
  "/settings/notifications",
  "/settings/phone",
  "/settings/code",
]);

/**
 * Aldo's nav, in groups: its account heads it (from its own card), and each
 * entry stays lit on the pages it opens onto (Personalization's tabs,
 * General's shortcuts and licenses). Archived threads are threads, so the
 * thread list leads to them, not this nav.
 */
export const ALDO_SETTINGS_NAV: ReadonlyArray<{
  readonly group: string;
  readonly items: ReadonlyArray<{
    readonly to: SettingsPath;
    readonly label: string;
    readonly also?: ReadonlyArray<string>;
  }>;
}> = [
  {
    group: "Agents",
    items: [
      { to: "/settings/agents", label: "Models" },
      { to: "/settings/permissions", label: "Permissions" },
      {
        to: "/settings/instructions",
        label: "Personalization",
        also: ["/settings/memory", "/settings/skills"],
      },
    ],
  },
  {
    group: "Accounts",
    items: [
      { to: "/settings/connections", label: "Connections" },
      { to: "/settings/vault", label: "Vault" },
    ],
  },
  {
    group: "App",
    items: [
      { to: "/settings/appearance", label: "Appearance" },
      { to: "/settings/notifications", label: "Notifications" },
      { to: "/settings/phone", label: "Phone" },
      {
        to: "/settings/general",
        label: "General",
        also: ["/settings/keybindings", "/settings/open-source-licenses"],
      },
      { to: "/settings/code", label: "Code" },
    ],
  },
];

const PERSONALIZATION = {
  title: "Personalization",
  intro: "What your agents know about you and how you like things done, in every new thread.",
} as const;

/**
 * Each page's name and one line on what it's for, at its top (and in the
 * phone's bar). Pages that aren't in the nav have one too, so none opens on a
 * bare section.
 */
export const ALDO_SETTINGS_PAGES: Readonly<
  Record<string, { readonly title: string; readonly intro: string }>
> = {
  "/settings/account": {
    title: "Account",
    intro: "Your plan, your credits and how you sign in.",
  },
  "/settings/organization": {
    title: "Organization",
    intro: "Your organization's name, owners and seats.",
  },
  "/settings/members": {
    title: "Members",
    intro:
      "Who's in your organization and what each person can do. Everyone's threads, computers and vault stay their own.",
  },
  "/settings/running": {
    title: "Running now",
    intro: "Every machine running in your organization's threads, priciest first.",
  },
  "/settings/activity": {
    title: "Activity",
    intro: "Each change to your organization, and what its admins did, newest first.",
  },
  "/settings/agents": {
    title: "Models",
    intro:
      "Which AI runs your agents. Aldo's own models come with your plan, and a Claude or ChatGPT plan you already pay for can run them too.",
  },
  "/settings/permissions": {
    title: "Permissions",
    intro:
      "What agents may do without asking you first. Paying, booking and cancelling always wait for your yes.",
  },
  "/settings/instructions": PERSONALIZATION,
  "/settings/memory": PERSONALIZATION,
  "/settings/skills": PERSONALIZATION,
  "/settings/connections": {
    title: "Connections",
    intro:
      "Accounts and apps your agents can use for you. To use a Claude or ChatGPT plan, connect it in Models.",
  },
  "/settings/vault": {
    title: "Vault",
    intro:
      "Keys and logins your agents use without seeing them. Values can't be read back here once they're saved.",
  },
  "/settings/appearance": {
    title: "Appearance",
    intro: "How Aldo looks on this device.",
  },
  "/settings/notifications": {
    title: "Notifications",
    intro: "When Aldo lets you know about your threads, and where.",
  },
  "/settings/phone": {
    title: "Phone",
    intro: "Call or text Aldo from your phone number.",
  },
  "/settings/general": {
    title: "General",
    intro: "How threads, the composer and Home work for you.",
  },
  "/settings/code": {
    title: "Code",
    intro: "For work on code: environments, diffs and pull requests.",
  },
  "/settings/keybindings": {
    title: "Keyboard shortcuts",
    intro: "Every shortcut, and the keys for each. Click one to change it.",
  },
  "/settings/open-source-licenses": {
    title: "Licenses",
    intro: "The open source software Aldo is built with, and its licenses.",
  },
  "/settings/archived": {
    title: "Archived threads",
    intro: "Threads you archived, with their files. Restore one to put it back in your list.",
  },
  "/settings/projects": {
    title: "Project settings",
    intro: "Settings for this project's threads. Anything left alone follows your own.",
  },
};

/**
 * The nav for this account: Code only with the developer tools
 * (developerTools.ts), and a group named after its organization, first, only
 * for someone in one (organization.logic.ts).
 */
export function aldoSettingsNav(options: {
  readonly developer: boolean;
  readonly organization?: string | null;
}): typeof ALDO_SETTINGS_NAV {
  const nav = options.developer
    ? ALDO_SETTINGS_NAV
    : ALDO_SETTINGS_NAV.map((group) => ({
        ...group,
        items: group.items.filter((item) => item.to !== "/settings/code"),
      }));
  if (!options.organization) return nav;
  return [
    {
      group: options.organization,
      items: [
        { to: "/settings/organization", label: "Organization" },
        { to: "/settings/members", label: "Members", also: ["/settings/running"] },
        { to: "/settings/activity", label: "Activity" },
      ],
    },
    ...nav,
  ];
}

/** A member's page (orgAdmin.logic.ts): /settings/members/<their id>. */
const MEMBER_PAGE = /^\/settings\/members\/[^/]+$/;

/** The page a page sits under, for the way back to it: a member's page and Running now, under Members. */
export function aldoSettingsParent(
  pathname: string,
): { readonly to: "/settings/members"; readonly label: string } | null {
  const path = pathname.replace(/\/+$/, "");
  return MEMBER_PAGE.test(path) || path === "/settings/running"
    ? { to: "/settings/members", label: "Members" }
    : null;
}

/** A page's name and intro, or null for one that has none (a page T3 alone shows). */
export function aldoSettingsPage(
  pathname: string,
): { readonly title: string; readonly intro: string } | null {
  const path = pathname.replace(/\/+$/, "");
  if (MEMBER_PAGE.test(path)) {
    return {
      title: "Member",
      intro:
        "Their month: credits, machines and the organization's threads, by title. What's in them stays theirs.",
    };
  }
  return ALDO_SETTINGS_PAGES[path] ?? null;
}

/** Whether a nav entry is the page shown, or one it opens onto. */
export function aldoSettingsNavActive(
  item: { readonly to: string; readonly also?: ReadonlyArray<string> },
  pathname: string,
): boolean {
  return [item.to, ...(item.also ?? [])].some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/**
 * Where an old page's address leads now, with what it carried (a sign-in's
 * result, a row to scroll to); null for a page that's still where it was.
 */
export function aldoSettingsRedirect(location: {
  readonly pathname: string;
  readonly searchStr: string;
  readonly hash: string;
}): string | null {
  const { pathname, searchStr, hash } = location;
  const tail = `${searchStr}${hash ? `#${hash}` : ""}`;
  switch (pathname.replace(/\/+$/, "")) {
    case "/settings/integrations":
      // The agents' email is a connection now, like everything else here.
      if (hash === "aldo-agent-inbox") return `/settings/connections${searchStr}#aldo-agent-inbox`;
      if (hash === "aldo-phone") return `/settings/phone${searchStr}`;
      return `/settings/connections${tail}`;
    case "/settings/providers":
      return `/settings/agents${tail}`;
    case "/settings/source-control":
      return `/settings/connections${tail}`;
    case "/settings/environments":
      return `/settings/code${tail}`;
    case "/settings/shared":
      return "/library";
    case "/settings/personalization":
      return `/settings/instructions${tail}`;
    default:
      return null;
  }
}

/**
 * Pages Aldo hides: SnapShots needs T3's desktop app; Storage cleans up
 * worktrees and logs that Aldo's machines don't keep. Aldo connects each
 * thread's machine itself, so T3's Connections page is its own connections.
 */
export const ALDO_HIDDEN_SETTINGS_PATHS: ReadonlySet<string> = new Set([
  "/settings/snap-shot",
  "/settings/storage",
  // Its pages moved (aldoSettingsRedirect).
  "/settings/integrations",
  "/settings/providers",
  "/settings/source-control",
  "/settings/shared",
  "/settings/environments",
]);

/** Pages whose T3 content Aldo replaces with its own: of T3's results, only Aldo's stay. */
const ALDO_REPLACED_SETTINGS_PAGES: ReadonlySet<string> = new Set(["/settings/connections"]);

/** Rows Aldo doesn't render, on pages it keeps. */
const ALDO_HIDDEN_SETTINGS_ROWS: ReadonlySet<string> = new Set([
  // Aldo alerts and chimes itself, for every thread, awake or asleep.
  "thread-notifications",
  "in-app-notifications",
  // A follow-up always steers in Aldo.
  "follow-up-behavior",
  // Aldo keeps them on, so model pickers stay current.
  "provider-update-checks",
  // Each thread works in its machine's own checkout, and Add project picks a repository.
  "new-threads",
  "worktree-submodules",
  "start-from-origin",
  "add-project-starts-in",
  // It would inspect, and kill processes on, one arbitrary machine.
  "diagnostics",
  "project-grouping",
  "project-actions",
]);

/**
 * T3's rows Aldo shows on a page of its own: the model new threads start on
 * and their access with the agents and the rules, its own words for what
 * runs its agents, and the code-only rows with Code.
 */
const ALDO_MOVED_SETTINGS_ROWS: ReadonlyMap<
  string,
  { readonly to: SettingsPath; readonly targetId?: string; readonly title?: string }
> = new Map([
  ["project-defaults", { to: "/settings/agents" }],
  ["default-model", { to: "/settings/agents" }],
  ["text-generation-model", { to: "/settings/agents", title: "Thread titles" }],
  ["providers", { to: "/settings/agents", targetId: "aldo-subscriptions" }],
  ["default-permissions", { to: "/settings/permissions", title: "What agents can run" }],
  ["skills-in-slash-menu", { to: "/settings/skills" }],
  ["hide-whitespace-changes", { to: "/settings/code" }],
  ["default-diff-file-state", { to: "/settings/code" }],
  ["diff-layout", { to: "/settings/code" }],
  ["proactive-panels", { to: "/settings/code" }],
  ["source-control", { to: "/settings/connections", targetId: "aldo-connections" }],
]);

/** Shortcuts to views Aldo leaves out: Usage's Limits tab. */
export const ALDO_HIDDEN_KEYBINDING_COMMANDS: ReadonlySet<string> = new Set(["usage.limits"]);

export function aldoShowsSettingsSearchItem(item: {
  readonly id: string;
  readonly to: string;
  readonly aldoCloudOnly?: boolean;
}): boolean {
  if (ALDO_MOVED_SETTINGS_ROWS.has(item.id)) return true;
  if (ALDO_HIDDEN_SETTINGS_PATHS.has(item.to)) return false;
  if (ALDO_REPLACED_SETTINGS_PAGES.has(item.to)) return item.aldoCloudOnly === true;
  // A shortcut's result is its row on the Keybindings page (keybindingSearchAnchorId).
  if (ALDO_HIDDEN_KEYBINDING_COMMANDS.has(item.id.replace(/^keybinding-/, ""))) return false;
  return !ALDO_HIDDEN_SETTINGS_ROWS.has(item.id);
}

/** A search result as Aldo shows it: on the page its row is on in Aldo. */
export function aldoSettingsSearchItem<
  Item extends { readonly id: string; readonly to: SettingsPath; readonly title: string },
>(item: Item): Item {
  const moved = ALDO_MOVED_SETTINGS_ROWS.get(item.id);
  return moved ? { ...item, ...moved } : item;
}

/** Pages that follow a project from the address: a project's own settings, and its archive. */
const ALDO_PROJECT_PAGES: ReadonlySet<string> = new Set([
  "/settings/projects",
  "/settings/archived",
]);

/**
 * Aldo keeps the machines out of sight, so settings apply to a project or to
 * every thread. A machine or checkout scope, which a link or an old URL may
 * still carry, would have no menu to see or clear it, and would stall whenever
 * that machine sleeps. A project's own settings are on its page (Project
 * settings, from its menu in the sidebar); everywhere else they're the
 * account's, whatever project a link carried.
 */
export function aldoSettingsScopeSearch(
  search: SettingsScopeSearch,
  pathname?: string,
): SettingsScopeSearch {
  if (pathname !== undefined && !ALDO_PROJECT_PAGES.has(pathname.replace(/\/+$/, ""))) return {};
  return validateSettingsScopeSearch({ project: search.project });
}
