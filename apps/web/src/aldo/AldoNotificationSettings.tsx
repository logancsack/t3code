import {
  settingsBrief,
  settingsHeadsUps,
  settingsIntegrations,
  settingsMomentEmails,
} from "./settingsData";
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
import { Textarea } from "../components/ui/textarea";
import { toastManager } from "../components/ui/toast";
import { playAldoChime, setAldoSound, useAldoSound } from "./chime";
import {
  setAldoBriefSettings,
  setAldoHeadsUps,
  setAldoMomentEmails,
  type AldoHeadsUps,
  type AldoHeadsUpsChange,
  type AldoHeadsUpsTuning,
} from "./accountApi";
import { AldoPolicySelect, AldoPolicySubList, AldoPolicySubRow } from "./AldoPolicy";
import { BRIEF_OFF, briefTimeOptions } from "./briefSettings.logic";
import {
  HEADS_UP_TOPIC_CHARS,
  appsEveryOptions,
  appsNote,
  quietHoursChange,
  quietHoursOn,
  quietTimeOptions,
  topicsChange,
} from "./headsUps.logic";
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

/** Saves a change to the heads-ups and quiet hours, showing it at once; says whether it was kept. */
function useHeadsUpsChange() {
  const [saving, setSaving] = useState(false);
  const change = (next: AldoHeadsUpsChange) => {
    setSaving(true);
    return settingsHeadsUps
      .mutate(
        (before) => (before ? withHeadsUpsChange(before, next) : before),
        () => setAldoHeadsUps(next),
      )
      .then(
        () => true,
        (cause: unknown) => {
          toastManager.add({
            type: "error",
            title: "Couldn't change that",
            description: messageOf(cause),
          });
          return false;
        },
      )
      .finally(() => setSaving(false));
  };
  return { saving, change };
}

/**
 * Quiet hours, off until the user turns them on, then from a time until a
 * time where they are: Aldo holds heads-ups, finished threads and agents' news
 * until they end, and still sounds whatever needs the user. Off is the same
 * time at both ends, which is how Aldo keeps it (quietHoursOn). Hidden on an
 * Aldo that doesn't let them be set.
 */
