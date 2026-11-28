// Aldo's settings: its pages in its nav's groups, which of T3's pages and rows
// it leaves out or moves to one of its own, for the settings nav and search (a
// search result must not lead to a page or row that isn't there), and the
// settings scope Aldo keeps.

import { createContext } from "react";

import {
  validateSettingsScopeSearch,
  type SettingsScopeSearch,
} from "../components/settings/settingsScope";
import type { SettingsPath } from "../components/settings/settingsSearch";
import { isAldoCloud } from "./api";

/** Remounts the settings page after this device's settings are reset, so its fields reread them. */
export const AldoSettingsRestoredContext = createContext<(() => void) | undefined>(undefined);

/** Pages only Aldo has: T3's own nav and search leave them out. */
export const ALDO_SETTINGS_PATHS: ReadonlySet<string> = new Set([
  "/settings/account",
  "/settings/organization",
  "/settings/members",
  "/settings/running",
  "/settings/activity",
  "/settings/joining",
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
 * Aldo's nav, in two non-overlapping groups: Account & billing sits above it
 * (from its own card), and each entry stays lit on the sub-pages it opens onto
 * (About you's tabs, Preferences' shortcuts and licenses). Projects appears
 * when the user has at least one project; Code appears only when Developer
 * tools is on.
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
    group: "How Aldo works",
    items: [
      { to: "/settings/agents", label: "Models" },
      { to: "/settings/permissions", label: "Permissions" },
      {
        to: "/settings/instructions",
        label: "About you",
        also: ["/settings/memory", "/settings/skills"],
      },
      {
        to: "/settings/notifications",
        label: "Notifications & phone",
        also: ["/settings/phone"],
      },
    ],
  },
  {
    group: "Tools & app",
    items: [
      { to: "/settings/connections", label: "Connections" },
      { to: "/settings/vault", label: "Vault" },
      {
        to: "/settings/general",
        label: "Preferences",
        also: ["/settings/appearance", "/settings/keybindings", "/settings/open-source-licenses"],
      },
      { to: "/settings/code", label: "Code" },
    ],
  },
];

const ABOUT_YOU = {
  title: "About you",
  intro: "What agents know about you, the rules they follow and the playbooks you’ve saved.",
} as const;

/**
 * Each page's name and one line on what it's for, at its top (and in the
 * phone's bar). Pages that aren't in the nav have one too, so none opens on a
 * bare section.
 */
const ALDO_SETTINGS_PAGES: Readonly<
  Record<string, { readonly title: string; readonly intro: string }>
> = {
  "/settings/account": {
    title: "Account & billing",
    intro: "Your profile, plan, credits, extra usage cap and computers.",
  },
  "/settings/organization": {
    title: "Organization",
    intro: "Your organization’s name, owners and seats.",
  },
  "/settings/members": {
    title: "Members",
    intro:
      "Who’s in your organization and what each person can do. Everyone’s threads, computers and vault stay their own.",
  },
  "/settings/running": {
    title: "Running now",
    intro: "Every machine running in your organization’s threads, priciest first.",
  },
  "/settings/activity": {
    title: "Activity",
    intro: "Each change to your organization, and what its admins did, newest first.",
  },
  "/settings/joining": {
    title: "Who can join",
    intro:
      "The domains your organization proves it owns, what people at them can do, and its invite link.",
  },
  "/settings/agents": {
    title: "Models",
    intro: "Which AI runs your agents, your connected plans and what happens when limits run out.",
  },
  "/settings/permissions": {
    title: "Permissions",
    intro: "Spending limits, what agents may do in your name and what they can run.",
  },
  "/settings/instructions": ABOUT_YOU,
  "/settings/memory": ABOUT_YOU,
  "/settings/skills": ABOUT_YOU,
  "/settings/connections": {
    title: "Connections",
    intro: "Accounts, work apps, agent email, payments and media tools your agents can use.",
  },
  "/settings/vault": {
    title: "Vault",
    intro: "Website logins and API keys your agents use without ever reading the values back.",
  },
  "/settings/notifications": {
    title: "Notifications & phone",
    intro:
      "Quiet hours, push alerts, texting or calling Aldo, fallback emails and proactive updates.",
  },
  "/settings/general": {
    title: "Preferences",
    intro: "How Aldo looks and behaves on this device.",
  },
  "/settings/code": {
    title: "Code",
    intro: "Pull request rules, ready-to-go environments, diffs and code display.",
  },
  "/settings/keybindings": {
    title: "Keyboard shortcuts",
    intro: "Every shortcut Aldo supports on this device.",
  },
  "/settings/open-source-licenses": {
    title: "Licenses",
    intro: "The open-source software Aldo is built with, and its licenses.",
  },
  "/settings/archived": {
    title: "Archived threads",
    intro: "Threads you archived, with their files. Restore one to put it back in your list.",
  },
  "/settings/projects": {
    title: "Projects",
    intro: "Defaults for a specific project. Anything left alone follows your account settings.",
  },
  "/settings/voice": {
    title: "Voice input",
    intro: "Microphone and dictation settings for this device.",
  },
};

