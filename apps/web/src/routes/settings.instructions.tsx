import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoInstructionsPanel } from "../aldo/AldoInstructionsPanel";
import { AldoPersonalizationPage } from "../aldo/AldoPersonalizationTabs";
import { isAldoCloud } from "../aldo/cloud";

function SettingsInstructionsRoute() {
  return (
    <AldoPersonalizationPage>
      <AldoInstructionsPanel />
    </AldoPersonalizationPage>
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
