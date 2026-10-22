import { isElectron } from "~/env";
import { isAldoCloud } from "../../aldo/api";
import { aldoSettingsSearchItem, aldoShowsSettingsSearchItem } from "../../aldo/settings.logic";
import { isManagedDevPc } from "../../managedDevPc";
import { isMacPlatform, isWindowsPlatform, normalizeSearchText } from "~/lib/utils";
import { STATIC_KEYBINDING_COMMANDS, type KeybindingCommand } from "@t3tools/contracts";
import type { EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { DEFAULT_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { commandLabel } from "./KeybindingsSettings.logic";
import {
  validateSettingsScopeSearch,
  type ResolvedSettingsScope,
  type SettingsScopeSearch,
} from "./settingsScope";

export type SettingsPath =
  | "/settings/projects"
  | "/settings/general"
  | "/settings/appearance"
  | "/settings/workspace"
  | "/settings/keybindings"
  | "/settings/snap-shot"
  | "/settings/providers"
  | "/settings/integrations"
  | "/settings/source-control"
  | "/settings/instructions"
  | "/settings/skills"
  | "/settings/memory"
  | "/settings/vault"
  | "/settings/shared"
  | "/settings/environments"
  | "/settings/storage"
  | "/settings/connections"
  | "/settings/archived"
  // Aldo's own pages (aldo/settings.logic.ts).
  | "/settings/account"
  | "/settings/agents"
  | "/settings/permissions"
  | "/settings/notifications"
  | "/settings/phone"
  | "/settings/code";

/**
 * Where a setting can be edited. Device-local rows have no scope: they render
 * at every selection. `project-defaults` rows accept project overrides, so
 * they are reachable from any server-backed selection.
 */
export type SettingsSearchScope =
  | "environment"
  | "environment-defaults"
  | "project-defaults"
  | "project"
  | "checkout"
  | "connections";

export interface SettingsSearchItem {
  readonly id: string;
  readonly title: string;
  readonly to: SettingsPath;
  readonly targetId?: string;
  /** Descriptions, option labels, and aliases people may remember instead of the title. */
  readonly searchTerms?: ReadonlyArray<string>;
  readonly scope?: SettingsSearchScope;
  // Its row only renders in the desktop app, so a browser result would land on
  // an anchor that isn't there.
  readonly desktopOnly?: boolean;
  readonly macOnly?: boolean;
  // Its row only renders on Windows desktop, so other desktop platforms must
  // not expose a result that points to a missing anchor.
  readonly windowsOnly?: boolean;
  readonly cloudOnly?: boolean;
  /** Only in Aldo cloud mode, whose page at this path differs from T3's. */
  readonly aldoCloudOnly?: boolean;
  readonly requiresAldoPhone?: boolean;
  /** Its row renders only once Aldo says it has agent inboxes. */
  readonly requiresAldoAgentInbox?: boolean;
  /** Its row renders only on an Aldo that keeps the welcome's answer (aldo/onboarding.ts). */
  readonly requiresAldoOnboarding?: boolean;
  /** Its row renders only once Aldo says its policy takes this rule (aldo/policy.logic.ts). */
  readonly requiresAldoPolicyRule?: string;
  readonly environmentOnly?: boolean;
  readonly providerSettingsOnly?: boolean;
  readonly macProviderSettingsOnly?: boolean;
  readonly localBackendManagementOnly?: boolean;
  readonly localEnvironmentOnly?: boolean;
  readonly wslAvailableOnly?: boolean;
  /**
   * Sorts after every other match. Keybinding commands mirror rows on other
   * surfaces, so "model" must still lead with Default model, not Model Picker.
   */
  readonly secondary?: boolean;
  readonly requiresThreadAutoSettlement?: boolean;
}

export interface SettingsSearchAvailability {
  readonly localEnvironmentDisabled?: boolean;
  readonly hasCloudPublicConfig: boolean;
  readonly hasEnvironment: boolean;
  readonly hasProviderSettingsEnvironment: boolean;
  readonly hasMacProviderSettingsEnvironment: boolean;
  readonly canManageLocalBackend: boolean;
  readonly isWslSettingsRowVisible: boolean;
  readonly hasThreadAutoSettlement: boolean;
  readonly hasAldoPhoneApi?: boolean;
  readonly hasAldoAgentInbox?: boolean;
  readonly hasAldoOnboarding?: boolean;
  /** The rules Aldo's policy takes, once it's said (Settings → Permissions). */
  readonly aldoPolicyRules?: ReadonlyArray<string>;
  /** False for an Aldo account without the developer tools (aldo/developerTools.ts): no Code page. */
  readonly aldoDeveloperTools?: boolean;
}

/**
 * Section labels in sidebar order. The sidebar nav and the search-result
 * subtitles both render from this record, so each label exists once.
 */
export const SETTINGS_SECTION_LABELS: Readonly<Record<SettingsPath, string>> = {
  "/settings/projects": "Project",
  "/settings/general": "General",
  "/settings/appearance": "Appearance",
  "/settings/workspace": "Workspace",
  "/settings/keybindings": "Keybindings",
  "/settings/snap-shot": "SnapShots",
  // Aldo: what runs the agents, and where code lives, in the words people use.
  "/settings/providers": isAldoCloud ? "AI subscriptions" : "Providers",
  "/settings/integrations": "Integrations",
  "/settings/source-control": isAldoCloud ? "Git hosts" : "Source Control",
  // Aldo: one page, in tabs.
  "/settings/instructions": isAldoCloud ? "Personalization" : "Instructions",
  "/settings/skills": isAldoCloud ? "Personalization" : "Skills",
  "/settings/memory": isAldoCloud ? "Personalization" : "Memory",
  "/settings/vault": "Vault",
  "/settings/shared": "Shared files",
  "/settings/environments": "Environments",
  "/settings/storage": "Storage",
  "/settings/connections": isManagedDevPc ? "Server connections" : "Connections",
  "/settings/archived": "Archive",
  "/settings/account": "Account",
  "/settings/agents": "Models",
  "/settings/permissions": "Permissions",
  "/settings/notifications": "Notifications",
  "/settings/phone": "Phone",
  "/settings/code": "Code",
};

/** Anchor id of the first row bound to `command` on the Keybindings page. */
export function keybindingSearchAnchorId<Command extends KeybindingCommand>(command: Command) {
  return `keybinding-${command}` as const;
}

/**
 * One result per built-in command, alphabetical by label. The anchor is
 * the command's first row; default keys are searchable so "mod+b" lands on
 * Sidebar: Toggle. A command with no default binding may have no row, so it
 * points at the section instead.
 */
const KEYBINDING_SEARCH_ITEMS = STATIC_KEYBINDING_COMMANDS.toSorted((left, right) =>
  commandLabel(left).localeCompare(commandLabel(right)),
).map((command) => {
  const defaultKeys = DEFAULT_KEYBINDINGS.filter((binding) => binding.command === command).map(
    (binding) => binding.key,
  );
  return {
    id: keybindingSearchAnchorId(command),
    title: commandLabel(command),
    to: "/settings/keybindings" as const,
    searchTerms: [command, ...defaultKeys],
    secondary: true,
    ...(defaultKeys.length === 0 ? { targetId: "keybindings" } : {}),
  };
});

/**
 * Searchable settings and stable destinations, in result order. Rows with a
 * dedicated anchor render their id and title via `searchableSetting`; items
 * that may not be mounted point at their nearest stable section instead.
 */
export const SETTINGS_SEARCH_ITEMS = [
  {
    id: "storage-worktrees",
    title: "Worktree cleanup",
    to: "/settings/storage",
    scope: "project-defaults",
    searchTerms: [
      "disk storage delete deleted archived threads old inactive merged unchanged worktrees retention days project inherit off custom",
    ],
  },
  {
    id: "storage-artifacts",
    title: "Artifacts and logs",
    to: "/settings/storage",
    scope: "environment-defaults",
    searchTerms: ["disk storage browser screenshots captures rotated logs cleanup retention"],
  },
  {
    id: "project-defaults",
    title: "Project defaults and overrides",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: ["model workspace environments projects inheritance checkout"],
  },
  {
    id: "project-overview",
    title: "Project overview",
    to: "/settings/projects",
    searchTerms: ["name icon emoji image checkout remove delete"],
  },
  {
    id: "default-model",
    title: "Default model",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: ["new thread project provider reasoning effort"],
  },
  {
    id: "default-permissions",
    title: "Permissions",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: [
      "new thread default runtime mode supervised approvals auto accept edits full access",
    ],
  },
  {
    id: "color-scheme",
    title: "Color scheme",
    to: "/settings/appearance",
    searchTerms: ["appearance light dark system mode"],
    // The scheme tiles sit at the top of the Appearance section.
    targetId: "appearance",
  },
  {
    id: "theme",
    title: "Themes",
    to: "/settings/appearance",
    searchTerms: ["appearance colors palette custom import"],
    // Theme cards live directly under the scheme tiles; the section is the
    // stable scroll destination for both.
    targetId: "appearance",
  },
  {
    // Prefixed because the slider control already owns the `appearance-contrast` id.
    id: "setting-appearance-contrast",
    title: "Contrast",
    to: "/settings/appearance",
    searchTerms: ["colors borders interface"],
  },
  {
    // Prefixed because the slider control already owns the `glass-opacity` id.
    id: "setting-glass-opacity",
    title: "Glass opacity",
    to: "/settings/appearance",
    searchTerms: ["transparent transparency solid menus dialogs composer"],
  },
  {
    id: "diff-color-scheme",
    title: "Diff colors",
    to: "/settings/appearance",
    searchTerms: ["red green blue orange additions deletions changes counts palette colorblind"],
  },
  {
    id: "chat-width",
    title: "Chat width",
    to: "/settings/appearance",
    searchTerms: ["wide full width column layout messages composer monitor"],
  },
  {
    id: "panel-animations",
    title: "Panel animations",
    to: "/settings/appearance",
  },
  {
    id: "environment-identification",
    title: "Environment identification",
    to: "/settings/appearance",
    searchTerms: ["dev nightly artwork pill label hide none"],
    // The setting is stage-dependent, so its parent section is the stable destination.
    targetId: "appearance-interface",
  },
  {
    id: "interface-font",
    title: "Interface font",
    to: "/settings/appearance",
    searchTerms: ["typography family size system sans"],
  },
  {
    id: "prompt-font",
    title: "Prompt font",
    to: "/settings/appearance",
    searchTerms: ["typography family size composer input"],
  },
  {
    id: "code-font",
    title: "Code font",
    to: "/settings/appearance",
    searchTerms: ["typography family size monospace code blocks diffs file previews"],
  },
  {
    id: "terminal-font",
    title: "Terminal font",
    to: "/settings/appearance",
    searchTerms: ["typography family size monospace output"],
  },
  {
    id: "font-smoothing",
    title: "Font smoothing",
    to: "/settings/appearance",
    searchTerms: ["typography text grayscale anti aliasing macos thin"],
    macOnly: true,
  },
  {
    id: "word-wrap",
    title: "Word wrap",
    to: "/settings/appearance",
    searchTerms: ["long lines code blocks tables diffs file previews"],
  },
  {
    id: "aldo-notifications",
    title: "Notifications on this device",
    to: "/settings/notifications",
    searchTerms: ["push alerts notify phone browser finished needs you"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-notification-sound",
    title: "Play a sound when a thread finishes or needs you",
    to: "/settings/notifications",
    searchTerms: ["notifications chime sound audio alert"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-simple-mode",
    title: "Layout",
    to: "/settings/appearance",
    searchTerms: ["simple mode rail sidebar hide threads just aldo needs you library full view"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-interests",
    title: "What you hand Aldo",
    to: "/settings/general",
    searchTerms: [
      "interests welcome starters ideas home developer tools code pull requests terminal diff",
    ],
    aldoCloudOnly: true,
    requiresAldoOnboarding: true,
  },
  {
    id: "project-grouping",
    title: "Project grouping",
    to: "/settings/general",
    searchTerms: ["combine matching repositories environments sidebar"],
  },
  {
    id: "working-shelf",
    title: "Working section (beta)",
    to: "/settings/general",
    searchTerms: ["hide fold running monitoring threads inbox sidebar shelf"],
  },
  {
    id: "auto-settle-inactive-threads",
    title: "Auto-settle inactive threads",
    to: "/settings/general",
    searchTerms: ["sidebar inactivity days no activity automatically"],
    requiresThreadAutoSettlement: true,
    scope: "project-defaults",
  },
  {
    id: "auto-settle-merged-threads",
    title: "Auto-settle merged threads",
    to: "/settings/general",
    searchTerms: ["pull request merge closed automatically sidebar"],
    requiresThreadAutoSettlement: true,
    scope: "project-defaults",
  },
  {
    id: "days-before-auto-settle",
    title: "Days of inactivity before auto-settle",
    to: "/settings/general",
    targetId: "auto-settle-inactive-threads",
    searchTerms: ["thread timeout activity sidebar"],
    requiresThreadAutoSettlement: true,
    scope: "project-defaults",
  },
  {
    id: "thread-notifications",
    title: "Thread notifications",
    to: "/settings/general",
    searchTerms: ["notification sound alert completion input approval desktop"],
  },
  {
    id: "in-app-notifications",
    title: "In-app notifications",
    to: "/settings/general",
    searchTerms: ["notification toast popup completion input approval failure"],
  },
  {
    id: "time-format",
    title: "Time format",
    to: "/settings/general",
    searchTerms: ["timestamp clock locale system browser os 12 hour 24 hour"],
  },
  {
    id: "response-streaming",
    title: "Response streaming",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: ["output token paragraph buffered wait turn legacy"],
  },
  {
    id: "hide-whitespace-changes",
    title: "Hide whitespace changes",
    to: "/settings/general",
    searchTerms: ["diff ignore spaces edits default"],
  },
  {
    id: "default-diff-file-state",
    title: "Default diff file state",
    to: "/settings/general",
    searchTerms: ["collapsed expanded collapse expand files pull request pr code tab"],
  },
  {
    id: "diff-layout",
    title: "Diff layout",
    to: "/settings/general",
    searchTerms: ["stacked split side by side unified inline view"],
  },
  {
    id: "proactive-panels",
    title: "Proactive panels",
    to: "/settings/general",
    searchTerms: ["automatically open diff pull request pr right panel agent completion"],
  },
  {
    id: "skills-in-slash-menu",
    title: "Show skills in slash menu",
    to: "/settings/general",
    searchTerms: ["command menu dollar $ slash /"],
  },
  {
    id: "composer-rich-text",
    title: "Rich text composer",
    to: "/settings/general",
    searchTerms: ["composer rich text tiptap bold italic markdown styled wysiwyg"],
  },
  {
    id: "composer-collapse",
    title: "Collapse composer on scroll",
    to: "/settings/general",
    searchTerms: ["composer rest resting scroll wheel conversation timeline shrink minimize"],
  },
  {
    id: "send-shortcut",
    title: "Send shortcut",
    to: "/settings/general",
    searchTerms: ["enter return command ctrl multiline prompt new line composer"],
  },
  {
    id: "follow-up-behavior",
    title: "Follow-up behavior",
    to: "/settings/general",
    searchTerms: ["queue steer running turn send default behavior composer"],
  },
  {
    id: "provider-update-checks",
    title: "Provider update checks",
    to: "/settings/general",
    searchTerms: ["installed cli versions newer available codex claude cursor grok opencode"],
    scope: "environment-defaults",
  },
  {
    id: "continue-threads-after-server-update",
    title: "Continue threads after restarts",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: [
      "resume running active interrupted work restart reboot machine crash desktop update automatically",
    ],
  },
  {
    id: "background-activity",
    title: "Background activity",
    to: "/settings/general",
    scope: "environment-defaults",
    searchTerms: [
      "balanced performance battery saver advanced git fetch provider health refresh host power monitor idle policy",
    ],
  },
  {
    id: "new-threads",
    title: "New threads",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: ["default workspace mode draft local worktree"],
  },
  {
    id: "worktree-submodules",
    title: "Submodules",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: ["git submodule init recursive top-level none worktree t3.json"],
  },
  {
    id: "start-from-origin",
    title: "Start from origin",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: ["new worktrees latest matching remote branch local"],
  },
  {
    id: "add-project-starts-in",
    title: "Add project starts in",
    to: "/settings/general",
    scope: "environment-defaults",
    searchTerms: ["base directory folder browser path home"],
  },
  {
    id: "unpin-confirmation",
    title: "Unpin confirmation",
    to: "/settings/general",
    searchTerms: ["ask before thread pinned section"],
  },
  {
    id: "archive-confirmation",
    title: "Archive confirmation",
    to: "/settings/general",
    searchTerms: ["ask before thread second click inline action"],
  },
  {
    id: "delete-confirmation",
    title: "Delete confirmation",
    to: "/settings/general",
    searchTerms: ["ask before thread chat history"],
  },
  {
    id: "quit-confirmation",
    title: "Quit shortcut",
    to: "/settings/general",
    searchTerms: ["confirmation desktop app exit direct hold double click press twice"],
    desktopOnly: true,
  },
  {
    id: "text-generation-model",
    title: "Text generation model",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: ["generated thread titles source control content default provider"],
  },
  {
    id: "diagnostics",
    title: "Diagnostics",
    to: "/settings/general",
    searchTerms: ["logs traces processes resource history failures spans cpu memory"],
  },
  {
    id: "open-source-licenses",
    title: "Open source licenses",
    to: "/settings/general",
  },
  {
    id: "legacy-plan-mode",
    title: "Plan mode (legacy)",
    to: "/settings/general",
    searchTerms: ["build plan composer old"],
  },
  {
    id: "legacy-context-window-indicator",
    title: "Context window indicator (legacy)",
    to: "/settings/general",
    searchTerms: ["composer meter usage tokens circle old"],
  },
  {
    id: "legacy-sidebar",
    title: "Sidebar (legacy)",
    to: "/settings/general",
    searchTerms: ["project thread tree old flat list"],
  },
  {
    id: "keybindings",
    title: "Keybindings",
    to: "/settings/keybindings",
    searchTerms: ["keyboard shortcuts hotkeys commands bindings json"],
  },
  ...KEYBINDING_SEARCH_ITEMS,
  {
    id: "snap-shot-enabled",
    title: "SnapShots",
    searchTerms: ["window capture screenshot"],
    to: "/settings/snap-shot",
  },
  {
    id: "snap-shot-accessibility",
    title: "Include app text",
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
    searchTerms: [
      "capture accessibility data text UI structure elements privacy omit agent context",
    ],
  },
  {
    id: "snap-shot-shortcut",
    title: "Capture shortcut",
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
  },
  {
    id: "snap-shot-sound",
    title: "Capture sound",
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
  },
  {
    id: "snap-shot-flash",
    title: "Capture flash",
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
  },
  {
    id: "snap-shot-animations",
    title: "Capture animations",
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
  },
  {
    id: "providers",
    title: isAldoCloud ? "AI subscriptions" : "Providers",
    to: "/settings/providers",
    searchTerms: [
      "agents cli codex claude cursor grok opencode antigravity google sign in sign out install subscription instances authentication api key models configuration binary path config directory endpoint arguments environment variables display name accent color custom favorite hidden auto compact",
    ],
  },
  {
    id: "usage-providers",
    title: "Usage providers",
    to: "/settings/providers",
    searchTerms: [
      "usage sources CLIProxyAPI CLI proxy hub quota subscription limits management key add remove",
    ],
    providerSettingsOnly: true,
  },
  {
    id: "cursor-keychain-usage",
    title: "Cursor account usage",
    to: "/settings/providers",
    searchTerms: ["cursor macOS keychain usage tokens cost limits permission"],
    providerSettingsOnly: true,
    macProviderSettingsOnly: true,
  },
  {
    id: "provider-health-check-interval",
    title: "Health check interval",
    to: "/settings/providers",
    searchTerms: ["refresh availability versions auth state models background probes seconds off"],
    providerSettingsOnly: true,
  },
  {
    id: "aldo-integration-microsoft",
    title: "Microsoft",
    to: "/settings/connections",
    searchTerms: [
      "integrations accounts connect disconnect onedrive sharepoint excel office 365 work school personal",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-integration-link",
    title: "Link",
    to: "/settings/connections",
    searchTerms: [
      "link wallet stripe payments pay card credit debit buy purchase checkout approve approval spend connect disconnect",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-agent-inbox",
    title: "Your agents' email",
    to: "/settings/connections",
    searchTerms: [
      "agent inbox email address mail handle claim agentmail aldomail sender name display name from rename",
    ],
    aldoCloudOnly: true,
    requiresAldoAgentInbox: true,
  },
  {
    id: "aldo-phone",
    title: "Text and call Aldo",
    to: "/settings/phone",
    searchTerms: ["phone sms mms voice call text number verification pin disconnect"],
    aldoCloudOnly: true,
    requiresAldoPhone: true,
  },
  {
    id: "aldo-apps",
    title: "Apps",
    to: "/settings/connections",
    searchTerms: [
      "apps mcp server connectors plugins connect disconnect zapier notion linear jira confluence atlassian airtable canva granola stripe paypal webflow supabase sentry hugging face",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-instructions",
    title: "Instructions",
    to: "/settings/instructions",
    searchTerms: [
      "instructions every project agents read preferences conventions how I like things done remember rules",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-memory",
    title: "Memory",
    to: "/settings/memory",
    searchTerms: ["memory remembered facts what agents know about me notes forget"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-vault",
    title: "Vault",
    to: "/settings/vault",
    searchTerms: [
      "vault secrets api keys tokens passwords logins saved credentials environment variables files",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-shared",
    title: "Shared files",
    to: "/settings/shared",
    searchTerms: [
      "library shared files pages links public only me stop sharing unshare what agents made share_file",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-environments",
    title: "Environments",
    to: "/settings/code",
    searchTerms: [
      "environments ready-to-go setup install build workspace computer prebuilt dependencies",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-skills",
    title: "Skills",
    to: "/settings/skills",
    searchTerms: [
      "skills how agents do a task steps feedback do avoid teach save_skill skill.md new edit remove",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-generators",
    title: "Image, video and audio",
    to: "/settings/connections",
    searchTerms: [
      "generators media generation ai video image audio voice music speech api key runway higgsfield luma fal replicate elevenlabs flux black forest labs kling minimax hailuo ideogram veo imagen sora gpt image",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-integration-google",
    title: "Google",
    to: "/settings/connections",
    searchTerms: [
      "integrations accounts connect disconnect gmail mail calendar contacts drive docs sheets",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-account",
    title: "Account",
    to: "/settings/account",
    searchTerms: ["profile name email picture password two-step verification devices manage"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-plan",
    title: "Plan and billing",
    to: "/settings/account",
    searchTerms: [
      "subscription upgrade downgrade cancel credits extra usage limit invoices receipts payment method card",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-subscription-limits",
    title: "AI subscription limits",
    to: "/settings/account",
    searchTerms: ["claude codex chatgpt grok weekly limit resets usage left quota"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-sign-out",
    title: "Sign out",
    to: "/settings/account",
    searchTerms: ["log out leave this device"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-subagents",
    title: "Helper models",
    to: "/settings/agents",
    searchTerms: ["subagents helpers model reasoning effort claude code codex"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-provider-limit",
    title: "When a subscription runs out mid-task",
    to: "/settings/agents",
    searchTerms: ["usage limit reached mid-task wait reset switch model"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-context-budget",
    title: "Conversation length",
    to: "/settings/agents",
    searchTerms: ["long conversations context budget compact compaction tokens summarize"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-accounts",
    title: "Sign up for sites",
    to: "/settings/permissions",
    searchTerms: [
      "accounts in your name sign up signup register create account profile listing terms login vault ask me first never",
    ],
    aldoCloudOnly: true,
    requiresAldoPolicyRule: "accounts",
  },
  {
    id: "aldo-publishing",
    title: "Publish",
    to: "/settings/permissions",
    searchTerms: ["publishing for you post listing page go live public show me first"],
    aldoCloudOnly: true,
    requiresAldoPolicyRule: "publishing",
  },
  {
    id: "aldo-spend-threshold",
    title: "Spending limit",
    to: "/settings/permissions",
    searchTerms: ["money spend without asking threshold dollars purchase buy approve budget"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-paid-fallback",
    title: "Go past your plans' limits",
    to: "/settings/permissions",
    searchTerms: ["pay extra usage credits paid fallback model routing subscription"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-merge",
    title: "Merge pull requests",
    to: "/settings/permissions",
    searchTerms: ["auto merge approve checks pass"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-merge-method",
    title: "Merge method",
    to: "/settings/permissions",
    searchTerms: ["squash rebase merge commit repository pull request"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-reviews",
    title: "Automated reviews",
    to: "/settings/permissions",
    searchTerms: ["codex reviewer findings comments fix"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-media-routing",
    title: "Choosing a tool",
    to: "/settings/permissions",
    searchTerms: ["image video audio media generation choose ask default tool"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-always-allowed",
    title: "Always allowed",
    to: "/settings/permissions",
    searchTerms: ["approval rules always allow without asking remove"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-brief",
    title: "Daily brief",
    to: "/settings/notifications",
    searchTerms: ["morning brief time push notification what needs you today off"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-heads-ups",
    title: "Heads-ups from Aldo",
    to: "/settings/notifications",
    searchTerms: [
      "mail calendar events half hour what's worth knowing quiet hours night other apps tell me about don't tell me",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-preload",
    title: "Have agents ready",
    to: "/settings/general",
    searchTerms: ["speed preload start computer wake open thread faster waiting"],
    aldoCloudOnly: true,
  },
  {
    id: "agent-browser-access",
    title: "Agent browser access",
    to: "/settings/integrations",
    scope: "project-defaults",
    searchTerms: ["allow disable enable open drive preview tools sessions project override"],
  },
  {
    id: "device-hosts",
    title: "Device hosts",
    to: "/settings/integrations",
    searchTerms: ["ssh remote simulator emulator ios android mac mini identity key connection"],
  },
  {
    id: "agent-device-access",
    title: "Agent device access",
    to: "/settings/integrations",
    targetId: "devices",
    searchTerms: ["allow simulator emulator ios android drive tools sessions"],
  },
  {
    id: "device-hub",
    title: "Device hub",
    to: "/settings/integrations",
    targetId: "devices",
    searchTerms: ["simulator emulator ios android install start"],
  },
  {
    id: "device-platform-support",
    title: "Simulator support",
    to: "/settings/integrations",
    targetId: "devices",
    searchTerms: ["xcode android studio sdk avd runtime"],
  },
  {
    id: "browser-profiles",
    title: "Browser profiles",
    to: "/settings/integrations",
    targetId: "browser",
  },
  {
    id: "browser-default-profile",
    title: "Default browser profile",
    to: "/settings/integrations",
    targetId: "browser-profiles",
  },
  {
    id: "browser-default-viewport",
    title: "Default browser viewport",
    to: "/settings/integrations",
    searchTerms: ["preview size width height device desktop mobile rotate"],
  },
  {
    id: "browser-default-zoom",
    title: "Default browser zoom",
    to: "/settings/integrations",
    searchTerms: ["preview page scale tabs percent"],
  },
  {
    id: "browser-default-appearance",
    title: "Default browser appearance",
    to: "/settings/integrations",
    searchTerms: ["preview color scheme light dark system os"],
  },
  {
    id: "browser-recording-frame-rate",
    title: "Browser recording frame rate",
    to: "/settings/integrations",
  },
  {
    id: "browser-recording-key-presses",
    title: "Show key presses in recordings",
    to: "/settings/integrations",
    searchTerms: ["browser preview keyboard shortcuts keystrokes overlay capture"],
  },
  {
    id: "browser-recording-mouse-presses",
    title: "Show mouse presses in recordings",
    to: "/settings/integrations",
    searchTerms: ["browser preview clicks buttons drag overlay capture"],
  },
  {
    id: "browser-link-target",
    title: "Open links in",
    to: "/settings/integrations",
    searchTerms: ["links default browser in-app browser external open"],
  },
  {
    id: "browser-auto-show-floating-preview",
    title: "Auto-show floating preview",
    to: "/settings/integrations",
    searchTerms: ["agent opens browser device simulator pop into view hide"],
  },
  {
    id: "automatic-pull",
    title: "Automatically pull",
    to: "/settings/source-control",
    scope: "project-defaults",
    searchTerms: ["auto pull default branch current checkout fast forward upstream"],
  },
  {
    id: "pull-request-merge-method",
    title: "Default merge method",
    to: "/settings/source-control",
    scope: "project-defaults",
    searchTerms: ["pull request merge squash rebase last selected"],
  },
  {
    id: "source-control",
    title: isAldoCloud ? "Git hosts" : "Source control",
    to: "/settings/source-control",
    // Aldo's Git hosts are the account's, at any selection.
    ...(isAldoCloud ? {} : { scope: "environment-defaults" }),
    searchTerms: [
      // Aldo has no Forgejo or Gitea hosts.
      isAldoCloud
        ? "version control git github gitlab bitbucket azure devops hosting integrations credentials scan server environment"
        : "version control git github gitlab forgejo gitea tea codeberg bitbucket azure devops hosting integrations credentials scan server environment",
    ],
  },
  {
    id: "git-fetch-interval",
    title: "Git fetch interval",
    to: "/settings/source-control",
    searchTerms: [
      "automatic remote branch refresh background credentials security keys seconds off",
    ],
    environmentOnly: true,
    scope: "environment-defaults",
  },
  {
    id: "bitbucket-credentials",
    title: "Bitbucket credentials",
    to: "/settings/source-control",
    searchTerms: ["bitbucket atlassian access token api token email credentials sign in"],
    environmentOnly: true,
    scope: "environment-defaults",
  },
  {
    id: "source-control-writing-style",
    title: "Source control writing style",
    to: "/settings/source-control",
    searchTerms: [
      "repository conventions conventional commits custom instructions change descriptions request titles",
    ],
    environmentOnly: true,
  },
  {
    id: "follow-change-request-templates",
    title: "Follow change request templates",
    to: "/settings/source-control",
    searchTerms: ["repository pr pull request description structure"],
    environmentOnly: true,
  },
  {
    id: "source-control-writer-model",
    title: "Source control writer model",
    to: "/settings/source-control",
    searchTerms: [
      "override generated commit change request pr titles descriptions branch bookmark",
    ],
    environmentOnly: true,
    scope: "project-defaults",
  },
  {
    id: "project-actions",
    title: "Actions",
    to: "/settings/projects",
    searchTerms: ["commands scripts setup run dev server checkout worktree t3.json import"],
  },
  {
    id: "environment-icon",
    title: "Environment icon",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: ["machine glyph sidebar mac mini studio laptop desktop server cloud vm"],
    localBackendManagementOnly: true,
  },
  {
    id: "local-environment",
    title: "Local environment",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: ["turn off on disable enable local server agents remote only restart"],
    desktopOnly: true,
  },
  {
    id: "network-access",
    title: "Network access",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: ["expose backend remote pairing local machine interfaces host restart"],
    localBackendManagementOnly: true,
  },
  {
    id: "tailscale-https",
    title: "Tailscale HTTPS",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: ["serve magicdns endpoint remote secure network"],
    desktopOnly: true,
    localBackendManagementOnly: true,
  },
  {
    id: "wsl-backend",
    title: "WSL backend",
    to: "/settings/connections",
    searchTerms: [
      "windows subsystem linux distro second server projects stop windows backend restart",
    ],
    desktopOnly: true,
    windowsOnly: true,
    localBackendManagementOnly: true,
    wslAvailableOnly: true,
  },
  {
    id: "t3-connect",
    localEnvironmentOnly: true,
    title: "T3 Connect",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: ["managed tunnel cloud other devices remote"],
    desktopOnly: true,
    cloudOnly: true,
  },
  {
    id: "publish-agent-activity",
    localEnvironmentOnly: true,
    title: "Publish agent activity",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: ["mobile push notifications live activities cloud tunnel"],
    cloudOnly: true,
  },
  {
    id: "connections-environment",
    title: "This machine",
    to: "/settings/connections",
    searchTerms: [
      "connections server backend local remote access administrative permissions scope pairing links qr code authorized clients sessions revoke endpoint",
    ],
  },
  {
    id: "remote-environments",
    title: "Environments",
    to: "/settings/connections",
    searchTerms: ["add pair backend host code ssh config agent tunnel saved t3 connect"],
  },
  {
    id: "load-balancing",
    title: "Load balancing",
    to: "/settings/connections",
    searchTerms: [
      "automatic machine environment resources cpu memory capacity preference weight shared projects",
    ],
  },
  {
    id: "github-routing",
    title: "GitHub sharing",
    to: "/settings/connections",
    searchTerms: ["pull request trusted environments shared credentials permissions read actions"],
  },
  {
    id: "archive",
    title: "Archived threads",
    to: "/settings/archived",
    searchTerms: ["restore reopen deleted history projects"],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;

export type SettingsSearchItemId = (typeof SETTINGS_SEARCH_ITEMS)[number]["id"];

const SEARCH_ITEMS_BY_ID = new Map(SETTINGS_SEARCH_ITEMS.map((item) => [item.id, item] as const));

const SETTINGS_CATEGORY_SCOPES: Readonly<Record<SettingsPath, SettingsSearchScope | null>> = {
  "/settings/projects": "project",
  "/settings/general": null,
  "/settings/appearance": null,
  "/settings/workspace": null,
  "/settings/snap-shot": null,
  // Keybindings fan out to the selection; Providers shows the representative
  // environment at any selection. Neither needs a particular scope to render.
  "/settings/keybindings": null,
  "/settings/providers": null,
  "/settings/integrations": null,
  "/settings/source-control": isAldoCloud ? null : "environment-defaults",
  // Aldo's own pages are the account's, at any selection.
  "/settings/instructions": null,
  "/settings/skills": null,
  "/settings/memory": null,
  "/settings/vault": null,
  "/settings/shared": null,
  "/settings/environments": null,
  "/settings/storage": "project-defaults",
  "/settings/connections": "connections",
  "/settings/archived": "project-defaults",
  "/settings/account": null,
  "/settings/agents": null,
  "/settings/permissions": null,
  "/settings/notifications": null,
  "/settings/phone": null,
  "/settings/code": null,
};

/** Search keeps the selected target. A missing row can explain its owning scope instead. */
export function getSettingsSearchTargetScope(targetId: string) {
  const items: readonly SettingsSearchItem[] = SETTINGS_SEARCH_ITEMS;
  const item =
    items.find((candidate) => candidate.id === targetId) ??
    items.find((candidate) => candidate.targetId === targetId);
  return item
    ? {
        title: item.title,
        scope: item.scope ?? SETTINGS_CATEGORY_SCOPES[item.to],
        ...(item.requiresThreadAutoSettlement ? { requiresThreadAutoSettlement: true } : {}),
      }
    : null;
}

interface AutoSettlementSearchEnvironment {
  readonly environmentId: EnvironmentId;
  readonly connection: { readonly phase: EnvironmentConnectionPhase };
  readonly serverConfig: {
    readonly environment: {
      readonly capabilities: { readonly threadAutoSettlement?: boolean };
    };
  } | null;
}

/** Discovery needs one capable environment; the selected page needs every connected target to support it. */
export function getThreadAutoSettlementSearchAvailability(
  environments: readonly AutoSettlementSearchEnvironment[],
  scope?: Pick<ResolvedSettingsScope, "kind" | "environmentIds">,
) {
  const connected = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" && environment.serverConfig !== null,
  );
  const eligibleEnvironmentIds = connected
    .filter(
      (environment) =>
        environment.serverConfig?.environment.capabilities.threadAutoSettlement === true,
    )
    .map((environment) => environment.environmentId);
  const selected = connected.filter((environment) =>
    scope?.environmentIds.includes(environment.environmentId),
  );
  return {
    eligibleEnvironmentIds,
    isTargetAvailable:
      scope !== undefined &&
      scope.kind !== "unavailable" &&
      selected.length > 0 &&
      selected.every((environment) => eligibleEnvironmentIds.includes(environment.environmentId)),
  };
}

export function isSettingsSearchScopeAvailable(
  requiredScope: SettingsSearchScope | null,
  scopeKind: ResolvedSettingsScope["kind"],
): boolean {
  switch (requiredScope) {
    case null:
    case "connections":
      return true;
    case "environment":
    case "checkout":
      return requiredScope === scopeKind;
    case "project":
      return scopeKind === "project" || scopeKind === "checkout";
    case "environment-defaults":
      return scopeKind === "environment" || scopeKind === "all";
    case "project-defaults":
      return (
        scopeKind === "environment" ||
        scopeKind === "all" ||
        scopeKind === "project" ||
        scopeKind === "checkout"
      );
  }
}

function settingsScopeKindFromSearch(search: SettingsScopeSearch): ResolvedSettingsScope["kind"] {
  const target = validateSettingsScopeSearch({ ...search });
  if (target.checkout && !target.project) return "unavailable";
  if (target.project) return target.checkout ? "checkout" : "project";
  return target.machine ? "environment" : "all";
}

export function isSettingsOverviewVisible(search: SettingsScopeSearch): boolean {
  const kind = settingsScopeKindFromSearch(search);
  return kind === "project" || kind === "checkout";
}

/**
 * `id` and `title` props for the element a search item anchors to. Panels
 * spread (or pick from) this instead of restating the strings, so the catalog
 * and the rendered settings cannot drift apart.
 */
export function searchableSetting(id: SettingsSearchItemId): {
  readonly id: string;
  readonly title: string;
} {
  const item = SEARCH_ITEMS_BY_ID.get(id)!;
  // Aldo's words for a row it shows on a page of its own; it keeps the row's id.
  return { id: item.id, title: isAldoCloud ? aldoSettingsSearchItem(item).title : item.title };
}

export function filterAvailableSettingsSearchItems(
  availability: SettingsSearchAvailability,
): ReadonlyArray<SettingsSearchItem> {
  const items: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS;
  return items
    .filter(
      (item) =>
        (!item.cloudOnly || availability.hasCloudPublicConfig) &&
        (!item.environmentOnly || availability.hasEnvironment) &&
        (!item.providerSettingsOnly || availability.hasProviderSettingsEnvironment) &&
        (!item.macProviderSettingsOnly || availability.hasMacProviderSettingsEnvironment) &&
        (!item.localBackendManagementOnly || availability.canManageLocalBackend) &&
        (!item.localEnvironmentOnly || !availability.localEnvironmentDisabled) &&
        (!item.wslAvailableOnly || availability.isWslSettingsRowVisible) &&
        (!item.requiresThreadAutoSettlement || availability.hasThreadAutoSettlement) &&
        (!item.requiresAldoPhone || availability.hasAldoPhoneApi === true) &&
        (!item.requiresAldoAgentInbox || availability.hasAldoAgentInbox === true) &&
        (!item.requiresAldoOnboarding || availability.hasAldoOnboarding === true) &&
        (!item.requiresAldoPolicyRule ||
          availability.aldoPolicyRules?.includes(item.requiresAldoPolicyRule) === true) &&
        // Aldo leaves out T3's pages and rows that don't apply to its machines.
        (isAldoCloud ? aldoShowsSettingsSearchItem(item) : !item.aldoCloudOnly),
    )
    .map((item) => (isAldoCloud ? aldoSettingsSearchItem(item) : item))
    .filter(
      (item) =>
        !isAldoCloud || availability.aldoDeveloperTools !== false || item.to !== "/settings/code",
    );
}

export function searchSettings(
  query: string,
  items: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS,
): ReadonlyArray<SettingsSearchItem> {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return [];
  const queryTokens = normalizedQuery.split(" ");
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;

  return items
    .flatMap((item, index) => {
      if (!isElectron && item.desktopOnly === true) return [];
      if (item.macOnly && !isMacPlatform(platform)) return [];
      if (item.windowsOnly && !isWindowsPlatform(platform)) return [];

      const title = normalizeSearchText(item.title);
      const fields = [
        title,
        normalizeSearchText(SETTINGS_SECTION_LABELS[item.to]),
        ...(item.searchTerms ?? []).map(normalizeSearchText),
      ];
      if (!queryTokens.every((token) => fields.some((field) => field.includes(token)))) return [];

      const exactPhraseField = fields.findIndex((field) => field.includes(normalizedQuery));
      const rank =
        title === normalizedQuery
          ? 5
          : title.startsWith(normalizedQuery)
            ? 4
            : title.includes(normalizedQuery)
              ? 3
              : queryTokens.every((token) => title.includes(token))
                ? 2
                : exactPhraseField >= 0
                  ? 1
                  : 0;
      return [{ item, index, rank }];
    })
    .toSorted(
      (left, right) =>
        Number(left.item.secondary ?? false) - Number(right.item.secondary ?? false) ||
        right.rank - left.rank ||
        left.index - right.index,
    )
    .map(({ item }) => item);
}
