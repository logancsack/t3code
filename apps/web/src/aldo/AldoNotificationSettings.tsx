import { BellIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { Switch } from "../components/ui/switch";
import { playAldoChime, setAldoSound, useAldoSound } from "./chime";
import {
  aldoNotificationsStatus,
  disableAldoNotifications,
  enableAldoNotifications,
  type AldoNotificationsStatus,
} from "./notifications";

const DESCRIPTION =
  "Get a notification on this device when a thread finishes or needs you, even with Aldo closed.";

/**
 * Settings → General: notifications on this device (notifications.ts), shown
 * where they can work, and the optional sound while Aldo is open (chime.ts).
 */
export function AldoNotificationSettings() {
  const sound = useAldoSound();
  const [status, setStatus] = useState<AldoNotificationsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => aldoNotificationsStatus().then(setStatus), []);
  // Read again when the user comes back, e.g. from allowing notifications in the browser's settings.
  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh]);

  const soundRow = (
    <SettingsRow
      title="Play a sound when a thread finishes or needs you"
      description="A soft chime while Aldo is open on this device, except for the thread you're looking at."
      control={
        <Switch
          checked={sound}
          onCheckedChange={(checked) => {
            setAldoSound(checked);
            // Turning it on plays it once, so the user knows the sound.
            if (checked) playAldoChime();
          }}
          aria-label="Play a sound when a thread finishes or needs you"
        />
      }
    />
  );

  if (!status || status.availability === "unsupported") {
    return (
      <SettingsSection title="Notifications" icon={<BellIcon className="size-4" />}>
        {soundRow}
      </SettingsSection>
    );
  }

  const toggle = async (checked: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const key = status.availability === "available" ? status.key : null;
      if (checked && !(await enableAldoNotifications(key)))
        setError("Notifications weren't allowed.");
      if (!checked) await disableAldoNotifications();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const description =
    status.availability === "add-to-home-screen"
      ? `${DESCRIPTION} On an iPhone or iPad, add Aldo to your Home Screen first (Share → Add to Home Screen), then turn this on there.`
      : status.blocked
        ? `${DESCRIPTION} This browser blocks notifications from Aldo; allow them in its site settings first.`
        : (error ?? DESCRIPTION);

  return (
    <SettingsSection title="Notifications" icon={<BellIcon className="size-4" />}>
      <SettingsRow
        title="Notifications on this device"
        description={description}
        control={
          status.availability === "available" ? (
            <Switch
              checked={status.on}
              disabled={busy || status.blocked}
              onCheckedChange={(checked) => void toggle(checked)}
              aria-label="Notifications on this device"
            />
          ) : null
        }
      />
      {soundRow}
    </SettingsSection>
  );
}
