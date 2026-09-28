import { BellIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { Switch } from "../components/ui/switch";
import {
  aldoNotificationsStatus,
  disableAldoNotifications,
  enableAldoNotifications,
  type AldoNotificationsStatus,
} from "./notifications";

const DESCRIPTION =
  "Get a notification on this device when a thread finishes or needs you, even with Aldo closed.";

/** Settings → General: notifications on this device (notifications.ts). Hidden where they can't work. */
export function AldoNotificationSettings() {
  const [status, setStatus] = useState<AldoNotificationsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => aldoNotificationsStatus().then(setStatus), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!status || status.availability === "unsupported") return null;

  const toggle = async (checked: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (checked && !(await enableAldoNotifications())) setError("Notifications weren't allowed.");
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
    </SettingsSection>
  );
}
