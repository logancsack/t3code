import { PanelLeftIcon } from "lucide-react";

import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { searchableSetting } from "../components/settings/settingsSearch";
import { Switch } from "../components/ui/switch";
import { setAldoSimpleMode, useAldoSimpleMode } from "./simpleMode";

/** Settings → General: simple mode on this device (simpleMode.ts). */
export function AldoSimpleModeSettings() {
  const on = useAldoSimpleMode();
  return (
    <SettingsSection title="Layout" icon={<PanelLeftIcon className="size-4" />}>
      <SettingsRow
        {...searchableSetting("aldo-simple-mode")}
        description="A narrow rail in place of the sidebar, with just Aldo, what needs you, and your Library. A thread still opens when you tap one. Only on this device."
        control={
          <Switch
            checked={on}
            onCheckedChange={(checked) => setAldoSimpleMode(checked)}
            aria-label="Simple mode"
          />
        }
      />
    </SettingsSection>
  );
}
