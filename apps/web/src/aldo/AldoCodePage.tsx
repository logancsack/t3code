// Settings → Code: shown only when Developer tools are on.
// Pull request policy (auto-merge, merge method, automated reviews),
// prebuilt environments, diff preferences, code display and code hosts.

import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, Code2Icon, GitBranchIcon } from "lucide-react";

import { DiffsSettingsPanel } from "../components/settings/SettingsPanels";
import { CodeFontRow, WordWrapRow } from "../components/settings/TypographySettings";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../components/settings/settingsLayout";
import {
  useScopedSettings,
  useUpdateScopedSettings,
} from "../components/settings/useScopedSettings";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { AldoEnvironmentsPanel } from "./AldoEnvironmentsPanel";
import { AldoCodePolicySection } from "./AldoPermissionsPage";

export function AldoCodePage() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  return (
    <SettingsPageContainer>
      <AldoCodePolicySection />
      <AldoEnvironmentsPanel />
      <DiffsSettingsPanel />
      <SettingsSection title="Code display" icon={<Code2Icon className="size-4" />}>
        <CodeFontRow preview={null} />
        <WordWrapRow />
        <SettingsRow
          id="terminal-close-confirmation"
          title="Terminal close confirmation"
          description="Ask before closing terminals and stopping their running processes."
          inline
          resetAction={
            settings.confirmTerminalClose !== DEFAULT_UNIFIED_SETTINGS.confirmTerminalClose ? (
              <SettingResetButton
                ariaLabel="Reset terminal close confirmation to default"
                onClick={() =>
                  updateSettings({
                    confirmTerminalClose: DEFAULT_UNIFIED_SETTINGS.confirmTerminalClose,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmTerminalClose}
              onCheckedChange={(checked) =>
                updateSettings({ confirmTerminalClose: Boolean(checked) })
              }
              aria-label="Confirm before closing a terminal"
            />
          }
        />
      </SettingsSection>
      <SettingsSection title="Code hosts" icon={<GitBranchIcon className="size-4" />}>
        <SettingsRow
          id="aldo-code-hosts"
          title="GitHub, GitLab, Bitbucket and Azure DevOps"
          description="Where your repositories live. Connect and disconnect them in Connections."
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
