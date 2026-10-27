import { describe, expect, it } from "vite-plus/test";
import * as ThreadPlanProgress from "./ThreadPlanProgress.ts";

describe("ThreadPlanProgress", () => {
  it("tracks the in-progress step and clears when the plan completes", () => {
    const progress = ThreadPlanProgress.make();
    const threadId = "t-plan-1";
    progress.recordPlanProgress(threadId, [
      { step: "Audit failure paths", status: "completed" },
      { step: "Implement the fix", status: "inProgress" },
      { step: "Run targeted tests", status: "pending" },
    ]);
    expect(progress.getThreadPlanProgress(threadId)).toEqual({
      step: "Implement the fix",
      completedSteps: 1,
      totalSteps: 3,
    });

    progress.recordPlanProgress(threadId, [
      { step: "Audit failure paths", status: "completed" },
      { step: "Implement the fix", status: "completed" },
      { step: "Run targeted tests", status: "completed" },
    ]);
    expect(progress.getThreadPlanProgress(threadId)).toBeNull();
  });

  it("falls back to the first non-completed step when nothing is in progress", () => {
    const progress = ThreadPlanProgress.make();
    const threadId = "t-plan-2";
    progress.recordPlanProgress(threadId, [
      { step: "First", status: "pending" },
      { step: "Second", status: "pending" },
    ]);
    expect(progress.getThreadPlanProgress(threadId)?.step).toBe("First");
  });

  it("clearThreadPlanProgress removes the entry (turn settled / session died)", () => {
    const progress = ThreadPlanProgress.make();
    const threadId = "t-plan-3";
    progress.recordPlanProgress(threadId, [{ step: "Only step", status: "inProgress" }]);
    progress.clearThreadPlanProgress(threadId);
    expect(progress.getThreadPlanProgress(threadId)).toBeNull();
  });

  it("current work: the newest tool call under way, then thinking once they've all ended", () => {
    const progress = ThreadPlanProgress.make();
    const threadId = "t-work-1";
    const tool = (id: string, kind: string, at: string, status = "inProgress") =>
      ({
        id: `evt-${id}-${kind}`,
        tone: "tool",
        kind,
        summary: "Tool",
        payload: { itemType: "command_execution", toolCallId: id, status },
        turnId: null,
        createdAt: at,
      }) as never;
    progress.recordToolActivity(threadId, tool("a", "tool.started", "2026-01-01T00:00:01.000Z"));
    progress.recordToolActivity(threadId, tool("b", "tool.started", "2026-01-01T00:00:02.000Z"));
    progress.recordToolActivity(threadId, tool("a", "tool.updated", "2026-01-01T00:00:03.000Z"));
    expect(progress.getThreadCurrentWork(threadId)).toMatchObject({
      kind: "tool",
      startedAt: "2026-01-01T00:00:02.000Z",
    });
    progress.recordToolActivity(threadId, tool("b", "tool.completed", "2026-01-01T00:00:04.000Z"));
    // The one still going, from when it started.
    expect(progress.getThreadCurrentWork(threadId)).toMatchObject({
      kind: "tool",
      startedAt: "2026-01-01T00:00:01.000Z",
      activity: { kind: "tool.updated" },
    });
    progress.recordToolActivity(
      threadId,
      tool("a", "tool.updated", "2026-01-01T00:00:05.000Z", "failed"),
    );
    expect(progress.getThreadCurrentWork(threadId)).toEqual({
      kind: "thinking",
      startedAt: "2026-01-01T00:00:05.000Z",
      activity: null,
    });
    progress.clearThreadPlanProgress(threadId);
    expect(progress.getThreadCurrentWork(threadId)).toBeNull();
  });
});
