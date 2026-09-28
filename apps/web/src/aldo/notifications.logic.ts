// Pure parts of notifications on this device (notifications.ts).

/** Aldo's key for push subscriptions, or null if it doesn't report one (an older Aldo, an error). */
export function parseAldoPushKey(body: unknown): string | null {
  const key = (body as { publicKey?: unknown } | null)?.publicKey;
  return typeof key === "string" && /^[A-Za-z0-9_-]{80,100}$/.test(key) ? key : null;
}

export type AldoNotificationsAvailability = "available" | "add-to-home-screen" | "unsupported";

/**
 * Whether this device can get notifications from Aldo: it needs Aldo's key and
 * a browser with push. An iPhone or iPad has push only in a web app added to
 * the Home Screen, so a Safari tab there is told how to get it.
 */
export function aldoNotificationsAvailability(input: {
  key: string | null;
  push: boolean;
  appleMobile: boolean;
  standalone: boolean;
}): AldoNotificationsAvailability {
  if (!input.key) return "unsupported";
  if (input.push) return "available";
  return input.appleMobile && !input.standalone ? "add-to-home-screen" : "unsupported";
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type AldoNotificationsStatus =
  | { availability: "unsupported" }
  | { availability: "add-to-home-screen" }
  | { availability: "available"; key: string | null; on: boolean; blocked: boolean };

/**
 * What the settings row shows. A device that's on can always be turned off,
 * even while Aldo's key can't be read; one subscribed with an older key reads
 * as off until the user turns it on again (a new subscription needs their
 * click on some browsers).
 */
export function resolveAldoNotificationsStatus(input: {
  key: string | null;
  push: boolean;
  appleMobile: boolean;
  standalone: boolean;
  permission: NotificationPermission | null;
  /** The browser's subscription's key; undefined when there's no subscription. */
  subscriptionKey: ArrayBuffer | null | undefined;
}): AldoNotificationsStatus {
  const subscribed =
    input.push && input.permission === "granted" && input.subscriptionKey !== undefined;
  if (subscribed && (!input.key || subscribedWithKey(input.subscriptionKey ?? null, input.key))) {
    return { availability: "available", key: input.key, on: true, blocked: false };
  }
  const availability = aldoNotificationsAvailability(input);
  if (availability !== "available") return { availability };
  return { availability, key: input.key, on: false, blocked: input.permission === "denied" };
}

/** Whether a subscription was made with this key (Aldo's key changes if its secret is rotated). */
export function subscribedWithKey(applicationServerKey: ArrayBuffer | null, key: string): boolean {
  if (!applicationServerKey) return false;
  const a = new Uint8Array(applicationServerKey);
  const b = base64UrlToBytes(key);
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}
