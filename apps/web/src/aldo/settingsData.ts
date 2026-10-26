import {
  aldoInstructions,
  aldoOrgAdmin,
  aldoSkills,
  aldoVault,
  fetchAldoAccounts,
  fetchAldoAgentInbox,
  fetchAldoApps,
  fetchAldoBriefSettings,
  fetchAldoHeadsUps,
  fetchAldoIntegrations,
  fetchAldoMomentEmails,
  fetchAldoOrg,
  fetchAldoPhone,
  listAldoRepositories,
} from "./accountApi";
import { aldoMemory } from "./assistantApi";
import { aldoPrebuilds } from "./workspaceApi";
import { fetchAldoApprovalRules, fetchAldoPolicy } from "./homeApi";
import { fetchAldoSubagents } from "./threadApi";
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
export const settingsBrief = createSettingsResource(fetchAldoBriefSettings);
export const settingsMomentEmails = createSettingsResource(fetchAldoMomentEmails);
export const settingsOrg = createSettingsResource(fetchAldoOrg);
/** Members' credits and machines this month; owners' and admins', read on Members only. */
export const settingsOrgUsage = createSettingsResource(() => aldoOrgAdmin.usage());
/** What admins did to the user's work, for the note in a thread; read only for someone in an organization. */
export const settingsOrgNotes = createSettingsResource(() => aldoOrgAdmin.notes());
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
    settingsBrief,
    settingsMomentEmails,
    settingsOrg,
    settingsPrebuilds,
  ]) {
    void resource.load().catch(() => undefined);
  }
}