/**
 * The nav for this account: Code only with Developer tools, Projects only when
 * the user has at least one project, and a group named after its organization,
 * first, only for someone in one.
 */
export function aldoSettingsNav(options: {
  readonly developer: boolean;
  readonly organization?: string | null;
  readonly hasProjects?: boolean;
}): typeof ALDO_SETTINGS_NAV {
  const showProjects = options.hasProjects === true;
  if (options.developer && !options.organization && !showProjects) return ALDO_SETTINGS_NAV;
  const nav = ALDO_SETTINGS_NAV.map((group) => {
    if (group.group !== "Tools & app") return group;
    const items = group.items.filter((item) => options.developer || item.to !== "/settings/code");
    if (!showProjects) return { ...group, items };
    const codeIndex = items.findIndex((item) => item.to === "/settings/code");
    const projectItem = { to: "/settings/projects" as const, label: "Projects" };
    return {
      ...group,
      items:
        codeIndex === -1
          ? [...items, projectItem]
          : [...items.slice(0, codeIndex), projectItem, ...items.slice(codeIndex)],
    };
  });
  if (!options.organization) return nav;
  return [
    {
      group: options.organization,
      items: [
        { to: "/settings/organization", label: "Organization", also: ["/settings/joining"] },
        {
          to: "/settings/members",
          label: "Members",
          also: ["/settings/running", "/settings/teams"],
        },
        { to: "/settings/activity", label: "Activity" },
      ],
    },
    ...nav,
  ];
}

/** A member's page (orgAdmin.logic.ts): /settings/members/<their id>. */
const MEMBER_PAGE = /^\/settings\/members\/[^/]+$/;
/** A team's page (teams.logic.ts): /settings/teams/<its id>. */
const TEAM_PAGE = /^\/settings\/teams\/[^/]+$/;

/** The page a page sits under, for the way back to it: a member's or team's page and Running now, under Members; Who can join, under Organization; Shortcuts and Licenses, under Preferences. */
export function aldoSettingsParent(pathname: string): {
  readonly to: "/settings/members" | "/settings/organization" | "/settings/general";
  readonly label: string;
} | null {
  const path = pathname.replace(/\/+$/, "");
  if (path === "/settings/joining") return { to: "/settings/organization", label: "Organization" };
  if (path === "/settings/keybindings" || path === "/settings/open-source-licenses") {
    return { to: "/settings/general", label: "Preferences" };
  }
  return MEMBER_PAGE.test(path) || TEAM_PAGE.test(path) || path === "/settings/running"
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
        "Their month: credits, machines and the organization’s threads, by title. What’s in them stays theirs.",
    };
  }
  if (TEAM_PAGE.test(path)) {
    return {
      title: "Team",
      intro:
        "Who’s on it, for invites and usage by team. A team doesn’t change what anyone can do.",
    };
  }
  return ALDO_SETTINGS_PAGES[path] ?? null;
}

/** T3 pages outside Aldo's nav that a thread still links to directly. */
const ALDO_LINKED_SETTINGS_PATHS: ReadonlySet<string> = new Set(["/settings/voice"]);

