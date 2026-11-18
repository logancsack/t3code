// Settings → Models: what the user's agents run on. Aldo's own models (where
// its plan includes them) and the AI subscriptions they sign in with, what a
// new thread starts on (and what happens when a subscription runs out), and,
// folded away, how long a conversation grows, the model that writes thread
// titles and the helpers' models.

import { BadgeCheckIcon, BotIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { ProjectDefaultsSettings } from "../components/settings/ProjectDefaultsSettings";
import { GeneralSettingsPanel } from "../components/settings/SettingsPanels";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../components/settings/settingsLayout";
import { Badge } from "../components/ui/badge";
import { AldoAccountsPanel } from "./AldoAccountsPanel";
import { AldoBrandTile } from "./AldoBrandTile";
import { AldoPolicyRuleRow, useAldoPolicy } from "./AldoPolicy";
import { AldoSettingsFold } from "./AldoSettingsShell";
import { AldoSubagentsPanel } from "./AldoSubagentsPanel";
import { aldoOffersItsModels, subscribeAldoEnvironments } from "./directory";
import { planRunning } from "./home.logic";
import { useAldoHomeRead } from "./homeFeed";

/** The rows under Advanced: a search for one unfolds it. */
const ADVANCED_IDS: ReadonlySet<string> = new Set([
  "aldo-subagents",
  "aldo-context-budget",
  "text-generation-model",
]);
const opensAdvanced = (targetId: string) => ADVANCED_IDS.has(targetId);

export function AldoAgentsPage() {
  const policy = useAldoPolicy();
  // Where agents already run without one, a subscription is optional (Home no longer asks for it):
  // on Aldo's models while the plan is active. Without one, they need a plan or a subscription.
  const aldoModels = useSyncExternalStore(
    subscribeAldoEnvironments,
    aldoOffersItsModels,
    () => false,
  );
  const { home, supported, error } = useAldoHomeRead();
  const planKnown = home !== null || supported === false || error !== null;
  const included = home !== null && planRunning(home.usage);
  const planName = home?.usage.plan?.name ?? null;
  return (
    <SettingsPageContainer>
      <AldoAccountsPanel
        id="aldo-subscriptions"
        title="Subscriptions"
        icon={<BadgeCheckIcon className="size-4" />}
        kinds={["claude", "codex", "grok", "muse"]}
        before={
          aldoModels && planKnown ? (
            <SettingsRow
              id="aldo-models"
              leading={<AldoBrandTile id="aldo" name="Aldo" />}
              title="Aldo’s models"
              badge={
                included ? (
                  <Badge variant="info">{planName ? `Included in ${planName}` : "Included"}</Badge>
                ) : null
              }
              description={
                included
                  ? "Agents run on them unless you connect a subscription of yours below."
                  : "Agents run on them while your plan is active, or on a subscription of yours below."
              }
            />
          ) : null
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
          description="Ask me: the thread waits and tells you. Switch: it carries on at once on another model with room. Wait: it picks up when the limit resets."
        />
      </SettingsSection>
      <AldoSettingsFold
        title="Advanced"
        hint="Conversation length, thread titles, helper models"
        opensFor={opensAdvanced}
      >
        <SettingsSection title="Advanced" hideTitle>
          <AldoPolicyRuleRow
            rule="contextBudget"
            setting="aldo-context-budget"
            policy={policy}
            description="How much a thread keeps in full before its agent summarizes the oldest part, keeping the goal, decisions and open work. Longer keeps more detail, and uses more of your plan each turn."
          />
          <GeneralSettingsPanel aldoPart="text-generation" />
          <AldoSubagentsPanel bare />
        </SettingsSection>
      </AldoSettingsFold>
    </SettingsPageContainer>
  );
}
