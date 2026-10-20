// Notifications, offered when they matter: under the working line of a
// thread, the moment the user is about to wait for it, rather than as a
// banner on the home screen. "Notify me" asks the browser, then (where Aldo
// sends tests) sends one and says whether it arrived; a browser that blocks
// them gets where to allow them, in its own settings. Answered once (turned
// on, or "Not now"), it doesn't ask again on this device; Settings keeps the
// switch and the test.

import { BellRingIcon, CircleCheckIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { AldoNotificationTestNote, useAldoNotificationTest } from "./AldoNotificationTest";
import {
  aldoNotificationsStatus,
  currentAldoBrowser,
  enableAldoNotifications,
  type AldoNotificationsStatus,
} from "./notifications";
import { aldoAllowHint, aldoDeviceNoun } from "./notifications.logic";

const ANSWERED_KEY = "aldo:notify-offer";

/** What came of "Notify me": the browser's prompt is open, then its answer, or why it failed. */
type Asked = "asking" | "on" | "denied" | "dismissed" | { readonly error: string };

function answered(): boolean {
  try {
    return window.localStorage.getItem(ANSWERED_KEY) !== null;
  } catch {
    return true;
  }
}

function answer(): void {
  try {
    window.localStorage.setItem(ANSWERED_KEY, new Date().toISOString());
  } catch {
    // Private mode: it asks again next time.
  }
}

const LINK = "font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-50";

/**
 * "Get a notification on this computer when it's done or needs you? · Notify
 * me", while notifications are off here and it hasn't been answered; blocked
 * in the browser, where to allow them; on an iPhone's Safari tab, to add Aldo
 * to the Home Screen first. After the click it stays to say what happened.
 */
export function AldoNotifyOffer() {
  const [status, setStatus] = useState<AldoNotificationsStatus | null>(null);
  const [hidden, setHidden] = useState(answered);
  const [asked, setAsked] = useState<Asked | null>(null);
  const test = useAldoNotificationTest();
  const browser = useMemo(() => currentAldoBrowser(), []);
  useEffect(() => {
    if (hidden) return;
    let current = true;
    void aldoNotificationsStatus().then((next) => {
      if (current) setStatus(next);
    });
    return () => {
      current = false;
    };
  }, [hidden]);

  if (hidden || !status) return null;
  const available = status.availability === "available" ? status : null;
  const off = Boolean(available && !available.on && !available.blocked && available.key);
  const blocked = Boolean(available && !available.on && available.blocked);
  const homeScreen = status.availability === "add-to-home-screen";
  if (asked === null && !off && !blocked && !homeScreen) return null;

  const close = () => {
    answer();
    setHidden(true);
  };
  const notify = () => {
    setAsked("asking");
    // The browser's prompt opens from this click, before anything else is awaited.
    enableAldoNotifications(available?.key ?? null)
      .then((permission) => {
        if (permission !== "granted") {
          setAsked(permission === "denied" ? "denied" : "dismissed");
          return;
        }
        answer();
        setAsked("on");
        if (available?.test) test.run();
      })
      .catch((cause: unknown) =>
        setAsked({ error: cause instanceof Error ? cause.message : String(cause) }),
      );
  };
  const host = window.location.host;
  const notifyButton = (label: string) => (
    <>
      {" "}
      <button type="button" className={LINK} onClick={notify}>
        {label}
      </button>
    </>
  );

  let icon = <BellRingIcon className="mt-0.5 size-3.5 shrink-0" />;
  let words: ReactNode;
  if (asked === "on") {
    icon = <CircleCheckIcon className="mt-0.5 size-3.5 shrink-0 text-success-foreground" />;
    words = (
      <>
        Notifications are on for this browser.
        {available?.test ? (
          <>
            {" "}
            {test.state ? (
              <AldoNotificationTestNote state={test.state} browser={browser} onAgain={test.run} />
            ) : null}
          </>
        ) : null}
      </>
    );
  } else if (asked === "asking") {
    words = "Asking this browser…";
  } else if (asked === "denied" || (asked === null && blocked)) {
    words = `This browser blocks Aldo’s notifications. ${aldoAllowHint(browser, host)}`;
  } else if (asked === "dismissed") {
    words = <>Notifications aren’t on yet.{notifyButton("Notify me")}</>;
  } else if (asked !== null) {
    words = (
      <>
        Couldn’t turn notifications on: {asked.error}
        {notifyButton("Try again")}
      </>
    );
  } else if (homeScreen) {
    words = `Get a notification when it’s done or needs you? ${aldoAllowHint(browser, host)}`;
  } else {
    words = (
      <>
        Get a notification on this {aldoDeviceNoun(browser)} when it’s done or needs you?
        {notifyButton("Notify me")}
      </>
    );
  }

  return (
    <div className="mt-1 flex items-start gap-2 px-1 text-muted-foreground text-xs leading-relaxed">
      {icon}
      <p className="min-w-0 flex-1">{words}</p>
      <button
        type="button"
        aria-label={asked === "on" ? "Close" : "Not now"}
        className="rounded p-0.5 hover:bg-accent hover:text-foreground"
        onClick={close}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}
