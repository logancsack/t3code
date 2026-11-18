import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoOrganizationPage } from "../aldo/AldoOrganizationPage";
import { isAldoCloud } from "../aldo/api";
import { SettingsPageContainer } from "../components/settings/settingsLayout";

function SettingsOrganizationRoute() {
  return (
    <SettingsPageContainer>
      <AldoOrganizationPage />
    </SettingsPageContainer>
  );
}

export const Route = createFileRoute("/settings/organization")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsOrganizationRoute,
});
