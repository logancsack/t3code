import {
  aldoInstructions,
  aldoMemory,
  aldoPrebuilds,
  aldoSkills,
  aldoVault,
  fetchAldoAccounts,
  fetchAldoAgentInbox,
  fetchAldoApps,
  fetchAldoApprovalRules,
  fetchAldoHeadsUps,
  fetchAldoIntegrations,
  fetchAldoPhone,
  fetchAldoPolicy,
  fetchAldoSubagents,
  listAldoRepositories,
} from "./cloud";
import { createSettingsResource } from "./settingsResource";

export const settingsAccounts = createSettingsResource(fetchAldoAccounts);
export const settingsIntegrations = createSettingsResource(fetchAldoIntegrations);
export const settingsApps = createSettingsResource(fetchAldoApps);
export const settingsPolicy = createSettingsResource(fetchAldoPolicy);
export const settingsSubagents = createSettingsResource(fetchAldoSubagents);
export const settingsInbox = createSettingsResource(fetchAldoAgentInbox);
export const settingsPhone = createSettingsResource(fetchAldoPhone);
export const settingsVault = createSettingsResource(aldoVault.list);
export const settingsInstructions = createSettingsResource(aldoInstructions.list);
export const settingsMemory = createSettingsResource(aldoMemory.list);
export const settingsSkills = createSettingsResource(aldoSkills.list);
export const settingsApprovalRules = createSettingsResource(fetchAldoApprovalRules);
export const settingsHeadsUps = createSettingsResource(fetchAldoHeadsUps);
export const settingsPrebuilds = createSettingsResource(aldoPrebuilds.list);
export const settingsRepositories = createSettingsResource(listAldoRepositories);

/** Small account reads; repository catalogs and provider usage wait for their own page. */
export function prefetchSettingsData() {
  for (const resource of [
    settingsAccounts,
    settingsIntegrations,
    settingsApps,
    settingsPolicy,
    settingsSubagents,
    settingsInbox,
    settingsPhone,
    settingsVault,
    settingsInstructions,
    settingsMemory,
    settingsSkills,
    settingsApprovalRules,
    settingsHeadsUps,
    settingsPrebuilds,
  ]) {
    void resource.load().catch(() => undefined);
  }
}
