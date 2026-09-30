import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoMemoryPanel } from "../aldo/AldoMemoryPanel";
import { isAldoCloud } from "../aldo/cloud";
import { SettingsPageContainer } from "../components/settings/settingsLayout";

function SettingsMemoryRoute() {
  return (
    <SettingsPageContainer>
      <AldoMemoryPanel />
    </SettingsPageContainer>
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
