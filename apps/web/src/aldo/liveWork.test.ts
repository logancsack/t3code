import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { shellWork } from "./liveWork";

type Shell = NonNullable<Parameters<typeof shellWork>[0]>;

const running = (fields: Partial<Shell>) =>
  ({
    session: { status: "running" },
    latestTurn: { state: "running", requestedAt: "2026-10-27T12:00:00.000Z", startedAt: null },
    ...fields,
  }) as unknown as Shell;

const command = (text: string) =>
  ({
    id: "evt-1",
    tone: "tool",
    kind: "tool.started",
    summary: "Command run started",
    payload: {
      itemType: "command_execution",
      toolCallId: "item-1",
      status: "inProgress",
      data: { command: text },
    },
    turnId: null,
    createdAt: "2026-10-27T12:00:05.000Z",
  }) as unknown as OrchestrationThreadActivity;

describe("shellWork", () => {
  it("words a tool call under way as the thread's timeline does", () => {
    const work = shellWork(
      running({
        currentWork: {
          kind: "tool",
          startedAt: "2026-10-27T12:00:05.000Z",
          activity: command("python3 build.py --final"),
        },
      }),
      "live",
    );
    expect(work).toMatchObject({
      kind: "tool",
      doing: "Running build.py",
      since: "2026-10-27T12:00:05.000Z",
    });
  });

  it("says thinking without a step, and the plan's step for a machine that doesn't report its work", () => {
    expect(
      shellWork(
        running({
          currentWork: { kind: "thinking", startedAt: "2026-10-27T12:00:05.000Z", activity: null },
        }),
        "live",
      ),
    ).toMatchObject({ kind: "thinking", doing: null });
    expect(
      shellWork(
        running({ planProgress: { step: "Run the tests", completedSteps: 1, totalSteps: 3 } }),
        "live",
      ),
    ).toMatchObject({ doing: "Running the tests", plan: { done: 1, total: 3 } });
  });

  it("has nothing to say once no turn runs", () => {
    expect(
      shellWork(
        running({
          session: { status: "ready" } as Shell["session"],
          currentWork: { kind: "thinking", startedAt: "2026-10-27T12:00:05.000Z", activity: null },
        }),
        "live",
      ),
    ).toBeNull();
  });

  it("has nothing to say from a shell it isn't connected to now: what it kept may be over", () => {
    const writing = running({
      currentWork: { kind: "writing", startedAt: "2026-10-27T12:00:05.000Z", activity: null },
    });
    expect(shellWork(writing, "live")).toMatchObject({ kind: "writing" });
    for (const status of ["cached", "synchronizing", "empty"] as const) {
      expect(shellWork(writing, status)).toBeNull();
    }
  });
});
