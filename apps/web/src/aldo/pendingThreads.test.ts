import { describe, expect, it } from "vite-plus/test";

import {
  aldoThreadSnapshotResult,
  markAldoThreadPending,
  settleAldoThreadPending,
} from "./pendingThreads";

const found = { _tag: "present", snapshot: {} } as unknown as Parameters<
  typeof aldoThreadSnapshotResult
>[2];

describe("aldoThreadSnapshotResult", () => {
  it("reads 'not found' as 'not yet' for a thread this tab is creating, until the machine has it", () => {
    markAldoThreadPending("aldo-a", "t-new");
    expect(aldoThreadSnapshotResult("aldo-a", "t-new", { _tag: "missing" })).toEqual({
      _tag: "unavailable",
    });
    expect(aldoThreadSnapshotResult("aldo-a", "t-new", { _tag: "missing" })).toEqual({
      _tag: "unavailable",
    });
    expect(aldoThreadSnapshotResult("aldo-a", "t-new", found)).toBe(found);
    // Found once: from then on, as T3 has it.
    expect(aldoThreadSnapshotResult("aldo-a", "t-new", { _tag: "missing" })).toEqual({
      _tag: "missing",
    });
  });

  it("keeps a thread pending on its own machine only", () => {
    markAldoThreadPending("aldo-a", "t-same");
    expect(aldoThreadSnapshotResult("aldo-b", "t-same", found)).toBe(found);
    expect(aldoThreadSnapshotResult("aldo-b", "t-same", { _tag: "missing" })).toEqual({
      _tag: "missing",
    });
    expect(aldoThreadSnapshotResult("aldo-a", "t-same", { _tag: "missing" })).toEqual({
      _tag: "unavailable",
    });
  });

  it("leaves every other thread's answer as it is", () => {
    expect(aldoThreadSnapshotResult("aldo-a", "t-other", { _tag: "missing" })).toEqual({
      _tag: "missing",
    });
    markAldoThreadPending("aldo-a", "t-sent");
    settleAldoThreadPending("aldo-a", "t-sent");
    expect(aldoThreadSnapshotResult("aldo-a", "t-sent", { _tag: "missing" })).toEqual({
      _tag: "missing",
    });
  });
});
