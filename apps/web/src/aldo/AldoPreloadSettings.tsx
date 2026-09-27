import { CloudIcon } from "lucide-react";

import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { Switch } from "../components/ui/switch";
import { setAldoPreloadSettings, useAldoPreloadSettings } from "./preloadSettings";

/** Settings → General: whether cloud agents start ahead of use (see preload.ts). */
export function AldoPreloadSettings() {
  const settings = useAldoPreloadSettings();
  return (
    <SettingsSection title="Cloud agents" icon={<CloudIcon className="size-4" />}>
      <SettingsRow
        title="Start new threads' agents right away"
        description="A new thread's cloud agent starts as soon as the thread opens, so your first message goes out without waiting. If you leave without sending anything, it's removed."
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
        description="Opening a thread wakes its cloud agent in the background, so replies start without waiting. If you leave without sending anything, it goes back to sleep."
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
