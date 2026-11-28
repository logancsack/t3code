import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoPersonalizationPage } from "../aldo/AldoPersonalizationTabs";
import { AldoSkillsPanel } from "../aldo/AldoSkillsPanel";
import { isAldoCloud } from "../aldo/api";

function SettingsSkillsRoute() {
  return (
    <AldoPersonalizationPage>
      <AldoSkillsPanel />
    </AldoPersonalizationPage>
  );
}

export const Route = createFileRoute("/_chat/settings/skills")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsSkillsRoute,
});
