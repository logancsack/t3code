import { describe, expect, it } from "vite-plus/test";

import { refollowThreadOnce, shouldRefollowThread } from "./threadState.ts";

describe("shouldRefollowThread", () => {
  it("follows a thread the server didn't know again once its live shell lists it", () => {
    expect(
      shouldRefollowThread({
        state: { status: "deleted", notFound: true },
        listed: true,
        shellStatus: "live",
      }),
    ).toBe(true);
  });

  it("leaves a thread the server reported deleted, though its shell still lists it", () => {
    // The shell drops a deleted thread a moment after the thread's own stream does.
    expect(
      shouldRefollowThread({
        state: { status: "deleted" },
        listed: true,
        shellStatus: "live",
      }),
    ).toBe(false);
  });

  it("leaves it while only a cached shell lists it", () => {
    // A cached shell can list a thread the server doesn't have yet.
    expect(
      shouldRefollowThread({
        state: { status: "deleted", notFound: true },
        listed: true,
        shellStatus: "cached",
      }),
    ).toBe(false);
  });

  it("leaves threads the server doesn't list, and ones it follows", () => {
    expect(
      shouldRefollowThread({
        state: { status: "deleted", notFound: true },
        listed: false,
        shellStatus: "live",
      }),
    ).toBe(false);
    expect(
      shouldRefollowThread({
        state: { status: "live" },
        listed: true,
        shellStatus: "live",
      }),
    ).toBe(false);
  });
});

describe("refollowThreadOnce", () => {
  it("follows a thread again once per version of its shell", () => {
    let calls = 0;
    const refollow = () => {
      calls += 1;
    };
    refollowThreadOnce("env:thread-once", "2026-10-02T17:00:00.000Z", refollow);
    refollowThreadOnce("env:thread-once", "2026-10-02T17:00:00.000Z", refollow);
    expect(calls).toBe(1);
    refollowThreadOnce("env:thread-once", "2026-10-02T17:00:05.000Z", refollow);
    expect(calls).toBe(2);
  });
});
