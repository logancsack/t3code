import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoMembersPage } from "../aldo/AldoMembersPage";
import { isAldoCloud } from "../aldo/api";
import { SettingsPageContainer } from "../components/settings/settingsLayout";

function SettingsMembersRoute() {
  return (
    <SettingsPageContainer>
      <AldoMembersPage />
    </SettingsPageContainer>
  );
}

export const Route = createFileRoute("/settings/members")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsMembersRoute,
});
