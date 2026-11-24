import { createFileRoute, redirect } from "@tanstack/react-router";

import { isAldoCloud } from "../aldo/api";
import { AldoTeamPage } from "../aldo/AldoTeamPage";
import { SettingsPageContainer } from "../components/settings/settingsLayout";

function SettingsTeamRoute() {
  const { teamId } = Route.useParams();
  return (
    <SettingsPageContainer>
      <AldoTeamPage key={teamId} teamId={teamId} />
    </SettingsPageContainer>
  );
}

export const Route = createFileRoute("/settings/teams/$teamId")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsTeamRoute,
});
