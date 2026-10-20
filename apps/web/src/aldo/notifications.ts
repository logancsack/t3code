// Notifications on this device: Aldo tells it when a thread finishes or needs
// the user (Aldo's src/lib/push.ts), through the service worker Aldo serves at
// /sw.js. Offered only when Aldo reports a key (GET /api/push) and the browser
// has push; on an iPhone, once Aldo is added to the Home Screen. Each device is
// turned on by the user, and stays on until turned off here or in the browser.
// Where Aldo reports it can (`test`), turning them on sends the device a test,
// and the service worker says when it showed it.

import { randomUUID } from "../lib/utils";
import { isAldoCloud } from "./api";
import {
  ALDO_TEST_LISTEN_MS,
  ALDO_TEST_TIMEOUT_MS,
  aldoBrowser,
  aldoErrorOf,
  aldoTestReducer,
  base64UrlToBytes,
  parseAldoPushKey,
  parseAldoPushTest,
  resolveAldoNotificationsStatus,
  subscribedWithKey,
  type AldoBrowser,
  type AldoNotificationsStatus,
  type AldoTestEvent,
  type AldoTestState,
} from "./notifications.logic";

export type { AldoBrowser, AldoNotificationsStatus, AldoTestState };

const WORKER = "/sw.js";

/** Aldo's key (null if it doesn't report one) and whether it sends tests. Never redirects to sign-in. */
async function fetchInfo(): Promise<{ key: string | null; test: boolean }> {
  try {
    const response = await fetch("/api/push", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return { key: null, test: false };
    const body: unknown = await response.json();
    return { key: parseAldoPushKey(body), test: parseAldoPushTest(body) };
  } catch {
    return { key: null, test: false };
  }
}

function hasPush(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** This browser, for the words that say where its settings are. */
export function currentAldoBrowser(): AldoBrowser {
  return aldoBrowser({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone:
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  });
}

/** An iPhone or iPad (iPadOS reports a Mac with touch), and whether Aldo runs from the Home Screen. */
function device(): { appleMobile: boolean; standalone: boolean } {
  const browser = currentAldoBrowser();
  return { appleMobile: browser.os === "ios", standalone: browser.standalone };
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
  const [{ key, test }, subscription] = await Promise.all([
    fetchInfo(),
    push ? currentSubscription().catch(() => null) : null,
  ]);
  return resolveAldoNotificationsStatus({
    key,
    test,
    push,
    ...device(),
    permission: push ? Notification.permission : null,
    subscriptionKey: subscription ? subscription.options.applicationServerKey : undefined,
  });
}

/**
 * Asks for permission (the browser's prompt) first, while the click still
 * counts as the user's, then subscribes this device with Aldo's key and saves
 * it with Aldo. A subscription Aldo couldn't save is undone. Returns what the
 * user answered: "granted" once it's on, "denied" (blocked, now or before),
 * or "default" (they closed the prompt).
 */
export async function enableAldoNotifications(key: string | null): Promise<NotificationPermission> {
  if (!hasPush()) throw new Error("Notifications aren't available here.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;
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
  return "granted";
}

/**
 * Sends this device a test through Aldo, its push service and the service
 * worker, and reports each step to `onChange`: sent, then shown (the worker
 * says so by the test's id; an older worker says only that a push came), or
 * no word within ALDO_TEST_TIMEOUT_MS. A late arrival still counts until
 * ALDO_TEST_LISTEN_MS. If Aldo says this device's subscription is gone, it's
 * let go here too, so it reads as off. Returns a function that stops
 * listening. Only for an Aldo that reports `test`.
 */
export function testAldoNotifications(onChange: (state: AldoTestState) => void): () => void {
  // The service worker sends it back once it shows the test.
  const id = randomUUID();
  const worker = navigator.serviceWorker;
  const timers: ReturnType<typeof setTimeout>[] = [];
  let state: AldoTestState = { phase: "sending" };
  let stopped = false;
  const stop = () => {
    stopped = true;
    worker.removeEventListener("message", onMessage);
    for (const timer of timers) clearTimeout(timer);
  };
  const update = (event: AldoTestEvent) => {
    if (stopped) return;
    const next = aldoTestReducer(state, event);
    if (next === state) return;
    state = next;
    onChange(state);
    if (state.phase === "arrived" || state.phase === "not-shown") stop();
  };
  function onMessage(event: MessageEvent) {
    const data = event.data as { type?: unknown; id?: unknown; shown?: unknown } | null;
    if (data?.type === "aldo-test" && data.id === id)
      update({ type: data.shown === false ? "refused" : "shown" });
    else if (data?.type === "aldo-push") update({ type: "shown" });
  }
  worker.addEventListener("message", onMessage);
  timers.push(setTimeout(stop, ALDO_TEST_LISTEN_MS));
  onChange(state);
  void (async () => {
    const subscription = await currentSubscription();
    if (!subscription) {
      update({
        type: "failed",
        message: "This browser isn’t set up for notifications. Turn them on again.",
      });
      return;
    }
    const response = await fetch("/api/push/test", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        id,
        // Tapping it comes back here.
        url: location.pathname + location.search + location.hash,
      }),
    });
    if (response.ok) {
      update({ type: "sent" });
      timers.push(setTimeout(() => update({ type: "timeout" }), ALDO_TEST_TIMEOUT_MS));
      return;
    }
    const message = aldoErrorOf(await response.json().catch(() => null));
    if (response.status === 410) await subscription.unsubscribe().catch(() => false);
    update({ type: "failed", message: message ?? "Aldo couldn’t send it just now. Try again." });
  })().catch(() =>
    update({ type: "failed", message: "Aldo can’t be reached just now. Try again." }),
  );
  return stop;
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
    const { key } = await fetchInfo();
    if (key && subscribedWithKey(subscription.options.applicationServerKey, key))
      await save(subscription);
  })().catch(() => undefined);
}
