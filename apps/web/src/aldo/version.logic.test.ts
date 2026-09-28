import { describe, expect, it } from "vite-plus/test";

import {
  ALDO_VERSION_CHECK_EVERY_MS,
  ALDO_VERSION_RECHECK_GAP_MS,
  aldoVersionCheckDue,
  INITIAL_ALDO_VERSION_STATE,
  parseAldoVersion,
  recordAldoVersion,
} from "./version.logic";

const T0 = 1_800_000_000_000;

describe("parseAldoVersion", () => {
  it("reads the version Aldo reports", () => {
    expect(parseAldoVersion({ version: "dpl_abc123" })).toBe("dpl_abc123");
  });

  it("finds none in anything else (an older Aldo, an error)", () => {
    expect(parseAldoVersion(null)).toBeNull();
    expect(parseAldoVersion("<!doctype html>")).toBeNull();
    expect(parseAldoVersion({ error: "Sign in to continue." })).toBeNull();
    expect(parseAldoVersion({ version: "" })).toBeNull();
    expect(parseAldoVersion({ version: 3 })).toBeNull();
  });
});

describe("recordAldoVersion", () => {
  it("remembers the first version as the one the tab loaded with", () => {
    const state = recordAldoVersion(INITIAL_ALDO_VERSION_STATE, "dpl_a", T0);
    expect(state).toEqual({ loaded: "dpl_a", checkedAt: T0, failed: false, updated: false });
  });

  it("stays quiet while the version is the same", () => {
    const loaded = recordAldoVersion(INITIAL_ALDO_VERSION_STATE, "dpl_a", T0);
    expect(recordAldoVersion(loaded, "dpl_a", T0 + 1000).updated).toBe(false);
  });

  it("reports an update once the version changes", () => {
    const loaded = recordAldoVersion(INITIAL_ALDO_VERSION_STATE, "dpl_a", T0);
    const state = recordAldoVersion(loaded, "dpl_b", T0 + 1000);
    expect(state.updated).toBe(true);
    expect(state.loaded).toBe("dpl_a");
  });

  it("never reports an update from a failed check", () => {
    const loaded = recordAldoVersion(INITIAL_ALDO_VERSION_STATE, "dpl_a", T0);
    const state = recordAldoVersion(loaded, null, T0 + 1000);
    expect(state).toMatchObject({ loaded: "dpl_a", failed: true, updated: false });
    expect(recordAldoVersion(INITIAL_ALDO_VERSION_STATE, null, T0)).toMatchObject({
      loaded: null,
      failed: true,
      updated: false,
    });
  });
});

describe("aldoVersionCheckDue", () => {
  const loaded = recordAldoVersion(INITIAL_ALDO_VERSION_STATE, "dpl_a", T0);

  it("checks every 10 minutes on the timer", () => {
    expect(aldoVersionCheckDue(loaded, T0 + ALDO_VERSION_CHECK_EVERY_MS - 1, "interval")).toBe(
      false,
    );
    expect(aldoVersionCheckDue(loaded, T0 + ALDO_VERSION_CHECK_EVERY_MS, "interval")).toBe(true);
  });

  it("checks when the tab comes back, at most once a minute", () => {
    expect(aldoVersionCheckDue(loaded, T0 + 5_000, "visible")).toBe(false);
    expect(aldoVersionCheckDue(loaded, T0 + ALDO_VERSION_RECHECK_GAP_MS, "visible")).toBe(true);
  });

  it("doesn't retry fast after a failure (an older Aldo without the route)", () => {
    const failed = recordAldoVersion(INITIAL_ALDO_VERSION_STATE, null, T0);
    expect(aldoVersionCheckDue(failed, T0 + ALDO_VERSION_RECHECK_GAP_MS, "visible")).toBe(false);
    expect(aldoVersionCheckDue(failed, T0 + ALDO_VERSION_CHECK_EVERY_MS - 1, "interval")).toBe(
      false,
    );
    expect(aldoVersionCheckDue(failed, T0 + ALDO_VERSION_CHECK_EVERY_MS, "visible")).toBe(true);
  });

  it("stops checking once an update is found", () => {
    const updated = recordAldoVersion(loaded, "dpl_b", T0);
    expect(aldoVersionCheckDue(updated, T0 + 10 * ALDO_VERSION_CHECK_EVERY_MS, "interval")).toBe(
      false,
    );
  });
});
