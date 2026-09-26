import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoVaultPanel } from "../aldo/AldoVaultPanel";
import { isAldoCloud } from "../aldo/cloud";
import { SettingsPageContainer } from "../components/settings/settingsLayout";

function SettingsVaultRoute() {
  return (
    <SettingsPageContainer>
      <AldoVaultPanel />
    </SettingsPageContainer>
  );
}

export const Route = createFileRoute("/settings/vault")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsVaultRoute,
});
