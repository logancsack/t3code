import { createFileRoute } from "@tanstack/react-router";

import { AldoAccountsPanel } from "../aldo/AldoAccountsPanel";
import { isAldoCloud } from "../aldo/cloud";
import { ProviderSettingsPanel } from "../components/settings/ProviderSettingsPanel";
import { SettingsPageContainer } from "../components/settings/settingsLayout";

function SettingsProvidersRoute() {
  if (isAldoCloud) {
    return (
      <SettingsPageContainer>
        <AldoAccountsPanel title="AI subscriptions" kinds={["claude", "codex", "grok"]} />
      </SettingsPageContainer>
    );
  }
  return <ProviderSettingsPanel />;
}

export const Route = createFileRoute("/settings/providers")({
  component: SettingsProvidersRoute,
});
