import { describe, expect, it } from "vite-plus/test";

import { resolveThreadSyncPhase, shouldRefollowThread } from "./threadSync";

describe("resolveThreadSyncPhase", () => {
  it("loads when only shell data is available", () => {
    expect(
      resolveThreadSyncPhase({
        detailExists: false,
        shellExists: true,
        status: "synchronizing",
      }),
    ).toBe("loading");
  });

  it("syncs when cached detail is already visible", () => {
    expect(
      resolveThreadSyncPhase({
        detailExists: true,
        shellExists: true,
        status: "cached",
      }),
    ).toBe("syncing");
  });

  it("does not report a sync phase without a shell or after going live", () => {
    expect(
      resolveThreadSyncPhase({
        detailExists: false,
        shellExists: false,
        status: "empty",
      }),
    ).toBeNull();
    expect(
      resolveThreadSyncPhase({
        detailExists: true,
        shellExists: true,
        status: "live",
      }),
    ).toBeNull();
  });
});

describe("shouldRefollowThread", () => {
  it("follows a thread taken for deleted again once the live shell lists it", () => {
    expect(
      shouldRefollowThread({
        status: "deleted",
        shellExists: true,
        environmentShellStatus: "live",
      }),
    ).toBe(true);
  });

  it("leaves it while only a cached shell lists it", () => {
    // A cached shell can list a thread the server doesn't have yet (a first
    // message still on its way), so only the live one says it exists.
    expect(
      shouldRefollowThread({
        status: "deleted",
        shellExists: true,
        environmentShellStatus: "cached",
      }),
    ).toBe(false);
  });

  it("leaves threads the server doesn't list, and ones it follows", () => {
    expect(
      shouldRefollowThread({
        status: "deleted",
        shellExists: false,
        environmentShellStatus: "live",
      }),
    ).toBe(false);
    expect(
      shouldRefollowThread({
        status: "live",
        shellExists: true,
        environmentShellStatus: "live",
      }),
    ).toBe(false);
  });
});
