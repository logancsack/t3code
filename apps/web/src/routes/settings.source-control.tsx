import { createFileRoute } from "@tanstack/react-router";

import { AldoAccountsPanel } from "../aldo/AldoAccountsPanel";
import { AldoGitHostRows } from "../aldo/AldoGitHostsPanel";
import { isAldoCloud } from "../aldo/cloud";
import { SourceControlSettingsPanel } from "../components/settings/SourceControlSettings";
import { SettingsPageContainer } from "../components/settings/settingsLayout";

function SettingsSourceControlRoute() {
  if (isAldoCloud) {
    return (
      <SettingsPageContainer>
        <AldoAccountsPanel
          title="Source control"
          kinds={["github"]}
          extra={(accounts, refresh) => <AldoGitHostRows accounts={accounts} onChanged={refresh} />}
        />
      </SettingsPageContainer>
    );
  }
  return <SourceControlSettingsPanel />;
}

export const Route = createFileRoute("/settings/source-control")({
  component: SettingsSourceControlRoute,
});
