import { CloudIcon } from "lucide-react";

import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { Switch } from "../components/ui/switch";
import { setAldoPreloadSettings, useAldoPreloadSettings } from "./preloadSettings";

/** Settings → General: whether cloud agents start ahead of use (see preload.ts). */
export function AldoPreloadSettings() {
  const settings = useAldoPreloadSettings();
  return (
    <SettingsSection title="Computers" icon={<CloudIcon className="size-4" />}>
      <SettingsRow
        title="Start new threads' agents right away"
        description="A new thread's computer starts as soon as the thread opens, so your first message goes out without waiting. Typing to Aldo on the home screen starts one for a thread it may start for you. If nothing uses it, it's removed."
        control={
          <Switch
            checked={settings.newThreads}
            onCheckedChange={(checked) => setAldoPreloadSettings({ newThreads: checked })}
            aria-label="Start new threads' agents right away"
          />
        }
      />
      <SettingsRow
        title="Wake agents when you open a thread"
        description="Opening a thread wakes its computer in the background, so replies start without waiting. If you leave without sending anything, it goes back to sleep."
        control={
          <Switch
            checked={settings.openedThreads}
            onCheckedChange={(checked) => setAldoPreloadSettings({ openedThreads: checked })}
            aria-label="Wake agents when you open a thread"
          />
        }
      />
    </SettingsSection>
  );
}
