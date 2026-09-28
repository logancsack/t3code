import { describe, expect, it } from "vite-plus/test";

import {
  aldoNotificationsAvailability,
  base64UrlToBytes,
  parseAldoPushKey,
  subscribedWithKey,
} from "./notifications.logic";

// A P-256 public key as Aldo sends it (65 bytes, base64url).
const KEY =
  "BJ185e0-axGvyor4xfEBbSmDlyuW_artAFhO_EwsmMelXTV9fbjygeLCjaKvRLKEOoZLdT6WJqxcVxNPkgvzSrA";

describe("parseAldoPushKey", () => {
  it("reads the key Aldo reports", () => {
    expect(parseAldoPushKey({ publicKey: KEY })).toBe(KEY);
  });

  it("finds none in anything else (an older Aldo, an error)", () => {
    expect(parseAldoPushKey(null)).toBeNull();
    expect(parseAldoPushKey("<!doctype html>")).toBeNull();
    expect(parseAldoPushKey({ error: "Sign in to continue." })).toBeNull();
    expect(parseAldoPushKey({ publicKey: "short" })).toBeNull();
    expect(parseAldoPushKey({ publicKey: `${KEY}<script>` })).toBeNull();
  });
});

describe("aldoNotificationsAvailability", () => {
  const base = { key: KEY, push: true, appleMobile: false, standalone: false };

  it("is available with Aldo's key and a browser with push", () => {
    expect(aldoNotificationsAvailability(base)).toBe("available");
  });

  it("isn't offered when Aldo has no key", () => {
    expect(aldoNotificationsAvailability({ ...base, key: null })).toBe("unsupported");
  });

  it("tells an iPhone tab to add Aldo to the Home Screen", () => {
    expect(aldoNotificationsAvailability({ ...base, push: false, appleMobile: true })).toBe(
      "add-to-home-screen",
    );
    expect(
      aldoNotificationsAvailability({ ...base, push: false, appleMobile: true, standalone: true }),
    ).toBe("unsupported");
    expect(aldoNotificationsAvailability({ ...base, push: false })).toBe("unsupported");
  });
});

describe("subscribedWithKey", () => {
  it("matches the key a subscription was made with", () => {
    expect(subscribedWithKey(base64UrlToBytes(KEY).buffer, KEY)).toBe(true);
  });

  it("tells a subscription made with another key", () => {
    const other = base64UrlToBytes(KEY);
    other[10] = (other[10] ?? 0) ^ 1;
    expect(subscribedWithKey(other.buffer, KEY)).toBe(false);
    expect(subscribedWithKey(null, KEY)).toBe(false);
  });

  it("decodes base64url with or without padding", () => {
    expect(base64UrlToBytes(KEY)).toHaveLength(65);
    expect(Array.from(base64UrlToBytes("_-8"))).toEqual([255, 239]);
  });
});