function QuietHoursRow() {
  const tuning = useSettingsResource(settingsHeadsUps).data?.tuning;
  const { saving, change } = useHeadsUpsChange();
  const zone = useMemo(() => new Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  if (!tuning) return null;
  const on = quietHoursOn(tuning);
  return (
    <SettingsRow
      {...searchableSetting("aldo-quiet-hours")}
      description="Aldo holds heads-ups, finished threads and news from agents until quiet hours end. Anything that needs you, like a question, an approval or a sign-in, still comes through."
      control={
        <Switch
          checked={on}
          disabled={saving}
          onCheckedChange={(checked) => void change(quietHoursChange(checked))}
          aria-label="Quiet hours"
        />
      }
    >
      {on ? (
        <AldoPolicySubList>
          <AldoPolicySubRow
            label="From"
            control={
              <AldoPolicySelect
                value={String(tuning.quietStart)}
                options={quietTimeOptions(tuning.quietStart, tuning.quietEnd)}
                label="Quiet hours start"
                disabled={saving}
                className="w-32"
                onChange={(value) => void change({ quietStart: Number(value) })}
              />
            }
          />
          <AldoPolicySubRow
            label="Until"
            control={
              <AldoPolicySelect
                value={String(tuning.quietEnd)}
                options={quietTimeOptions(tuning.quietEnd, tuning.quietStart)}
                label="Quiet hours end"
                disabled={saving}
                className="w-32"
                onChange={(value) => void change({ quietEnd: Number(value) })}
              />
            }
          />
          <p className="text-muted-foreground text-xs">Times are where you are now ({zone}).</p>
        </AldoPolicySubList>
      ) : null}
    </SettingsRow>
  );
}

/**
 * Aldo's heads-ups, on or off, once Aldo has them: they need an account with
 * mail or a calendar, or another app it can read, so without one the row says
 * to connect one. On an Aldo that lets them be tuned, under the switch: how
 * often it reads the other apps, and what to hear about or not.
 */
function HeadsUpsRow(props: { readonly connected: boolean | null }) {
  const cached = useSettingsResource(settingsHeadsUps);
  const headsUps = cached.data;
  const error = cached.error;
  const { saving, change } = useHeadsUpsChange();
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
  const description = headsUps?.tuning
    ? "Every half hour outside your quiet hours, Aldo looks at your new mail and coming events and tells you what's worth knowing (here and on your phone), sometimes with a thread to start for it. Your other apps it reads every few hours. Most looks say nothing."
    : "Every half hour of your day, Aldo looks at your new mail and coming events and tells you what's worth knowing (here and on your phone), sometimes with a thread to start for it. Most looks say nothing.";
  if (!headsUps) {
    return (
      <SettingsRow
        {...searchableSetting("aldo-heads-ups")}
        description={description}
        status={headsUps === null ? "Not on this Aldo yet." : "Checking…"}
      />
    );
  }
  // With nothing to read, there's nothing to tell: mail, a calendar, or another app.
  const nothingToRead = props.connected === false && (headsUps.tuning?.apps.length ?? 0) === 0;
  return (
    <SettingsRow
      {...searchableSetting("aldo-heads-ups")}
      description={description}
      {...(nothingToRead
        ? {
            status: (
              <>
                {headsUps.tuning
                  ? "They need your mail, calendar or another app: "
                  : "They need your mail or calendar: "}
                <Link to="/settings/connections" className="underline underline-offset-2">
                  {headsUps.tuning ? "connect one" : "connect Google or Microsoft"}
                </Link>
                .
              </>
            ),
          }
        : {})}
      control={
        <Switch
          checked={headsUps.on}
          disabled={saving || nothingToRead}
          onCheckedChange={(on) => void change({ on })}
          aria-label="Heads-ups from Aldo"
        />
      }
    >
      {headsUps.on && headsUps.tuning && !nothingToRead ? (
        <HeadsUpsTuning tuning={headsUps.tuning} saving={saving} change={change} />
      ) : null}
    </SettingsRow>
  );
}

/** The heads-ups with a change applied, as Aldo will answer once it's saved. */
function withHeadsUpsChange(before: AldoHeadsUps, change: AldoHeadsUpsChange): AldoHeadsUps {
  const { on, ...tuning } = change;
  return {
    ...before,
    ...(on === undefined ? {} : { on }),
    tuning: before.tuning ? { ...before.tuning, ...tuning } : null,
  };
}

/**
 * Under the switch: how often Aldo reads the other apps, and what the user
 * wants to hear about or not, saved together when they're done.
 */
function HeadsUpsTuning(props: {
  readonly tuning: AldoHeadsUpsTuning;
  readonly saving: boolean;
  readonly change: (change: AldoHeadsUpsChange) => Promise<boolean>;
}) {
  const { tuning, saving, change } = props;
  // What they're typing; null shows what's saved (and follows it).
  const [draft, setDraft] = useState<{ tell: string; skip: string } | null>(null);
  const topics = draft ?? { tell: tuning.tell, skip: tuning.skip };
  const topicChange = draft ? topicsChange(tuning, draft) : {};
  const edited = Object.keys(topicChange).length > 0;
  const apps = appsNote(tuning);
  // Saved, it shows what's saved, unless they typed more meanwhile.
  const saveTopics = () => {
    const sent = draft;
    void change(topicChange).then((saved) => {
      if (saved) setDraft((current) => (current === sent ? null : current));
    });
  };
  return (
    <AldoPolicySubList>
      <AldoPolicySubRow
        label="Other apps"
        control={
          <AldoPolicySelect
            value={String(tuning.appsEvery)}
            options={appsEveryOptions(tuning.appsEvery)}
            label="How often Aldo reads your other apps"
            disabled={saving || tuning.apps.length === 0}
            className="w-36"
            onChange={(value) => void change({ appsEvery: Number(value) })}
          />
        }
      />
      <p className="text-muted-foreground text-xs">
        {apps ?? (
          <>
            None connected yet.{" "}
            <Link to="/settings/connections" className="underline underline-offset-2">
              Connect an app
            </Link>{" "}
            and Aldo reads what's new in it.
          </>
        )}
      </p>
      <label className="block space-y-1 pt-1">
        <span className="text-sm">Tell me about</span>
        <Textarea
          size="sm"
          className="text-sm"
          placeholder="Anything from my landlord, flight changes"
          maxLength={HEADS_UP_TOPIC_CHARS}
          value={topics.tell}
          onChange={(e) => setDraft({ ...topics, tell: e.currentTarget.value })}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm">Don't tell me about</span>
        <Textarea
          size="sm"
          className="text-sm"
          placeholder="Newsletters, package tracking"
          maxLength={HEADS_UP_TOPIC_CHARS}
          value={topics.skip}
          onChange={(e) => setDraft({ ...topics, skip: e.currentTarget.value })}
        />
      </label>
      {edited ? (
        <div className="flex justify-end gap-2 pb-1">
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => setDraft(null)}>
            Cancel
          </Button>
          <Button size="sm" disabled={saving} onClick={saveTopics}>
            Save
          </Button>
        </div>
      ) : null}
    </AldoPolicySubList>
  );
}

/**
 * The brief on the user's devices each day, at the time they choose, or off.
 * Hidden on an Aldo that doesn't send it (it answers 404).
 */
function BriefRow() {
  const cached = useSettingsResource(settingsBrief);
  const brief = cached.data;
  const [saving, setSaving] = useState(false);
  if (brief === null) return null;
  const description =
    "Each day at this time, Aldo sends your brief to the devices you turned notifications on for: what needs you, what it's watching and what can wait. If you've opened Aldo by then, it doesn't.";
  if (!brief) {
    return (
      <SettingsRow
        {...searchableSetting("aldo-brief")}
        description={cached.error ? `Couldn't read when it comes: ${cached.error}` : description}
        {...(cached.error
          ? {
              control: (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void settingsBrief.refresh().catch(() => undefined)}
                >
                  Try again
                </Button>
              ),
            }
          : { status: "Checking…" })}
      />
    );
  }
  const change = (value: string) => {
    const next = value === BRIEF_OFF ? { push: false } : { minute: Number(value), push: true };
    setSaving(true);
    settingsBrief
      .mutate(
        (before) => (before ? { ...before, ...next } : before),
        () => setAldoBriefSettings(next),
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
      {...searchableSetting("aldo-brief")}
      description={description}
      control={
        <AldoPolicySelect
          value={brief.push ? String(brief.minute) : BRIEF_OFF}
          options={briefTimeOptions(brief.minute)}
          label="When your brief comes"
          disabled={saving}
          className="w-full sm:w-36"
          onChange={change}
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
        <QuietHoursRow />
        <BriefRow />
        <HeadsUpsRow connected={connected} />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
