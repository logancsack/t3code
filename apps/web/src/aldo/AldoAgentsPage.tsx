// Settings → Agents: what the user's agents run on and how. The AI
// subscriptions they sign in with (optional where Aldo's own models run
// them), what a new thread starts on (and what happens when a subscription
// runs out), their subagents, the email address they share, and, folded
// away, how long a conversation grows and the model that writes thread titles.

import { BadgeCheckIcon, BotIcon, MailIcon, SlidersHorizontalIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { ProjectDefaultsSettings } from "../components/settings/ProjectDefaultsSettings";
import { GeneralSettingsPanel } from "../components/settings/SettingsPanels";
import { SettingsPageContainer, SettingsSection } from "../components/settings/settingsLayout";
import { AldoAccountsPanel } from "./AldoAccountsPanel";
import { AldoAgentInboxRows } from "./AldoAgentInbox";
import { AldoPolicyRuleRow, useAldoPolicy } from "./AldoPolicy";
import { AldoSubagentsPanel } from "./AldoSubagentsPanel";
import { aldoOffersItsModels, subscribeAldoEnvironments } from "./directory";

export function AldoAgentsPage() {
  const policy = useAldoPolicy();
  // Where agents already run without one, a subscription is optional (Home no longer asks for it).
  const aldoModels = useSyncExternalStore(
    subscribeAldoEnvironments,
    aldoOffersItsModels,
    () => false,
  );
  return (
    <SettingsPageContainer>
      <AldoAccountsPanel
        id="aldo-subscriptions"
        title="AI subscriptions"
        icon={<BadgeCheckIcon className="size-4" />}
        kinds={["claude", "codex", "grok", "muse"]}
        about={
          aldoModels
            ? "Optional. Agents run on Aldo's models, included in your plan. Connect a subscription of yours to run them on it instead."
            : null
        }
      />
      <SettingsSection
        id="project-defaults"
        title="New threads"
        icon={<BotIcon className="size-4" />}
      >
        <ProjectDefaultsSettings category="general" aldoPart="model" />
        <AldoPolicyRuleRow
          rule="onProviderLimit"
          setting="aldo-provider-limit"
          policy={policy}
          description="When an agent's subscription hits its limit mid-task: carry on at once on another of its models with room, or wait for the limit to reset. Not decided, the thread waits for you."
        />
      </SettingsSection>
      <AldoSubagentsPanel />
      <SettingsSection title="Your agents' email" icon={<MailIcon className="size-4" />}>
        <AldoAgentInboxRows />
      </SettingsSection>
      <SettingsSection title="Advanced" icon={<SlidersHorizontalIcon className="size-4" />}>
        <AldoPolicyRuleRow
          rule="contextBudget"
          setting="aldo-context-budget"
          policy={policy}
          description="How long a conversation grows before its agent compacts it, keeping the goal, decisions and open work. Longer keeps more in view, and uses more of your limits each turn."
        />
        <GeneralSettingsPanel aldoPart="text-generation" />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
