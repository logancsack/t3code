import { describe, expect, it } from "vite-plus/test";

import { shellWork } from "./liveWork";

type Shell = NonNullable<Parameters<typeof shellWork>[0]>;

const shell = (status: "running" | "completed", activityStartedAt: string | null = null) =>
  ({
    latestRun: { status, requestedAt: "2026-10-27T12:00:00.000Z", startedAt: null },
    runtime: { status: status === "running" ? "running" : "idle", activityStartedAt },
  }) as unknown as Shell;

describe("shellWork", () => {
  it("says since when a run has been under way", () => {
    expect(shellWork(shell("running"), "live")).toMatchObject({
      doing: null,
      since: "2026-10-27T12:00:00.000Z",
    });
    expect(shellWork(shell("running", "2026-10-27T12:00:05.000Z"), "live")).toMatchObject({
      since: "2026-10-27T12:00:05.000Z",
    });
  });

  it("has nothing to say once no run is under way", () => {
    expect(shellWork(shell("completed"), "live")).toBeNull();
  });

  it("has nothing to say from a shell it isn't connected to now: what it kept may be over", () => {
    for (const status of ["cached", "synchronizing", "empty"] as const) {
      expect(shellWork(shell("running"), status)).toBeNull();
    }
  });
});
