// Whether this account sees the developer tools: pull requests, Code
// settings, and the Terminal and Diff in a thread (onboarding.logic.ts). Away
// from Aldo, and for accounts that never had the welcome, they're always
// there; a git host's connection is read only for an answer without code.

import { isAldoCloud } from "./api";
import { type AldoHostKind } from "./accountApi";
import { useAldoInterests } from "./onboarding";
import { aldoDeveloperToolsShown } from "./onboarding.logic";
import { settingsAccounts } from "./settingsData";
import { useSettingsResource } from "./settingsResource";

const GIT_HOSTS: ReadonlyArray<AldoHostKind> = ["github", "gitlab", "bitbucket", "azure"];

export function useAldoDeveloperTools(): boolean {
  const interests = useAldoInterests();
  const asks = interests !== null && !interests.includes("code");
  const accounts = useSettingsResource(settingsAccounts, asks, false).data;
  if (!isAldoCloud) return true;
  const gitHost = accounts ? GIT_HOSTS.some((kind) => accounts[kind]?.connected === true) : null;
  return aldoDeveloperToolsShown({ interests, gitHost });
}
