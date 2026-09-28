// Notifications on this device: Aldo tells it when a thread finishes or needs
// the user (Aldo's src/lib/push.ts), through the service worker Aldo serves at
// /sw.js. Offered only when Aldo reports a key (GET /api/push) and the browser
// has push; on an iPhone, once Aldo is added to the Home Screen. Each device is
// turned on by the user, and stays on until turned off here or in the browser.

import { isAldoCloud } from "./cloud";
import {
  base64UrlToBytes,
  parseAldoPushKey,
  resolveAldoNotificationsStatus,
  subscribedWithKey,
  type AldoNotificationsStatus,
} from "./notifications.logic";

export type { AldoNotificationsStatus };

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

/** An iPhone or iPad (iPadOS reports a Mac with touch), and whether Aldo runs from the Home Screen. */
function device(): { appleMobile: boolean; standalone: boolean } {
  const appleMobile =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return { appleMobile, standalone };
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
  const push = hasPush();
  const [key, subscription] = await Promise.all([
    fetchKey(),
    push ? currentSubscription().catch(() => null) : null,
  ]);
  return resolveAldoNotificationsStatus({
    key,
    push,
    ...device(),
    permission: push ? Notification.permission : null,
    subscriptionKey: subscription ? subscription.options.applicationServerKey : undefined,
  });
}

/**
 * Asks for permission (the browser's prompt) first, while the click still
 * counts as the user's, then subscribes this device with Aldo's key and saves
 * it with Aldo. A subscription Aldo couldn't save is undone. False if the user
 * said no.
 */
export async function enableAldoNotifications(key: string | null): Promise<boolean> {
  if (!hasPush()) throw new Error("Notifications aren't available here.");
  if ((await Notification.requestPermission()) !== "granted") return false;
  if (!key) throw new Error("Aldo can't be reached just now; try again.");
  const registration = await navigator.serviceWorker.register(WORKER);
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !subscribedWithKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  const created = !subscription;
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(key),
  });
  try {
    await save(subscription);
  } catch (error) {
    if (created) await subscription.unsubscribe().catch(() => false);
    throw error;
  }
  return true;
}

/**
 * Unsubscribes this device, then tells Aldo to forget it. If the browser
 * doesn't let go, Aldo keeps it and the switch stays on. (Aldo also forgets a
 * subscription the first time the push service says it's gone.)
 */
export async function disableAldoNotifications(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  const { endpoint } = subscription;
  if (!(await subscription.unsubscribe()))
    throw new Error("This browser didn't turn notifications off; try again.");
  await fetch("/api/push", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => undefined);
}

/**
 * On load, a device that's on tells Aldo its subscription again (the browser
 * may have renewed it, or Aldo forgotten it). One made with an older key is
 * left alone: settings shows it off, and turning it on (a click) replaces it.
 * Does nothing outside Aldo or on a device that's off.
 */
export function installAldoNotificationsSync(): void {
  if (!isAldoCloud || !hasPush() || Notification.permission !== "granted") return;
  void (async () => {
    const subscription = await currentSubscription();
    if (!subscription) return;
    const key = await fetchKey();
    if (key && subscribedWithKey(subscription.options.applicationServerKey, key))
      await save(subscription);
  })().catch(() => undefined);
}