/** Whether Aldo shows a settings page: its own, and the few of T3's a thread links to. */
export function aldoKeepsSettingsPage(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "");
  return (
    path === "/settings" || aldoSettingsPage(path) !== null || ALDO_LINKED_SETTINGS_PATHS.has(path)
  );
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
      if (hash === "aldo-agent-inbox") return `/settings/connections${searchStr}#aldo-agent-inbox`;
      if (hash === "aldo-phone") return `/settings/notifications${searchStr}#aldo-phone`;
      return `/settings/connections${tail}`;
    case "/settings/phone":
      return `/settings/notifications${searchStr}#${hash || "aldo-phone"}`;
    case "/settings/appearance":
      return `/settings/general${tail}`;
    case "/settings/threads":
      return `/settings/general${tail}`;
    case "/settings/scheduled-tasks":
      return "/routines";
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
 * Pages Aldo hides or merged elsewhere.
 */
const ALDO_HIDDEN_SETTINGS_PATHS: ReadonlySet<string> = new Set([
  "/settings/snap-shot",
  "/settings/storage",
  "/settings/integrations",
  "/settings/providers",
  "/settings/source-control",
  "/settings/shared",
  "/settings/environments",
  "/settings/phone",
  "/settings/appearance",
  "/settings/threads",
]);

/** Pages whose T3 content Aldo replaces with its own: of T3's results, only Aldo's or explicitly moved rows stay. */
const ALDO_REPLACED_SETTINGS_PAGES: ReadonlySet<string> = new Set([
  "/settings/connections",
  "/settings/general",
  "/settings/voice",
]);

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
  // Retired or hidden in Aldo's overhauled configuration surface.
  "text-generation-model",
  "skills-in-slash-menu",
  "setting-glass-opacity",
  "environment-identification",
  "separate-fonts",
  "prompt-font",
  "terminal-font",
  "font-smoothing",
  "panel-animations",
  "effort-display",
  "composer-context",
  "math-rendering",
  "thread-details-items",
  "working-shelf",
  "project-order",
  "language",
  "composer-rich-text",
  "unpin-confirmation",
  "archive-confirmation",
  "screen-reader-window-title",
]);

export function aldoHidesSettingsRow(id: string): boolean {
  return ALDO_HIDDEN_SETTINGS_ROWS.has(id);
}

/**
 * T3's rows Aldo shows on a page of its own: the model new threads start on
 * and their access with the agents and the rules, its own words for what
 * runs its agents, device preferences on Preferences, and code-only rows on Code.
 */
const ALDO_MOVED_SETTINGS_ROWS: ReadonlyMap<
  string,
  {
    readonly to: SettingsPath;
    readonly targetId?: string;
    readonly title?: string;
    readonly description?: string;
  }
> = new Map<
  string,
  {
    readonly to: SettingsPath;
    readonly targetId?: string;
    readonly title?: string;
    readonly description?: string;
  }
