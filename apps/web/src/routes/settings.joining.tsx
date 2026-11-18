import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoJoiningPage } from "../aldo/AldoJoiningPage";
import { isAldoCloud } from "../aldo/api";
import { SettingsPageContainer } from "../components/settings/settingsLayout";

function SettingsJoiningRoute() {
  return (
    <SettingsPageContainer>
      <AldoJoiningPage />
    </SettingsPageContainer>
  );
}

export const Route = createFileRoute("/settings/joining")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsJoiningRoute,
});
