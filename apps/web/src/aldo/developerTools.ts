// Whether this account sees the developer tools: pull requests, Code
// settings, and the Terminal and Diff in a thread (onboarding.logic.ts). Away
// from Aldo, and for accounts that never had the welcome, they're always
// there; a git host's connection is read only for an answer without code.
// Until the account's read they wait, so they don't flash in and out.

import { isAldoCloud } from "./api";
import { type AldoHostKind } from "./accountApi";
import { useAldoInterests } from "./onboarding";
import { aldoDeveloperToolsShown } from "./onboarding.logic";
import { settingsAccounts } from "./settingsData";
import { useSettingsResource } from "./settingsResource";

const GIT_HOSTS: ReadonlyArray<AldoHostKind> = ["github", "gitlab", "bitbucket", "azure"];

/** Whether they're shown; undefined while that isn't known yet. */
export function useAldoDeveloperToolsState(): boolean | undefined {
  const interests = useAldoInterests();
  const asks = interests != null && !interests.includes("code");
  const accounts = useSettingsResource(settingsAccounts, asks, false).data;
  if (!isAldoCloud) return true;
  const gitHost = accounts ? GIT_HOSTS.some((kind) => accounts[kind]?.connected === true) : null;
  return aldoDeveloperToolsShown({ interests, gitHost });
}

/** Whether to show them now: not while that isn't known. */
export function useAldoDeveloperTools(): boolean {
  return useAldoDeveloperToolsState() === true;
}

/** The shortcuts that open the Terminal or the Diff in a thread, which wait with them. */
export const ALDO_DEVELOPER_COMMANDS: ReadonlySet<string> = new Set([
  "terminal.toggle",
  "terminal.split",
  "terminal.splitVertical",
  "terminal.new",
  "diff.toggle",
]);
