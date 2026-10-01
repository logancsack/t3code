import { describe, expect, it } from "vite-plus/test";

import {
  aldoThreadSnapshotResult,
  markAldoThreadPending,
  settleAldoThreadPending,
} from "./pendingThreads";

const found = { kind: "found", snapshot: {} } as unknown as Parameters<
  typeof aldoThreadSnapshotResult
>[2];

describe("aldoThreadSnapshotResult", () => {
  it("reads 'not found' as 'not yet' for a thread this tab is creating, until the machine has it", () => {
    markAldoThreadPending("aldo-a", "t-new");
    expect(aldoThreadSnapshotResult("aldo-a", "t-new", { kind: "not-found" })).toEqual({
      kind: "unavailable",
    });
    expect(aldoThreadSnapshotResult("aldo-a", "t-new", { kind: "not-found" })).toEqual({
      kind: "unavailable",
    });
    expect(aldoThreadSnapshotResult("aldo-a", "t-new", found)).toBe(found);
    // Found once: from then on, as T3 has it.
    expect(aldoThreadSnapshotResult("aldo-a", "t-new", { kind: "not-found" })).toEqual({
      kind: "not-found",
    });
  });

  it("keeps a thread pending on its own machine only", () => {
    markAldoThreadPending("aldo-a", "t-same");
    expect(aldoThreadSnapshotResult("aldo-b", "t-same", found)).toBe(found);
    expect(aldoThreadSnapshotResult("aldo-b", "t-same", { kind: "not-found" })).toEqual({
      kind: "not-found",
    });
    expect(aldoThreadSnapshotResult("aldo-a", "t-same", { kind: "not-found" })).toEqual({
      kind: "unavailable",
    });
  });

  it("leaves every other thread's answer as it is", () => {
    expect(aldoThreadSnapshotResult("aldo-a", "t-other", { kind: "not-found" })).toEqual({
      kind: "not-found",
    });
    markAldoThreadPending("aldo-a", "t-sent");
    settleAldoThreadPending("aldo-a", "t-sent");
    expect(aldoThreadSnapshotResult("aldo-a", "t-sent", { kind: "not-found" })).toEqual({
      kind: "not-found",
    });
  });
});
