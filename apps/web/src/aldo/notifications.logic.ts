// Pure parts of notifications on this device (notifications.ts).

/** Aldo's key for push subscriptions, or null if it doesn't report one (an older Aldo, an error). */
export function parseAldoPushKey(body: unknown): string | null {
  const key = (body as { publicKey?: unknown } | null)?.publicKey;
  return typeof key === "string" && /^[A-Za-z0-9_-]{80,100}$/.test(key) ? key : null;
}

/** Whether Aldo sends a device a test (POST /api/push/test): only one that says so; an older one doesn't. */
export function parseAldoPushTest(body: unknown): boolean {
  return (body as { test?: unknown } | null)?.test === true;
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
  | {
      availability: "available";
      key: string | null;
      on: boolean;
      blocked: boolean;
      /** Aldo can send this device a test. */
      test: boolean;
    };

/**
 * What the settings row shows. A device that's on can always be turned off,
 * even while Aldo's key can't be read; one subscribed with an older key reads
 * as off until the user turns it on again (a new subscription needs their
 * click on some browsers).
 */
export function resolveAldoNotificationsStatus(input: {
  key: string | null;
  /** Aldo reports it sends tests; false from an older Aldo. */
  test?: boolean;
  push: boolean;
  appleMobile: boolean;
  standalone: boolean;
  permission: NotificationPermission | null;
  /** The browser's subscription's key; undefined when there's no subscription. */
  subscriptionKey: ArrayBuffer | null | undefined;
}): AldoNotificationsStatus {
  const test = Boolean(input.key && input.test);
  const subscribed =
    input.push && input.permission === "granted" && input.subscriptionKey !== undefined;
  if (subscribed && (!input.key || subscribedWithKey(input.subscriptionKey ?? null, input.key))) {
    return { availability: "available", key: input.key, on: true, blocked: false, test };
  }
  const availability = aldoNotificationsAvailability(input);
  if (availability !== "available") return { availability };
  return { availability, key: input.key, on: false, blocked: input.permission === "denied", test };
}

/** Whether a subscription was made with this key (Aldo's key changes if its secret is rotated). */
export function subscribedWithKey(applicationServerKey: ArrayBuffer | null, key: string): boolean {
  if (!applicationServerKey) return false;
  const a = new Uint8Array(applicationServerKey);
  const b = base64UrlToBytes(key);
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** Which browser this is, on what, for where its notification settings are. */
export type AldoBrowser = {
  readonly name: "chrome" | "edge" | "firefox" | "safari" | "other";
  readonly os: "mac" | "windows" | "linux" | "chromeos" | "ios" | "android" | "other";
  /** A phone rather than a tablet or computer. */
  readonly phone: boolean;
  /** Aldo runs as an app added to the Home Screen (or installed), not in a tab. */
  readonly standalone: boolean;
};

export function aldoBrowser(input: {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  standalone: boolean;
}): AldoBrowser {
  const ua = input.userAgent;
  // iPadOS reports a Mac with touch.
  const ios =
    /iPhone|iPad|iPod/.test(ua) || (input.platform === "MacIntel" && input.maxTouchPoints > 1);
  const os: AldoBrowser["os"] = ios
    ? "ios"
    : /Android/.test(ua)
      ? "android"
      : /CrOS/.test(ua)
        ? "chromeos"
        : /Windows/.test(ua)
          ? "windows"
          : /Macintosh|Mac OS X/.test(ua)
            ? "mac"
            : /Linux/.test(ua)
              ? "linux"
              : "other";
  // Every browser on an iPhone is Safari underneath, with Safari's settings.
  const name: AldoBrowser["name"] = ios
    ? "safari"
    : /Edg(e|A)?\//.test(ua)
      ? "edge"
      : /Firefox\//.test(ua)
        ? "firefox"
        : /OPR\/|SamsungBrowser\/|YaBrowser\//.test(ua)
          ? "other"
          : /Chrome\/|Chromium\//.test(ua)
            ? "chrome"
            : /Safari\//.test(ua) && os === "mac"
              ? "safari"
              : "other";
  const phone = /iPhone|iPod/.test(ua) || (os === "android" && /Mobile/.test(ua));
  return { name, os, phone, standalone: input.standalone };
}

/** "this computer" or "this phone", as the offer asks. */
export function aldoDeviceNoun(browser: AldoBrowser): "computer" | "phone" | "device" {
  if (browser.phone) return "phone";
  return browser.os === "ios" || browser.os === "android" || browser.os === "other"
    ? "device"
    : "computer";
}

const APP_NAME: Record<AldoBrowser["name"], string> = {
  chrome: "Google Chrome",
  edge: "Microsoft Edge",
  firefox: "Firefox",
  safari: "Safari",
  other: "your browser",
};

/**
 * How to allow Aldo's notifications once the browser blocks them (the user
 * said no, or blocked them before): where that browser keeps the setting.
 * `host` is Aldo's address as the browser lists it.
 */
export function aldoAllowHint(browser: AldoBrowser, host: string): string {
  if (browser.os === "ios") {
    return browser.standalone
      ? "To allow them, open Settings → Notifications → Aldo and turn on Allow Notifications."
      : "On an iPhone or iPad, add Aldo to your Home Screen first: tap Share, then Add to Home Screen. Open Aldo from there and turn them on.";
  }
  if (browser.os === "android") {
    return "To allow them, tap the icon at the left of the address bar, then Permissions, and allow Notifications.";
  }
  switch (browser.name) {
    case "chrome":
      return "To allow them, click the icon at the left of the address bar, turn on Notifications, then reload the page.";
    case "edge":
      return "To allow them, click the lock at the left of the address bar, set Notifications to Allow, then reload the page.";
    case "firefox":
      return "To allow them, click the crossed-out icon at the left of the address bar, clear Blocked next to Send Notifications, then reload the page.";
    case "safari":
      return `To allow them, open Safari → Settings → Websites → Notifications and set ${host} to Allow.`;
    default:
      return `To allow them, allow notifications for ${host} in this browser’s site settings, then reload the page.`;
  }
}

/**
 * Where to look when the browser has notifications on for Aldo but none
 * showed: the system's own switch for the browser, and Do Not Disturb.
 */
export function aldoNotSeenHint(browser: AldoBrowser): string {
  const app = APP_NAME[browser.name];
  switch (browser.os) {
    case "ios":
      return "Check Settings → Notifications → Aldo, and that Focus is off.";
    case "android":
      return `Check that ${app} can show notifications in Settings → Apps → ${app} → Notifications.`;
    case "mac":
      return `Check that ${app} can show notifications in System Settings → Notifications, and that Focus is off.`;
    case "windows":
      return `Check that notifications from ${app} are on in Settings → System → Notifications, and that Do not disturb is off.`;
    default:
      return `Check that your system lets ${app} show notifications, and that Do Not Disturb is off.`;
  }
}

/** How long to wait for the test before saying where to look; one that comes later still counts. */
export const ALDO_TEST_TIMEOUT_MS = 15_000;
/** How long to listen for the test at all. */
export const ALDO_TEST_LISTEN_MS = 120_000;

/** A test notification, from sending it to what this device's service worker said. */
export type AldoTestState =
  | { readonly phase: "sending" }
  /** Aldo handed it to the push service; waiting for the device's word. */
  | { readonly phase: "waiting" }
  /** The service worker showed it. */
  | { readonly phase: "arrived" }
  /** The service worker got it, and the browser wouldn't show it. */
  | { readonly phase: "not-shown" }
  /** No word within ALDO_TEST_TIMEOUT_MS. */
  | { readonly phase: "not-seen" }
  /** `gone`: this browser's subscription is gone (and let go), so notifications are off here. */
  | { readonly phase: "failed"; readonly message: string; readonly gone?: boolean };

export type AldoTestEvent =
  | { readonly type: "sent" }
  | { readonly type: "shown" }
  | { readonly type: "refused" }
  | { readonly type: "timeout" }
  /** Stopped listening (ALDO_TEST_LISTEN_MS): whatever's still pending ends. */
  | { readonly type: "expired" }
  | { readonly type: "failed"; readonly message: string; readonly gone?: boolean };

/**
 * The next state of a test. What the device said wins: shown, even after the
 * timeout or a request that failed on the way back, is arrived, and nothing
 * changes it after. The timeout counts only once Aldo has sent it. Expired,
 * nothing is pending: one Aldo never answered failed, one it sent wasn't seen.
 */
export function aldoTestReducer(state: AldoTestState, event: AldoTestEvent): AldoTestState {
  if (state.phase === "arrived" || state.phase === "not-shown") return state;
  switch (event.type) {
    case "shown":
      return { phase: "arrived" };
    case "refused":
      return { phase: "not-shown" };
    case "sent":
      return state.phase === "sending" ? { phase: "waiting" } : state;
    case "timeout":
      return state.phase === "waiting" ? { phase: "not-seen" } : state;
    case "expired":
      if (state.phase === "sending")
        return { phase: "failed", message: "Aldo didn’t answer. Try again." };
      return state.phase === "waiting" ? { phase: "not-seen" } : state;
    case "failed":
      return state.phase === "sending"
        ? { phase: "failed", message: event.message, ...(event.gone ? { gone: true } : {}) }
        : state;
  }
}

/** Whether a test is still waiting for an answer. */
export function aldoTestPending(state: AldoTestState | null): boolean {
  return state?.phase === "sending" || state?.phase === "waiting";
}

/**
 * What a test's result says, and whether to offer another: "Sent a test. It
 * arrived." or, without a word from the device, where to look.
 */
export function aldoTestMessage(
  state: AldoTestState,
  browser: AldoBrowser,
): { readonly text: string; readonly again: boolean } {
  switch (state.phase) {
    case "sending":
    case "waiting":
      return { text: "Sending a test…", again: false };
    case "arrived":
      return { text: "Sent a test. It arrived.", again: false };
    case "not-shown":
      return {
        text: `Sent a test, but this browser didn’t show it. ${aldoNotSeenHint(browser)}`,
        again: true,
      };
    case "not-seen":
      return { text: `Sent a test. Didn’t see it? ${aldoNotSeenHint(browser)}`, again: true };
    case "failed":
      // Gone, another can't go until notifications are on again.
      return { text: `The test didn’t go: ${state.message}`, again: !state.gone };
  }
}

/** The error an Aldo response gives, or null. */
export function aldoErrorOf(body: unknown): string | null {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === "string" && error.trim() ? error.trim() : null;
}
