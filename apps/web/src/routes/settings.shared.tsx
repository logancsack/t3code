import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoSharedFilesPanel } from "../aldo/AldoLibrary";
import { isAldoCloud } from "../aldo/cloud";
import { SettingsPageContainer } from "../components/settings/settingsLayout";

function SettingsSharedRoute() {
  return (
    <SettingsPageContainer>
      <AldoSharedFilesPanel />
    </SettingsPageContainer>
  );
}

export const Route = createFileRoute("/settings/shared")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsSharedRoute,
});
