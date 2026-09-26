import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoEnvironmentsPanel } from "../aldo/AldoEnvironmentsPanel";
import { isAldoCloud } from "../aldo/cloud";
import { SettingsPageContainer } from "../components/settings/settingsLayout";

function SettingsEnvironmentsRoute() {
  return (
    <SettingsPageContainer>
      <AldoEnvironmentsPanel />
    </SettingsPageContainer>
  );
}

export const Route = createFileRoute("/settings/environments")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsEnvironmentsRoute,
});
