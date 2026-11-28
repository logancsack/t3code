// Settings → Models: Aldo's included models, AI subscriptions (Claude, ChatGPT,
// Grok, Muse Code, Google Antigravity), API keys (OpenCode + arbitrary providers),
// default model for new threads, all limit/paid-overflow rules, and folded Advanced
// (conversation length and helper models).

import { Link } from "@tanstack/react-router";
import { BadgeCheckIcon, CpuIcon } from "lucide-react";
import { lazy, Suspense, useSyncExternalStore } from "react";

import { ProjectDefaultsSettings } from "../components/settings/ProjectDefaultsSettings";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../components/settings/settingsLayout";
import { Badge } from "../components/ui/badge";
import { AldoAccountsPanel } from "./AldoAccountsPanel";
import { AldoBrandTile } from "./AldoBrandTile";
import { AldoPolicyRuleRow, useAldoPolicy } from "./AldoPolicy";
import { AldoSettingsFold } from "./AldoSettingsFold";
import { AldoSubagentsPanel } from "./AldoSubagentsPanel";
import { aldoOffersItsModels, subscribeAldoEnvironments } from "./directory";
import { planRunning } from "./home.logic";
import { useAldoHomeRead } from "./homeFeed";
import { useAldoAccounts } from "./useAldoAccounts";

const AldoAgentConnections = lazy(() =>
  import("./AldoAgentConnections").then(({ AldoAgentConnections }) => ({
    default: AldoAgentConnections,
  })),
);
const AldoGoogleAntigravityRow = lazy(() =>
  import("./AldoAgentConnections").then(({ AldoGoogleAntigravityRow }) => ({
    default: AldoGoogleAntigravityRow,
  })),
);

/** The rows under Advanced: a search for one unfolds it. */
const ADVANCED_IDS: ReadonlySet<string> = new Set(["aldo-subagents", "aldo-context-budget"]);
const opensAdvanced = (targetId: string) => ADVANCED_IDS.has(targetId);

export function AldoAgentsPage() {
  const policy = useAldoPolicy();
  const { accounts } = useAldoAccounts();
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
        title="AI subscriptions"
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
                  ? "Agents run on these by default unless you connect a subscription below."
                  : "Agents run on these while your plan is active, or on a subscription you connect below."
              }
            />
          ) : null
        }
        after={
          <Suspense>
            <AldoGoogleAntigravityRow />
          </Suspense>
        }
      />
      <Suspense>
        <AldoAgentConnections />
      </Suspense>
      <SettingsSection
        id="project-defaults"
        title="New threads and limits"
        icon={<CpuIcon className="size-4" />}
      >
        <ProjectDefaultsSettings category="general" aldoPart="model" />
        <AldoPolicyRuleRow
          rule="onProviderLimit"
          setting="aldo-provider-limit"
          policy={policy}
          description="What happens if your active subscription hits its usage limit mid-task: switch automatically to another available model, or pause until the limit resets."
        />
        <AldoPolicyRuleRow
          rule="paidFallback"
          setting="aldo-paid-fallback"
          policy={policy}
          description="When your subscriptions run out, keep threads moving using extra Aldo credits, Claude extra usage or ChatGPT credits."
        />
        {accounts?.opencode?.connected ? (
          <AldoPolicyRuleRow
            rule="paidConnectedModels"
            setting="aldo-paid-connected-models"
            policy={policy}
            description="Let Automatic choose models that can bill your connected OpenCode or API accounts, including when another model hits a limit."
          />
        ) : null}
        <p className="px-3 py-2.5 text-muted-foreground text-xs sm:px-4">
          Extra Aldo credits follow your monthly cap in{" "}
          <Link
            to="/settings/account"
            hash="aldo-extra-usage-cap"
            className="text-foreground underline underline-offset-2 hover:text-primary"
          >
            Account & billing
          </Link>
          .
        </p>
      </SettingsSection>
      <AldoSettingsFold
        title="Advanced"
        hint="Conversation length and helper models"
        opensFor={opensAdvanced}
      >
        <SettingsSection title="Advanced" hideTitle>
          <AldoPolicyRuleRow
            rule="contextBudget"
            setting="aldo-context-budget"
            policy={policy}
            description="How much a thread keeps in full before its agent summarizes earlier work while preserving the goal, decisions and open tasks."
          />
          <AldoSubagentsPanel bare />
        </SettingsSection>
      </AldoSettingsFold>
    </SettingsPageContainer>
  );
}
