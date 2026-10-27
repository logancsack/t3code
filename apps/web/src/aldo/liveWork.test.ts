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
      ),
    ).toMatchObject({ kind: "thinking", doing: null });
    expect(
      shellWork(
        running({ planProgress: { step: "Run the tests", completedSteps: 1, totalSteps: 3 } }),
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
      ),
    ).toBeNull();
  });
});
