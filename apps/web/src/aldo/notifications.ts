// Notifications on this device: Aldo tells it when a thread finishes or needs
// the user (Aldo's src/lib/push.ts), through the service worker Aldo serves at
// /sw.js. Offered only when Aldo reports a key (GET /api/push) and the browser
// has push; on an iPhone, once Aldo is added to the Home Screen. Each device is
// turned on by the user, and stays on until turned off here or in the browser.

import { isAldoCloud } from "./cloud";
import {
  aldoNotificationsAvailability,
  base64UrlToBytes,
  parseAldoPushKey,
  subscribedWithKey,
  type AldoNotificationsAvailability,
} from "./notifications.logic";

export type AldoNotificationsStatus =
  | { availability: "unsupported" }
  | { availability: "add-to-home-screen" }
  | { availability: "available"; on: boolean; blocked: boolean };

const WORKER = "/sw.js";

/** Aldo's key, or null if it doesn't report one. Never redirects to sign-in. */
async function fetchKey(): Promise<string | null> {
  try {
    const response = await fetch("/api/push", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    return response.ok ? parseAldoPushKey(await response.json()) : null;
  } catch {
    return null;
  }
}

function hasPush(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function availability(key: string | null): AldoNotificationsAvailability {
  const appleMobile =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return aldoNotificationsAvailability({ key, push: hasPush(), appleMobile, standalone });
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(WORKER);
  return (await registration?.pushManager.getSubscription()) ?? null;
}

async function save(subscription: PushSubscription): Promise<void> {
  const response = await fetch("/api/push", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(subscription),
  });
  if (!response.ok) throw new Error("Aldo couldn't save this device's notifications.");
}

export async function aldoNotificationsStatus(): Promise<AldoNotificationsStatus> {
  const key = await fetchKey();
  const available = availability(key);
  if (available === "add-to-home-screen") return { availability: available };
  if (!key || available !== "available") return { availability: "unsupported" };
  const subscription = await currentSubscription().catch(() => null);
  const on =
    Notification.permission === "granted" &&
    subscribedWithKey(subscription?.options.applicationServerKey ?? null, key);
  return { availability: "available", on, blocked: Notification.permission === "denied" };
}

/** Asks for permission (the browser's prompt), then subscribes this device. False if the user said no. */
export async function enableAldoNotifications(): Promise<boolean> {
  const key = await fetchKey();
  if (!key || !hasPush()) throw new Error("Notifications aren't available here.");
  if ((await Notification.requestPermission()) !== "granted") return false;
  const registration = await navigator.serviceWorker.register(WORKER);
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !subscribedWithKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(key),
  });
  await save(subscription);
  return true;
}

export async function disableAldoNotifications(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await fetch("/api/push", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => undefined);
  await subscription.unsubscribe();
}

/**
 * On load, a device that's on tells Aldo its subscription again (the browser
 * may have renewed it, or Aldo forgotten it), and moves to a new key if
 * Aldo's changed. Does nothing outside Aldo or on a device that's off.
 */
export function installAldoNotificationsSync(): void {
  if (!isAldoCloud || !hasPush() || Notification.permission !== "granted") return;
  void (async () => {
    if (!(await currentSubscription())) return;
    await enableAldoNotifications();
  })().catch(() => undefined);
}
