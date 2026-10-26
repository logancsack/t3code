import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoActivityPage } from "../aldo/AldoActivityPage";
import { isAldoCloud } from "../aldo/api";
import { SettingsPageContainer } from "../components/settings/settingsLayout";

function SettingsActivityRoute() {
  const { person } = Route.useSearch();
  return (
    <SettingsPageContainer>
      <AldoActivityPage person={person ?? null} />
    </SettingsPageContainer>
  );
}

export const Route = createFileRoute("/settings/activity")({
  validateSearch: (raw: Record<string, unknown>): { person?: string } =>
    typeof raw.person === "string" && raw.person.trim() ? { person: raw.person } : {},
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsActivityRoute,
});
