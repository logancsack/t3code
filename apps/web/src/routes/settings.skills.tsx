import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoSkillsPanel } from "../aldo/AldoSkillsPanel";
import { isAldoCloud } from "../aldo/cloud";
import { SettingsPageContainer } from "../components/settings/settingsLayout";

function SettingsSkillsRoute() {
  return (
    <SettingsPageContainer>
      <AldoSkillsPanel />
    </SettingsPageContainer>
  );
}

export const Route = createFileRoute("/settings/skills")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsSkillsRoute,
});
