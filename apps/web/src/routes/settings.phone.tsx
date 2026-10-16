import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoPhonePanel } from "../aldo/AldoPhonePanel";
import { isAldoCloud } from "../aldo/cloud";
import { SettingsPageContainer } from "../components/settings/settingsLayout";

function SettingsPhoneRoute() {
  return (
    <SettingsPageContainer>
      <AldoPhonePanel />
    </SettingsPageContainer>
  );
}

export const Route = createFileRoute("/settings/phone")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsPhoneRoute,
});
