import { describe, expect, it } from "vite-plus/test";

import {
  aldoThreadSnapshotResult,
  markAldoThreadPending,
  settleAldoThreadPending,
} from "./pendingThreads";

const found = { kind: "found", snapshot: {} } as unknown as Parameters<
  typeof aldoThreadSnapshotResult
>[1];

describe("aldoThreadSnapshotResult", () => {
  it("reads 'not found' as 'not yet' for a thread this tab is creating, until the machine has it", () => {
    markAldoThreadPending("t-new");
    expect(aldoThreadSnapshotResult("t-new", { kind: "not-found" })).toEqual({
      kind: "unavailable",
    });
    expect(aldoThreadSnapshotResult("t-new", { kind: "not-found" })).toEqual({
      kind: "unavailable",
    });
    expect(aldoThreadSnapshotResult("t-new", found)).toBe(found);
    // Found once: from then on, as T3 has it.
    expect(aldoThreadSnapshotResult("t-new", { kind: "not-found" })).toEqual({
      kind: "not-found",
    });
  });

  it("leaves every other thread's answer as it is", () => {
    expect(aldoThreadSnapshotResult("t-other", { kind: "not-found" })).toEqual({
      kind: "not-found",
    });
    markAldoThreadPending("t-sent");
    settleAldoThreadPending("t-sent");
    expect(aldoThreadSnapshotResult("t-sent", { kind: "not-found" })).toEqual({
      kind: "not-found",
    });
  });
});
