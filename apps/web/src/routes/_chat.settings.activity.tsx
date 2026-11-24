import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoActivityPage } from "../aldo/AldoActivityPage";
import { isAldoCloud } from "../aldo/api";
import { SettingsPageContainer } from "../components/settings/settingsLayout";

function SettingsActivityRoute() {
  const { person, team } = Route.useSearch();
  return (
    <SettingsPageContainer>
      <AldoActivityPage person={person ?? null} team={team ?? null} />
    </SettingsPageContainer>
  );
}

const named = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

export const Route = createFileRoute("/settings/activity")({
  // One filter at a time: a person's, or a team's.
  validateSearch: (raw: Record<string, unknown>): { person?: string; team?: string } => {
    const person = named(raw.person);
    if (person) return { person };
    const team = named(raw.team);
    return team ? { team } : {};
  },
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsActivityRoute,
});
