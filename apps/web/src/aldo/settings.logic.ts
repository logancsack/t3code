// Which of T3's settings pages and rows Aldo leaves out, for the settings nav
// and search (a search result must not lead to a page or row that isn't
// there), and the settings scope Aldo keeps.

import {
  validateSettingsScopeSearch,
  type SettingsScopeSearch,
} from "../components/settings/settingsScope";

/**
 * Pages Aldo hides: it connects each thread's machine itself (Connections);
 * SnapShots needs T3's desktop app; Storage cleans up worktrees and logs that
 * Aldo's machines don't keep.
 */
export const ALDO_HIDDEN_SETTINGS_PATHS: ReadonlySet<string> = new Set([
  "/settings/connections",
  "/settings/snap-shot",
  "/settings/storage",
]);

/** Pages Aldo replaces with its own: of T3's results, only the page itself stays. */
const ALDO_REPLACED_SETTINGS_PAGES: ReadonlyMap<string, string> = new Map([
  ["/settings/providers", "providers"],
  ["/settings/source-control", "source-control"],
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
]);

export function aldoShowsSettingsSearchItem(item: {
  readonly id: string;
  readonly to: string;
  readonly aldoCloudOnly?: boolean;
}): boolean {
  if (ALDO_HIDDEN_SETTINGS_PATHS.has(item.to)) return false;
  // Its Integrations page lists accounts instead of the preview browser's settings.
  if (item.to === "/settings/integrations") return item.aldoCloudOnly === true;
  const page = ALDO_REPLACED_SETTINGS_PAGES.get(item.to);
  if (page !== undefined) return item.id === page;
  return !ALDO_HIDDEN_SETTINGS_ROWS.has(item.id);
}

/**
 * Aldo keeps the machines out of sight, so settings apply to a project or to
 * every thread. A machine or checkout scope, which a link or an old URL may
 * still carry, would have no menu to see or clear it, and would stall whenever
 * that machine sleeps.
 */
export function aldoSettingsScopeSearch(search: SettingsScopeSearch): SettingsScopeSearch {
  return validateSettingsScopeSearch({ project: search.project });
}
