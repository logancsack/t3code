import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoRunningPage } from "../aldo/AldoRunningPage";
import { isAldoCloud } from "../aldo/api";
import { SettingsPageContainer } from "../components/settings/settingsLayout";

function SettingsRunningRoute() {
  return (
    <SettingsPageContainer>
      <AldoRunningPage />
    </SettingsPageContainer>
  );
}

export const Route = createFileRoute("/settings/running")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsRunningRoute,
});
