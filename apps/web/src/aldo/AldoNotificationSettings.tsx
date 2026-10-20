import { settingsHeadsUps, settingsIntegrations, settingsMomentEmails } from "./settingsData";
import { createSettingsResource, useSettingsResource } from "./settingsResource";
import { Link } from "@tanstack/react-router";
import { BellIcon, MailIcon, SparklesIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

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
import { setAldoHeadsUps, setAldoMomentEmails } from "./accountApi";
import { AldoNotificationTestNote, useAldoNotificationTest } from "./AldoNotificationTest";
import {
  aldoNotificationsStatus,
  currentAldoBrowser,
  disableAldoNotifications,
  enableAldoNotifications,
} from "./notifications";
import { aldoAllowHint, aldoTestPending } from "./notifications.logic";
import {
  ALDO_MOMENT_EMAIL_ROWS,
  momentEmailsIntro,
  withMomentEmail,
  type AldoMomentEmailKind,
} from "./momentEmails.logic";

const DESCRIPTION =
  "Get a notification on this device when a thread finishes or needs you, even with Aldo closed.";

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/**
 * Notifications on this device (notifications.ts), shown where they can work,
 * and the optional sound while Aldo is open (chime.ts). Turning them on sends
 * a test where Aldo can, and "Send a test" sends another; blocked, the row
 * says where this browser allows them.
 */
const deviceNotifications = createSettingsResource(aldoNotificationsStatus);

function AldoNotificationSettings() {
  const sound = useAldoSound();
  const status = useSettingsResource(deviceNotifications, true, false).data ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const test = useAldoNotificationTest();
  const browser = useMemo(() => currentAldoBrowser(), []);

  const refresh = useCallback(() => deviceNotifications.refresh(), []);
  // A test that failed may have found this device's subscription gone (and let it go): read it again.
  const testFailed = test.state?.phase === "failed";
  useEffect(() => {
    if (testFailed) void refresh();
  }, [testFailed, refresh]);
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

  const canTest = status.availability === "available" && status.test;
  const toggle = async (checked: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const key = status.availability === "available" ? status.key : null;
      if (checked) {
        const permission = await enableAldoNotifications(key);
        if (permission === "granted" && canTest) test.run();
        if (permission === "default")
          setError("Notifications weren’t turned on. Try again, and choose Allow.");
      }
      if (!checked) await disableAldoNotifications();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const host = window.location.host;
  const description =
    status.availability === "add-to-home-screen"
      ? `${DESCRIPTION} ${aldoAllowHint(browser, host)}`
      : status.blocked
        ? `${DESCRIPTION} This browser blocks notifications from Aldo. ${aldoAllowHint(browser, host)}`
        : (error ?? DESCRIPTION);
  const on = status.availability === "available" && status.on;

  return (
    <SettingsSection title="On this device" icon={<BellIcon className="size-4" />}>
      <SettingsRow
        {...searchableSetting("aldo-notifications")}
        description={description}
        {...(on && canTest && test.state
          ? {
              status: (
                <AldoNotificationTestNote state={test.state} browser={browser} onAgain={test.run} />
              ),
            }
          : {})}
        control={
          status.availability === "available" ? (
            <>
              {on && canTest ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || aldoTestPending(test.state)}
                  onClick={test.run}
                >
                  Send a test
                </Button>
              ) : null}
              <Switch
                checked={status.on}
                disabled={busy || status.blocked}
                onCheckedChange={(checked) => void toggle(checked)}
                aria-label="Notifications on this device"
              />
            </>
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

/**
 * The emails Aldo sends when a thread is done, needs the user or stops while
 * they're away, a switch for each kind. Shown once Aldo says it sends them: an
 * Aldo without them answers 404, and the section stays hidden.
 */
function MomentEmailsSection() {
  const cached = useSettingsResource(settingsMomentEmails);
  const settings = cached.data;
  const [saving, setSaving] = useState<ReadonlySet<AldoMomentEmailKind>>(new Set());
  if (settings === null || (settings === undefined && !cached.error)) return null;
  const section = (children: ReactNode) => (
    <SettingsSection title="By email" icon={<MailIcon className="size-4" />}>
      {children}
    </SettingsSection>
  );
  if (!settings) {
    return section(
      <SettingsRow
        id="aldo-moment-emails"
        title="Emails when you’re away"
        description={`Couldn’t read which ones you get: ${cached.error}`}
        control={
          <Button
            size="sm"
            variant="outline"
            onClick={() => void settingsMomentEmails.refresh().catch(() => undefined)}
          >
            Try again
          </Button>
        }
      />,
    );
  }
  const change = (kind: AldoMomentEmailKind, on: boolean) => {
    setSaving((before) => new Set(before).add(kind));
    settingsMomentEmails
      .mutate(
        (before) => (before ? withMomentEmail(before, kind, on) : before),
        () => setAldoMomentEmails(kind, on),
      )
      .catch((cause: unknown) =>
        toastManager.add({
          type: "error",
          title: "Couldn’t change that",
          description: messageOf(cause),
        }),
      )
      .finally(() =>
        setSaving((before) => {
          const after = new Set(before);
          after.delete(kind);
          return after;
        }),
      );
  };
  return section(
    <>
      <SettingsRow
        id="aldo-moment-emails"
        title="Emails when you’re away"
        description={momentEmailsIntro(settings.to)}
      />
      {ALDO_MOMENT_EMAIL_ROWS.map((row) => (
        <SettingsRow
          key={row.kind}
          id={`aldo-moment-emails-${row.kind}`}
          title={row.title}
          description={row.description}
          control={
            <Switch
              checked={settings[row.kind]}
              disabled={saving.has(row.kind)}
              onCheckedChange={(checked) => change(row.kind, checked)}
              aria-label={`Email ${row.title.toLowerCase()}`}
            />
          }
        />
      ))}
    </>,
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

/** Settings → Notifications: what reaches the user, on this device, by email and from Aldo. */
export function AldoNotificationsPage() {
  const connected = useMailConnected();
  return (
    <SettingsPageContainer>
      <AldoNotificationSettings />
      <MomentEmailsSection />
      <SettingsSection title="From Aldo" icon={<SparklesIcon className="size-4" />}>
        <HeadsUpsRow connected={connected} />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
