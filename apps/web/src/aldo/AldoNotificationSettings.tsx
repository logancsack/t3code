import { settingsHeadsUps, settingsIntegrations } from "./settingsData";
import { createSettingsResource, useSettingsResource } from "./settingsResource";
import { Link } from "@tanstack/react-router";
import { BellIcon, SparklesIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../components/settings/settingsLayout";
import { searchableSetting } from "../components/settings/settingsSearch";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { toastManager } from "../components/ui/toast";
import { playAldoChime, setAldoSound, useAldoSound } from "./chime";
import { setAldoHeadsUps } from "./accountApi";
import {
  aldoNotificationsStatus,
  disableAldoNotifications,
  enableAldoNotifications,
} from "./notifications";

const DESCRIPTION =
  "Get a notification on this device when a thread finishes or needs you, even with Aldo closed.";

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/**
 * Notifications on this device (notifications.ts), shown where they can work,
 * and the optional sound while Aldo is open (chime.ts).
 */
const deviceNotifications = createSettingsResource(aldoNotificationsStatus);

function AldoNotificationSettings() {
  const sound = useAldoSound();
  const status = useSettingsResource(deviceNotifications, true, false).data ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => deviceNotifications.refresh(), []);
  // Read again when the user comes back, e.g. from allowing notifications in the browser's settings.
  useEffect(() => {
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
      {...searchableSetting("aldo-notification-sound")}
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
      <SettingsSection title="On this device" icon={<BellIcon className="size-4" />}>
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
    <SettingsSection title="On this device" icon={<BellIcon className="size-4" />}>
      <SettingsRow
        {...searchableSetting("aldo-notifications")}
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

/**
 * Aldo's heads-ups, on or off, once Aldo has them: they need an account with
 * mail or a calendar, so without one the row says to connect one.
 */
function HeadsUpsRow(props: { readonly connected: boolean | null }) {
  const cached = useSettingsResource(settingsHeadsUps);
  const headsUps = cached.data;
  const error = cached.error;
  const [saving, setSaving] = useState(false);
  const load = () => {
    void settingsHeadsUps.refresh().catch(() => undefined);
  };
  if (error && !headsUps) {
    return (
      <SettingsRow
        {...searchableSetting("aldo-heads-ups")}
        description={`Couldn't read whether they're on: ${error}`}
        control={
          <Button size="sm" variant="outline" onClick={load}>
            Try again
          </Button>
        }
      />
    );
  }
  const description =
    "Every half hour of your day, Aldo looks at your new mail and coming events and tells you what's worth knowing (here and on your phone), sometimes with a thread to start for it. Most looks say nothing.";
  if (!headsUps) {
    return (
      <SettingsRow
        {...searchableSetting("aldo-heads-ups")}
        description={description}
        status={headsUps === null ? "Not on this Aldo yet." : "Checking…"}
      />
    );
  }
  const change = (on: boolean) => {
    setSaving(true);
    settingsHeadsUps
      .mutate(
        (before) => (before ? { ...before, on } : before),
        () => setAldoHeadsUps(on),
      )
      .catch((cause: unknown) =>
        toastManager.add({
          type: "error",
          title: "Couldn't change that",
          description: messageOf(cause),
        }),
      )
      .finally(() => setSaving(false));
  };
  return (
    <SettingsRow
      {...searchableSetting("aldo-heads-ups")}
      description={description}
      {...(props.connected === false
        ? {
            status: (
              <>
                They need your mail or calendar:{" "}
                <Link to="/settings/connections" className="underline underline-offset-2">
                  connect Google or Microsoft
                </Link>
                .
              </>
            ),
          }
        : {})}
      control={
        <Switch
          checked={headsUps.on}
          disabled={saving || props.connected === false}
          onCheckedChange={change}
          aria-label="Heads-ups from Aldo"
        />
      }
    />
  );
}

/** Whether an account with mail or a calendar is connected: null until it's read. */
function useMailConnected(): boolean | null {
  const { data } = useSettingsResource(settingsIntegrations);
  return data === undefined
    ? null
    : (data ?? []).some(
        (i) =>
          i.kind !== "key" &&
          i.connected &&
          !i.error &&
          (i.can ?? ["mail"]).some((c) => c === "mail" || c === "calendar"),
      );
}

/** Settings → Notifications: what reaches the user, on this device and from Aldo. */
export function AldoNotificationsPage() {
  const connected = useMailConnected();
  return (
    <SettingsPageContainer>
      <AldoNotificationSettings />
      <SettingsSection title="From Aldo" icon={<SparklesIcon className="size-4" />}>
        <HeadsUpsRow connected={connected} />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
