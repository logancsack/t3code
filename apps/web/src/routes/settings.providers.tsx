import { createFileRoute } from "@tanstack/react-router";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";

import { AldoAccountsPanel } from "../aldo/AldoAccountsPanel";
import { isAldoCloud } from "../aldo/cloud";
import { ProviderSettingsPanel } from "../components/settings/ProviderSettingsPanel";
import { SettingsPageContainer } from "../components/settings/settingsLayout";
import { useSettingsScope } from "../components/settings/SettingsScopeContext";

/**
 * Providers are machine state, so the page shows one environment at a time:
 * the chosen one from the settings scope selector.
 * A project crumb narrows candidates to where that project is registered.
 */
function SettingsProvidersRoute() {
  const target = Route.useSearch();
  const { environment, scope } = useSettingsScope();
  // Aldo's cloud agents run on the user's AI subscriptions, which the page lists.
  if (isAldoCloud) {
    return (
      <SettingsPageContainer>
        <AldoAccountsPanel title="AI subscriptions" kinds={["claude", "codex", "grok", "muse"]} />
      </SettingsPageContainer>
    );
  }
  if (!environment) {
    return (
      <p className="p-8 text-sm text-muted-foreground">
        {scope.kind === "environment"
          ? `Reconnect ${scope.label} to set up its providers.`
          : "Connect an environment to set up its providers."}
      </p>
    );
  }
  return (
    <ProviderSettingsPanel
      environmentId={environment.environmentId}
      {...(target.instanceId ? { instanceId: target.instanceId } : {})}
      scoped
    />
  );
}

export const Route = createFileRoute("/settings/providers")({
  validateSearch: (raw: Record<string, unknown>) => ({
    ...(typeof raw.environmentId === "string" && raw.environmentId.trim()
      ? { environmentId: EnvironmentId.make(raw.environmentId) }
      : {}),
    ...(typeof raw.instanceId === "string" && raw.instanceId.trim()
      ? { instanceId: ProviderInstanceId.make(raw.instanceId) }
      : {}),
  }),
  component: SettingsProvidersRoute,
});
