import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoMemberPage } from "../aldo/AldoMemberPage";
import { isAldoCloud } from "../aldo/api";
import { SettingsPageContainer } from "../components/settings/settingsLayout";

function SettingsMemberRoute() {
  const { memberId } = Route.useParams();
  return (
    <SettingsPageContainer>
      <AldoMemberPage memberId={memberId} />
    </SettingsPageContainer>
  );
}

export const Route = createFileRoute("/settings/members_/$memberId")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsMemberRoute,
});
