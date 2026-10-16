// Settings → Code: what only matters to work on code. Ready-to-go
// environments, how changes show (T3's diff rows), and where the code hosts
// are connected (Connections).

import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, GitCompareArrowsIcon, GitBranchIcon } from "lucide-react";

import { GeneralSettingsPanel } from "../components/settings/SettingsPanels";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import { AldoEnvironmentsPanel } from "./AldoEnvironmentsPanel";

export function AldoCodePage() {
  return (
    <SettingsPageContainer>
      <AldoEnvironmentsPanel />
      <SettingsSection
        id="aldo-changes"
        title="Changes"
        icon={<GitCompareArrowsIcon className="size-4" />}
      >
        <GeneralSettingsPanel aldoPart="diffs" />
      </SettingsSection>
      <SettingsSection title="Code hosts" icon={<GitBranchIcon className="size-4" />}>
        <SettingsRow
          id="aldo-code-hosts"
          title="GitHub, GitLab, Bitbucket and Azure DevOps"
          description="Where your repositories are. Connect and disconnect them with your other accounts."
          control={
            <Button render={<Link to="/settings/connections" />} size="sm" variant="outline">
              Connections
              <ChevronRightIcon className="size-3.5" />
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
