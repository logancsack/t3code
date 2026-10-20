import { describe, expect, it } from "vite-plus/test";

import {
  aldoAllowHint,
  aldoBrowser,
  aldoDeviceNoun,
  aldoErrorOf,
  aldoNotSeenHint,
  aldoTestMessage,
  aldoTestPending,
  aldoTestReducer,
  base64UrlToBytes,
  parseAldoPushTest,
  resolveAldoNotificationsStatus,
  type AldoBrowser,
  type AldoTestEvent,
  type AldoTestState,
} from "./notifications.logic";

const KEY = "B".repeat(87);

const UA = {
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  chromeIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  androidTablet:
    "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  samsung:
    "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  chromebook:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

const browser = (
  userAgent: string,
  over: Partial<{ platform: string; maxTouchPoints: number; standalone: boolean }> = {},
) => aldoBrowser({ userAgent, platform: "", maxTouchPoints: 0, standalone: false, ...over });

describe("what Aldo reports", () => {
  it("offers the test only where Aldo says it sends one", () => {
    expect(parseAldoPushTest({ publicKey: KEY, test: true })).toBe(true);
    expect(parseAldoPushTest({ publicKey: KEY })).toBe(false);
    expect(parseAldoPushTest({ publicKey: KEY, test: "yes" })).toBe(false);
    expect(parseAldoPushTest(null)).toBe(false);
  });

  it("carries the test into the status, and never without a key", () => {
    const input = {
      key: KEY,
      push: true,
      appleMobile: false,
      standalone: false,
      permission: "default" as NotificationPermission,
      subscriptionKey: undefined,
    };
    expect(resolveAldoNotificationsStatus({ ...input, test: true })).toEqual({
      availability: "available",
      key: KEY,
      on: false,
      blocked: false,
      test: true,
    });
    // An older Aldo: on as today, without the test.
    expect(
      resolveAldoNotificationsStatus({
        ...input,
        permission: "granted",
        subscriptionKey: base64UrlToBytes(KEY).buffer,
      }),
    ).toMatchObject({ on: true, test: false });
    // Aldo's key can't be read: a device that's on can still be turned off, but not tested.
    expect(
      resolveAldoNotificationsStatus({
        ...input,
        key: null,
        test: true,
        permission: "granted",
        subscriptionKey: base64UrlToBytes(KEY).buffer,
      }),
    ).toMatchObject({ on: true, test: false });
  });

  it("reads Aldo's error, if it gave one", () => {
    expect(aldoErrorOf({ error: " Try again in a few seconds. " })).toBe(
      "Try again in a few seconds.",
    );
    expect(aldoErrorOf({ error: "" })).toBeNull();
    expect(aldoErrorOf("<html>")).toBeNull();
    expect(aldoErrorOf(null)).toBeNull();
  });
});

describe("which browser", () => {
  it("tells the browsers and systems apart", () => {
    expect(browser(UA.chromeMac)).toEqual({
      name: "chrome",
      os: "mac",
      phone: false,
      standalone: false,
    });
    expect(browser(UA.edgeWindows)).toMatchObject({ name: "edge", os: "windows" });
    expect(browser(UA.firefoxLinux)).toMatchObject({ name: "firefox", os: "linux" });
    expect(browser(UA.safariMac)).toMatchObject({ name: "safari", os: "mac" });
    expect(browser(UA.chromebook)).toMatchObject({ name: "chrome", os: "chromeos" });
    expect(browser(UA.androidChrome)).toMatchObject({ name: "chrome", os: "android", phone: true });
    expect(browser(UA.androidTablet)).toMatchObject({
      name: "chrome",
      os: "android",
      phone: false,
    });
    expect(browser(UA.samsung)).toMatchObject({ name: "other", os: "android" });
  });

  it("treats every iPhone browser, and an iPad that says it's a Mac, as Safari on iOS", () => {
    expect(browser(UA.iphone)).toMatchObject({ name: "safari", os: "ios", phone: true });
    expect(browser(UA.chromeIphone)).toMatchObject({ name: "safari", os: "ios" });
    expect(browser(UA.safariMac, { platform: "MacIntel", maxTouchPoints: 5 })).toMatchObject({
      name: "safari",
      os: "ios",
      phone: false,
    });
    expect(browser(UA.iphone, { standalone: true }).standalone).toBe(true);
  });

  it("asks about this computer or this phone", () => {
    expect(aldoDeviceNoun(browser(UA.chromeMac))).toBe("computer");
    expect(aldoDeviceNoun(browser(UA.edgeWindows))).toBe("computer");
    expect(aldoDeviceNoun(browser(UA.iphone))).toBe("phone");
    expect(aldoDeviceNoun(browser(UA.androidChrome))).toBe("phone");
    expect(aldoDeviceNoun(browser(UA.androidTablet))).toBe("device");
  });
});

describe("how to allow them", () => {
  it("points to each browser's own setting", () => {
    expect(aldoAllowHint(browser(UA.chromeMac), "aldo.computer")).toContain(
      "click the icon at the left of the address bar, turn on Notifications",
    );
    expect(aldoAllowHint(browser(UA.edgeWindows), "aldo.computer")).toContain(
      "click the lock at the left of the address bar, set Notifications to Allow",
    );
    expect(aldoAllowHint(browser(UA.firefoxLinux), "aldo.computer")).toContain(
      "clear Blocked next to Send Notifications",
    );
    expect(aldoAllowHint(browser(UA.safariMac), "aldo.computer")).toBe(
      "To allow them, open Safari → Settings → Websites → Notifications and set aldo.computer to Allow.",
    );
    expect(aldoAllowHint(browser(UA.androidChrome), "aldo.computer")).toContain(
      "tap the icon at the left of the address bar, then Permissions",
    );
    expect(aldoAllowHint(browser(UA.samsung), "aldo.computer")).toContain("tap the icon");
    expect(
      aldoAllowHint(
        { name: "other", os: "linux", phone: false, standalone: false },
        "aldo.computer",
      ),
    ).toContain("allow notifications for aldo.computer in this browser’s site settings");
  });

  it("sends an iPhone to the Home Screen first, and once there to its Settings", () => {
    expect(aldoAllowHint(browser(UA.iphone), "aldo.computer")).toContain(
      "add Aldo to your Home Screen first: tap Share, then Add to Home Screen",
    );
    expect(aldoAllowHint(browser(UA.iphone, { standalone: true }), "aldo.computer")).toBe(
      "To allow them, open Settings → Notifications → Aldo and turn on Allow Notifications.",
    );
  });

  it("says where the system hides what the browser shows", () => {
    expect(aldoNotSeenHint(browser(UA.chromeMac))).toBe(
      "Check that Google Chrome can show notifications in System Settings → Notifications, and that Focus is off.",
    );
    expect(aldoNotSeenHint(browser(UA.edgeWindows))).toContain(
      "notifications from Microsoft Edge are on in Settings → System → Notifications",
    );
    expect(aldoNotSeenHint(browser(UA.iphone, { standalone: true }))).toBe(
      "Check Settings → Notifications → Aldo, and that Focus is off.",
    );
    expect(aldoNotSeenHint(browser(UA.androidChrome))).toContain("Settings → Apps → Google Chrome");
    expect(aldoNotSeenHint(browser(UA.firefoxLinux))).toContain("lets Firefox show notifications");
  });
});

describe("a test", () => {
  const run = (...events: AldoTestEvent[]) =>
    events.reduce<AldoTestState>(aldoTestReducer, { phase: "sending" });

  it("waits once Aldo sent it, and arrives when the device shows it", () => {
    expect(run({ type: "sent" })).toEqual({ phase: "waiting" });
    expect(run({ type: "sent" }, { type: "shown" })).toEqual({ phase: "arrived" });
  });

  it("says where to look after the timeout, and still counts a late arrival", () => {
    expect(run({ type: "sent" }, { type: "timeout" })).toEqual({ phase: "not-seen" });
    expect(run({ type: "sent" }, { type: "timeout" }, { type: "shown" })).toEqual({
      phase: "arrived",
    });
  });

  it("starts the timeout only once Aldo has sent it", () => {
    expect(run({ type: "timeout" })).toEqual({ phase: "sending" });
  });

  it("keeps what the device said over what came after or before", () => {
    // The worker's word can come before Aldo's answer.
    expect(run({ type: "shown" }, { type: "sent" }, { type: "timeout" })).toEqual({
      phase: "arrived",
    });
    expect(run({ type: "shown" }, { type: "failed", message: "Network" })).toEqual({
      phase: "arrived",
    });
    expect(run({ type: "sent" }, { type: "refused" }, { type: "shown" })).toEqual({
      phase: "not-shown",
    });
  });

  it("fails only while it's being sent", () => {
    expect(run({ type: "failed", message: "A test just went to this browser." })).toEqual({
      phase: "failed",
      message: "A test just went to this browser.",
    });
    expect(run({ type: "sent" }, { type: "failed", message: "Late" })).toEqual({
      phase: "waiting",
    });
  });

  it("is pending until there's an answer", () => {
    expect(aldoTestPending({ phase: "sending" })).toBe(true);
    expect(aldoTestPending({ phase: "waiting" })).toBe(true);
    expect(aldoTestPending({ phase: "not-seen" })).toBe(false);
    expect(aldoTestPending(null)).toBe(false);
  });

  it("says it arrived, or where to look and offers another", () => {
    const mac: AldoBrowser = browser(UA.chromeMac);
    expect(aldoTestMessage({ phase: "waiting" }, mac)).toEqual({
      text: "Sending a test…",
      again: false,
    });
    expect(aldoTestMessage({ phase: "arrived" }, mac)).toEqual({
      text: "Sent a test. It arrived.",
      again: false,
    });
    expect(aldoTestMessage({ phase: "not-seen" }, mac)).toEqual({
      text: `Sent a test. Didn’t see it? ${aldoNotSeenHint(mac)}`,
      again: true,
    });
    expect(aldoTestMessage({ phase: "not-shown" }, mac).text).toMatch(
      /^Sent a test, but this browser didn’t show it\. Check/,
    );
    expect(aldoTestMessage({ phase: "failed", message: "Try again in a minute." }, mac)).toEqual({
      text: "The test didn’t go: Try again in a minute.",
      again: true,
    });
  });
});
