import { createFileRoute } from "@tanstack/react-router";

import { AldoIntegrationsPanel } from "../aldo/AldoIntegrationsPanel";
import { AldoPhonePanel } from "../aldo/AldoPhonePanel";
import { isAldoCloud } from "../aldo/cloud";
import { IntegrationsSettingsPanel } from "../components/settings/IntegrationsSettings";
import { SettingsPageContainer } from "../components/settings/settingsLayout";

function SettingsIntegrationsRoute() {
  // Aldo's cloud agents use Aldo's browser, not T3's preview: the page lists the accounts they use.
  if (isAldoCloud) {
    return (
      <SettingsPageContainer>
        <AldoIntegrationsPanel />
        <AldoPhonePanel />
      </SettingsPageContainer>
    );
  }
  return <IntegrationsSettingsPanel />;
}

export const Route = createFileRoute("/settings/integrations")({
  component: SettingsIntegrationsRoute,
});
