import { describe, expect, it } from "vite-plus/test";

import {
  base64UrlToBytes,
  parseAldoPushKey,
  resolveAldoNotificationsStatus,
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

describe("base64UrlToBytes", () => {
  it("decodes base64url with or without padding", () => {
    expect(base64UrlToBytes(KEY)).toHaveLength(65);
    expect(Array.from(base64UrlToBytes("_-8"))).toEqual([255, 239]);
  });
});

describe("resolveAldoNotificationsStatus", () => {
  const device = { push: true, appleMobile: false, standalone: false };
  const keyBytes = () => base64UrlToBytes(KEY).buffer;

  it("is on for a device subscribed with Aldo's key", () => {
    expect(
      resolveAldoNotificationsStatus({
        ...device,
        key: KEY,
        permission: "granted",
        subscriptionKey: keyBytes(),
      }),
    ).toEqual({ availability: "available", key: KEY, on: true, blocked: false });
  });

  it("keeps a device that's on able to turn off while Aldo's key can't be read", () => {
    expect(
      resolveAldoNotificationsStatus({
        ...device,
        key: null,
        permission: "granted",
        subscriptionKey: keyBytes(),
      }),
    ).toEqual({ availability: "available", key: null, on: true, blocked: false });
  });

  it("reads a subscription made with an older key as off", () => {
    const old = base64UrlToBytes(KEY);
    old[5] = (old[5] ?? 0) ^ 1;
    expect(
      resolveAldoNotificationsStatus({
        ...device,
        key: KEY,
        permission: "granted",
        subscriptionKey: old.buffer,
      }),
    ).toEqual({ availability: "available", key: KEY, on: false, blocked: false });
  });

  it("is off without a subscription, and blocked when the browser denies Aldo", () => {
    expect(
      resolveAldoNotificationsStatus({
        ...device,
        key: KEY,
        permission: "default",
        subscriptionKey: undefined,
      }),
    ).toEqual({ availability: "available", key: KEY, on: false, blocked: false });
    expect(
      resolveAldoNotificationsStatus({
        ...device,
        key: KEY,
        permission: "denied",
        subscriptionKey: undefined,
      }),
    ).toEqual({ availability: "available", key: KEY, on: false, blocked: true });
  });

  it("isn't offered without a key and without a subscription, and points iPhones to the Home Screen", () => {
    expect(
      resolveAldoNotificationsStatus({
        ...device,
        key: null,
        permission: "default",
        subscriptionKey: undefined,
      }),
    ).toEqual({ availability: "unsupported" });
    expect(
      resolveAldoNotificationsStatus({
        key: KEY,
        push: false,
        appleMobile: true,
        standalone: false,
        permission: null,
        subscriptionKey: undefined,
      }),
    ).toEqual({ availability: "add-to-home-screen" });
    for (const appleMobile of [true, false]) {
      expect(
        resolveAldoNotificationsStatus({
          key: KEY,
          push: false,
          appleMobile,
          standalone: true,
          permission: null,
          subscriptionKey: undefined,
        }),
      ).toEqual({ availability: "unsupported" });
    }
  });
});
