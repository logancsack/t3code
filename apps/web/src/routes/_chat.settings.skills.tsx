import { createFileRoute, redirect } from "@tanstack/react-router";
import { SquareSlashIcon } from "lucide-react";

import { AldoPersonalizationPage } from "../aldo/AldoPersonalizationTabs";
import { AldoSkillsPanel } from "../aldo/AldoSkillsPanel";
import { isAldoCloud } from "../aldo/api";
import { SkillsInSlashMenuRow } from "../components/settings/SettingsPanels";
import { SettingsSection } from "../components/settings/settingsLayout";

function SettingsSkillsRoute() {
  return (
    <AldoPersonalizationPage>
      <AldoSkillsPanel />
      <SettingsSection title="In the composer" icon={<SquareSlashIcon className="size-4" />}>
        <SkillsInSlashMenuRow />
      </SettingsSection>
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
