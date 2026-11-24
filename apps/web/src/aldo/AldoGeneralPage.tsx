import { Link } from "@tanstack/react-router";
import { RotateCcwIcon } from "lucide-react";
import { useContext } from "react";

import {
  ChatSettingsPanel,
  GeneralSettingsPanel,
  SendShortcutRow,
  ThreadsSettingsPanel,
  useSettingsRestore,
} from "../components/settings/SettingsPanels";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import { useIsMobile } from "../hooks/useMediaQuery";
import { AldoSettingsRestoredContext } from "./settings.logic";
import {
  AldoGeneralBasics,
  AldoGeneralMore,
  AldoKeyboardShortcutsRow,
} from "./AldoGeneralSettings";

/**
 * Aldo's General: its own basics first, then T3's general, chat and thread
 * settings folded under "More settings" (its nav has no page for each).
 */
export function AldoGeneralPage() {
  return (
    <SettingsPageContainer>
      <AldoGeneralBasics sendShortcutRow={<SendShortcutRow />} />
      <AldoGeneralMore>
        <GeneralSettingsPanel />
        <ChatSettingsPanel />
        <ThreadsSettingsPanel />
      </AldoGeneralMore>
      <SettingsSection title="Shortcuts and licenses">
        <AldoKeyboardShortcutsRow />
        <SettingsRow
          id="open-source-licenses"
          title="Open-source licenses"
          description="Notices for the dependencies, assets and optional tools Aldo uses."
          control={
            <Button
              render={<Link to="/settings/open-source-licenses" />}
              size="sm"
              variant="outline"
            >
              View licenses
            </Button>
          }
        />
      </SettingsSection>
      <AldoResetDeviceSettings />
    </SettingsPageContainer>
  );
}

/** A phone's settings have no header bar, so its reset sits at the end of General. */
function AldoResetDeviceSettings() {
  const onRestored = useContext(AldoSettingsRestoredContext);
  const { changedSettingLabels, restoreDefaults } = useSettingsRestore(onRestored);
  if (!useIsMobile() || changedSettingLabels.length === 0) return null;
  return (
    <div className="px-1">
      <Button variant="ghost" size="sm" onClick={() => void restoreDefaults()}>
        <RotateCcwIcon />
        Reset this device’s settings…
      </Button>
    </div>
  );
}
