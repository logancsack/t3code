import { describe, expect, it } from "@effect/vitest";
import type { OrchestrationV2DomainEvent, OrchestrationV2TurnItem } from "@t3tools/contracts";
import { OrchestrationV2ThreadLiveWork, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { makeTracker } from "./ThreadLiveWork.ts";

const sameLiveWork = Schema.toEquivalence(OrchestrationV2ThreadLiveWork);
const threadId = ThreadId.make("thread-1");
const at = (second: number) => DateTime.makeUnsafe(Date.UTC(2026, 10, 24, 12, 0, second));

const itemEvent = (second: number, item: object) =>
  ({
    type: "turn-item.updated",
    threadId,
    occurredAt: at(second),
    payload: {
      threadId,
      runId: "run-1",
      title: null,
      startedAt: null,
      completedAt: null,
      updatedAt: at(second),
      status: "running",
      ...item,
    } as unknown as OrchestrationV2TurnItem,
  }) as OrchestrationV2DomainEvent;

const reasoning = (second: number, text: string) =>
  itemEvent(second, { id: "reasoning-1", type: "reasoning", text, streaming: true });
const writing = (second: number, text: string) =>
  itemEvent(second, { id: "message-1", type: "assistant_message", text, streaming: true });
const command = (second: number, status: string, output?: string) =>
  itemEvent(second, {
    id: "tool-1",
    type: "command_execution",
    input: "bun run test",
    status,
    ...(output === undefined ? {} : { output }),
  });
const todos = (second: number, statuses: ReadonlyArray<string>) =>
  itemEvent(second, {
    id: "todo-1",
    type: "todo_list",
    planId: "plan-1",
    steps: statuses.map((status, index) => ({ id: `${index}`, text: `Step ${index + 1}`, status })),
  });
const run = (status: string) =>
  ({ type: "run.updated", threadId, occurredAt: at(59), payload: { status } }) as never;

describe("makeTracker", () => {
  it("follows a run from thinking through a tool call to writing, and forgets it once settled", () => {
    const tracker = makeTracker();
    expect(tracker.get(threadId)).toBeUndefined();

    tracker.record(reasoning(1, "Let me"));
    expect(tracker.get(threadId)).toEqual({
      kind: "thinking",
      startedAt: at(1),
      tool: null,
      plan: null,
    });

    tracker.record(command(2, "running"));
    expect(tracker.get(threadId)).toMatchObject({
      kind: "tool",
      startedAt: at(2),
      tool: { type: "command_execution", input: "bun run test" },
    });

    // Reasoning under an open call does not take the line from it.
    tracker.record(writing(3, "Running"));
    expect(tracker.get(threadId)?.kind).toBe("tool");

    tracker.record(command(4, "completed", "ok"));
    expect(tracker.get(threadId)).toMatchObject({ kind: "thinking", startedAt: at(4), tool: null });

    tracker.record(writing(5, "Done"));
    expect(tracker.get(threadId)).toMatchObject({ kind: "writing", startedAt: at(5) });

    tracker.record(run("running"));
    expect(tracker.get(threadId)?.kind).toBe("writing");
    tracker.record(run("completed"));
    expect(tracker.get(threadId)).toBeUndefined();
  });

  it("keeps the same value through text deltas and tool output, so the shell is not sent again", () => {
    const tracker = makeTracker();
    tracker.record(reasoning(1, "Let"));
    const thinking = tracker.get(threadId);
    tracker.record(reasoning(2, "Let me think"));
    expect(tracker.get(threadId)).toBe(thinking);

    tracker.record(command(3, "running"));
    const running = tracker.get(threadId);
    tracker.record(command(4, "running", "line 1\n"));
    tracker.record(command(5, "running", "line 1\nline 2\n"));
    expect(tracker.get(threadId)).toBe(running);
    expect(running?.tool).not.toHaveProperty("output");
    // The shell stream drops a shell equal to the last one it sent; this is its comparison.
    expect(sameLiveWork(tracker.get(threadId)!, running!)).toBe(true);
    expect(sameLiveWork(thinking!, running!)).toBe(false);
  });

  it("carries the task list's step and moves with it", () => {
    const tracker = makeTracker();
    tracker.record(todos(1, ["running", "pending", "pending"]));
    const first = tracker.get(threadId);
    expect(first).toMatchObject({
      kind: "thinking",
      plan: { step: "Step 1", completedSteps: 0, totalSteps: 3 },
    });

    tracker.record(todos(2, ["running", "pending", "pending"]));
    expect(tracker.get(threadId)).toBe(first);

    tracker.record(todos(3, ["completed", "running", "pending"]));
    expect(tracker.get(threadId)?.plan).toEqual({
      step: "Step 2",
      completedSteps: 1,
      totalSteps: 3,
    });

    tracker.record(todos(4, ["completed", "completed", "completed"]));
    expect(tracker.get(threadId)?.plan).toBeNull();
  });

  it("drops what a tool call was given beyond the words a step is named from", () => {
    const tracker = makeTracker();
    tracker.record(
      itemEvent(1, {
        id: "tool-2",
        type: "dynamic_tool",
        toolName: "Write",
        input: { file_path: "/work/app.ts", content: "x".repeat(5_000), nested: { a: 1 } },
        output: "written",
      }),
    );
    expect(tracker.get(threadId)?.tool).toMatchObject({
      toolName: "Write",
      input: { file_path: "/work/app.ts", content: "x".repeat(300) },
    });
    expect(JSON.stringify(tracker.get(threadId)).length).toBeLessThan(1_000);
  });
});
