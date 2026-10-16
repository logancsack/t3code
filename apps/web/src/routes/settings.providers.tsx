import { createFileRoute, redirect } from "@tanstack/react-router";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";

import { isAldoCloud } from "../aldo/api";
import { aldoSettingsRedirect } from "../aldo/settings.logic";
import { ProviderSettingsPanel } from "../components/settings/ProviderSettingsPanel";
import { useSettingsScope } from "../components/settings/SettingsScopeContext";

/**
 * Providers are machine state, so the page shows one environment at a time:
 * the chosen one from the settings scope selector.
 * A project crumb narrows candidates to where that project is registered.
 */
function SettingsProvidersRoute() {
  const target = Route.useSearch();
  const { environment, scope } = useSettingsScope();
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
  beforeLoad: ({ location }) => {
    // Aldo's cloud agents run on the user's AI subscriptions, on Settings → Agents.
    if (isAldoCloud) {
      throw redirect({
        href: aldoSettingsRedirect(location) ?? "/settings/agents",
        replace: true,
      });
    }
  },
  component: SettingsProvidersRoute,
});
