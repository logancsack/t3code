import type { OrchestrationV2ThreadLiveWork } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { shellWork } from "./liveWork";

type Shell = NonNullable<Parameters<typeof shellWork>[0]>;

const shell = (
  status: "running" | "completed",
  activityStartedAt: string | null = null,
  liveWork?: OrchestrationV2ThreadLiveWork,
) =>
  ({
    latestRun: { status, requestedAt: "2026-10-27T12:00:00.000Z", startedAt: null },
    runtime: { status: status === "running" ? "running" : "idle", activityStartedAt },
    source: { liveWork },
  }) as unknown as Shell;

const startedAt = DateTime.makeUnsafe("2026-10-27T12:00:09.000Z");
const live = (work: Partial<OrchestrationV2ThreadLiveWork>): OrchestrationV2ThreadLiveWork => ({
  kind: "thinking",
  startedAt,
  tool: null,
  plan: null,
  ...work,
});
const tool = (fields: object) =>
  ({
    id: "tool-1",
    threadId: "thread-1",
    runId: "run-1",
    nodeId: null,
    status: "running",
    title: null,
    startedAt,
    completedAt: null,
    updatedAt: startedAt,
    ...fields,
  }) as unknown as NonNullable<OrchestrationV2ThreadLiveWork["tool"]>;

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

  it("says what the machine reports the run is doing, in the timeline's words", () => {
    expect(shellWork(shell("running", null, live({ kind: "writing" })), "live")).toEqual({
      kind: "writing",
      doing: null,
      since: "2026-10-27T12:00:09.000Z",
      plan: null,
      surface: null,
      site: null,
    });
    expect(
      shellWork(
        shell(
          "running",
          null,
          live({
            kind: "tool",
            tool: tool({
              type: "dynamic_tool",
              toolName: "mcp__playwright__browser_navigate",
              input: { url: "https://example.com/pricing" },
            }),
          }),
        ),
        "live",
      ),
    ).toMatchObject({ kind: "tool", doing: "Opening example.com", surface: "browser" });
  });

  it("falls back to the plan's step, with how far along it is", () => {
    const plan = { step: "Run the tests", completedSteps: 1, totalSteps: 3 };
    expect(shellWork(shell("running", null, live({ plan })), "live")).toMatchObject({
      kind: "thinking",
      doing: "Running the tests",
      plan: { done: 1, total: 3 },
    });
  });

  it("has nothing to say once no run is under way", () => {
    expect(shellWork(shell("completed"), "live")).toBeNull();
    expect(shellWork(shell("completed", null, live({ kind: "writing" })), "live")).toBeNull();
  });

  it("has nothing to say from a shell it isn't connected to now: what it kept may be over", () => {
    for (const status of ["cached", "synchronizing", "empty"] as const) {
      expect(shellWork(shell("running"), status)).toBeNull();
    }
  });
});
