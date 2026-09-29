import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoInstructionsPanel } from "../aldo/AldoInstructionsPanel";
import { isAldoCloud } from "../aldo/cloud";
import { SettingsPageContainer } from "../components/settings/settingsLayout";

function SettingsInstructionsRoute() {
  return (
    <SettingsPageContainer>
      <AldoInstructionsPanel />
    </SettingsPageContainer>
  );
}

export const Route = createFileRoute("/settings/instructions")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsInstructionsRoute,
});
