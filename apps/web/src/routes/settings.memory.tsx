import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoMemoryPanel } from "../aldo/AldoMemoryPanel";
import { AldoPersonalizationPage } from "../aldo/AldoPersonalizationTabs";
import { isAldoCloud } from "../aldo/cloud";

function SettingsMemoryRoute() {
  return (
    <AldoPersonalizationPage>
      <AldoMemoryPanel />
    </AldoPersonalizationPage>
  );
}

export const Route = createFileRoute("/settings/memory")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsMemoryRoute,
});