>([
  [
    "project-defaults",
    { to: "/settings/agents", description: "Default model and permissions for new threads" },
  ],
  [
    "default-model",
    { to: "/settings/agents", description: "Which AI model new threads start with" },
  ],
  [
    "providers",
    {
      to: "/settings/agents",
      targetId: "aldo-subscriptions",
      title: "AI subscriptions and API keys",
      description: "Connect Claude, ChatGPT, Grok, Muse Code, Google Antigravity or OpenCode",
    },
  ],
  [
    "default-permissions",
    {
      to: "/settings/permissions",
      title: "On the agent’s computer",
      description: "Whether agents act freely or ask before running commands and edits",
    },
  ],
  [
    "chat-width",
    {
      to: "/settings/general",
      description: "Readable column width or full width for conversations on desktop",
    },
  ],
  [
    "time-format",
    {
      to: "/settings/general",
      description: "12-hour, 24-hour or your device’s default clock",
    },
  ],
  [
    "send-shortcut",
    {
      to: "/settings/general",
      description: "Choose whether Enter or Command+Enter sends a message",
    },
  ],
  [
    "delete-confirmation",
    {
      to: "/settings/general",
      title: "Confirm before deleting a thread",
      description: "Ask before permanently deleting a thread",
    },
  ],
  [
    "screen-reader-announcements",
    {
      to: "/settings/general",
      description: "Read thread updates and activity aloud for screen readers",
    },
  ],
  [
    "open-source-licenses",
    {
      to: "/settings/general",
      title: "Open-source licenses",
      description: "Licenses for open-source packages used in Aldo",
    },
  ],
  [
    "hide-whitespace-changes",
    { to: "/settings/code", description: "Ignore whitespace-only edits in code diffs" },
  ],
  [
    "default-diff-file-state",
    { to: "/settings/code", description: "Start files expanded or collapsed in diffs" },
  ],
  [
    "diff-layout",
    { to: "/settings/code", description: "Stacked or side-by-side code diff layout" },
  ],
  [
    "diff-color-scheme",
    { to: "/settings/code", description: "Color palette for additions and deletions in diffs" },
  ],
  [
    "proactive-panels",
    {
      to: "/settings/code",
      description: "Automatically open pull requests and changes when an agent finishes",
    },
  ],
  [
    "pull-request-links-open-in-app",
    {
      to: "/settings/code",
      title: "Open pull requests in Aldo",
      description: "Open pull request links inside Aldo instead of a new browser tab",
    },
  ],
  [
    "code-font",
    { to: "/settings/code", description: "Monospace font family and size for code and diffs" },
  ],
  ["word-wrap", { to: "/settings/code", description: "Wrap long lines in code blocks and diffs" }],
  [
    "terminal-close-confirmation",
    { to: "/settings/code", description: "Ask before closing a terminal tab" },
  ],
  [
    "source-control",
    {
      to: "/settings/connections",
      targetId: "aldo-connections",
      title: "Code hosts",
      description: "Connect GitHub, GitLab, Bitbucket or Azure DevOps",
    },
  ],
]);

/** Shortcuts to views Aldo leaves out: Usage's Limits tab. */
export const ALDO_HIDDEN_KEYBINDING_COMMANDS: ReadonlySet<string> = new Set(["usage.limits"]);

export function aldoShowsSettingsSearchItem(item: {
  readonly id: string;
  readonly to: string;
  readonly aldoCloudOnly?: boolean;
}): boolean {
  if (ALDO_HIDDEN_SETTINGS_ROWS.has(item.id)) return false;
  if (ALDO_MOVED_SETTINGS_ROWS.has(item.id)) return true;
  if (item.aldoCloudOnly === true) return true;
  if (ALDO_HIDDEN_SETTINGS_PATHS.has(item.to)) return false;
  if (ALDO_REPLACED_SETTINGS_PAGES.has(item.to)) return false;
  if (!aldoKeepsSettingsPage(item.to)) return false;
  // A shortcut's result is its row on the Keybindings page (keybindingSearchAnchorId).
  if (ALDO_HIDDEN_KEYBINDING_COMMANDS.has(item.id.replace(/^keybinding-/, ""))) return false;
  return true;
}

/** A search result as Aldo shows it: on the page its row is on in Aldo. */
export function aldoSettingsSearchItem<
  Item extends {
    readonly id: string;
    readonly to: SettingsPath;
    readonly title: string;
    readonly description?: string;
  },
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
 * that machine sleeps. A project's own settings are on its page (Projects);
 * everywhere else they're the account's, whatever project a link carried.
 */
export function aldoSettingsScopeSearch(
  search: SettingsScopeSearch,
  pathname?: string,
): SettingsScopeSearch {
  if (pathname !== undefined && !ALDO_PROJECT_PAGES.has(pathname.replace(/\/+$/, ""))) return {};
  return validateSettingsScopeSearch({ project: search.project });
}

/** Aldo on a phone opens Settings on its list of pages, as a phone's own settings do. */
export function aldoSettingsOpensOnList(): boolean {
  return isAldoCloud && window.matchMedia("(max-width: 767px)").matches;
}
