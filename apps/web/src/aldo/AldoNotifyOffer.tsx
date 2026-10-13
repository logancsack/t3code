// Notifications, offered when they matter: under the working line of a
// thread, the moment the user is about to wait for it, rather than as a
// banner on the home screen. Answered once (turned on, or "Not now"), it
// doesn't ask again on this device; Settings keeps the switch.

import { BellRingIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { toastManager } from "../components/ui/toast";
import { aldoNotificationsStatus, enableAldoNotifications } from "./notifications";

const ANSWERED_KEY = "aldo:notify-offer";

export type AldoNotificationsState = "on" | "off" | "blocked" | "unavailable";

/** Whether this device gets notifications, and a way to turn them on. */
export function useAldoNotifications(): {
  readonly status: AldoNotificationsState;
  readonly enable: () => Promise<boolean>;
} {
  const [status, setStatus] = useState<AldoNotificationsState>("unavailable");
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void aldoNotificationsStatus().then((next) => {
      if (!current) return;
      if (next.availability !== "available") setStatus("unavailable");
      else {
        setKey(next.key);
        setStatus(next.on ? "on" : next.blocked ? "blocked" : next.key ? "off" : "unavailable");
      }
    });
    return () => {
      current = false;
    };
  }, []);
  const enable = useCallback(
    () =>
      enableAldoNotifications(key)
        .then((on) => {
          setStatus(on ? "on" : "off");
          if (on)
            toastManager.add({ type: "success", title: "Notifications are on for this device" });
          return on;
        })
        .catch((cause: unknown) => {
          toastManager.add({
            type: "error",
            title: "Couldn't turn notifications on",
            description: cause instanceof Error ? cause.message : String(cause),
          });
          return false;
        }),
    [key],
  );
  return { status, enable };
}

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

/** "Want a ping when it's done? · Turn on", while notifications are off here and it hasn't been answered. */
export function AldoNotifyOffer() {
  const notifications = useAldoNotifications();
  const [hidden, setHidden] = useState(answered);
  if (hidden || notifications.status !== "off") return null;
  const close = () => {
    answer();
    setHidden(true);
  };
  return (
    <div className="mt-1 flex items-center gap-2 px-1 text-muted-foreground text-xs">
      <BellRingIcon className="size-3.5 shrink-0" />
      <span>Want a ping when it's done?</span>
      <button
        type="button"
        className="font-medium text-foreground hover:underline"
        onClick={() => void notifications.enable().then(close)}
      >
        Turn on
      </button>
      <button
        type="button"
        aria-label="Not now"
        className="rounded p-0.5 hover:bg-accent hover:text-foreground"
        onClick={close}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}
