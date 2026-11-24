import {
  CommandId,
  MessageId,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ShellStreamItem,
  OrchestrationV2ThreadDetailSnapshot,
  OrchestrationV2ThreadProjection,
  RunId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2Command,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { derivePendingThreadRequests } from "../state/threadRequests.ts";
import { deriveThreadRuntime } from "../state/threadExecution.ts";
import { toV1Commands, type V1CommandContext } from "./commands.ts";
import shellCapture from "./fixtures/shell.real.json" with { type: "json" };
import {
  failedTurnThread,
  pendingApprovalThread,
  pendingUserInputThread,
  stoppedTurnThread,
} from "./fixtures/synthetic.ts";
import threadCapture from "./fixtures/thread.real.json" with { type: "json" };
import streamCapture from "./fixtures/threadStream.real.json" with { type: "json" };
import { stepThreadStream, type ThreadStreamState } from "./stream.ts";
import {
  mapShellSnapshot,
  mapShellStreamItem,
  mapThreadDetailSnapshot,
  mapThreadProjection,
} from "./toV2.ts";
import {
  V1ClientCommand,
  V1ShellSnapshot,
  V1ShellStreamItem,
  V1Thread,
  V1ThreadDetailSnapshot,
  V1ThreadStreamItem,
} from "./wire.ts";

const decodeThread = Schema.decodeUnknownSync(V1Thread);
const decodeDetail = Schema.decodeUnknownSync(V1ThreadDetailSnapshot);
const decodeShell = Schema.decodeUnknownSync(V1ShellSnapshot);
const decodeShellItem = Schema.decodeUnknownSync(V1ShellStreamItem);
const decodeStreamItem = Schema.decodeUnknownSync(V1ThreadStreamItem);
const decodeV1Command = Schema.decodeSync(V1ClientCommand);
const validDetail = Schema.encodeUnknownSync(OrchestrationV2ThreadDetailSnapshot);
const validShell = Schema.encodeUnknownSync(OrchestrationV2ShellSnapshot);
const validShellItem = Schema.encodeUnknownSync(OrchestrationV2ShellStreamItem);
// Encoding validates the mapped value against the schema the client decodes servers with.
const validProjection = Schema.encodeUnknownSync(OrchestrationV2ThreadProjection);
const project = (thread: unknown) => {
  const projection = mapThreadProjection(decodeThread(thread));
  validProjection(projection);
  return projection;
};
const rows = (projection: OrchestrationV2ThreadProjection) =>
  projection.visibleTurnItems.map(({ item }) => item);

describe("a generation-1 machine's captured thread", () => {
  const snapshot = mapThreadDetailSnapshot(decodeDetail(threadCapture));
  const { projection } = snapshot;

  it("is a thread detail snapshot the client can decode", () => {
    validDetail(snapshot);
    expect(snapshot.snapshotSequence).toBe(threadCapture.snapshotSequence);
    expect(snapshot.hasMoreHistory).toBe(true);
    expect(snapshot.historyCursor).toBe(threadCapture.page.beforeCursor);
  });

  it("shows every message once, in the order it was written", () => {
    const shown = rows(projection).flatMap((item) =>
      item.type === "user_message" || item.type === "assistant_message" || item.type === "reasoning"
        ? [item.text]
        : [],
    );
    expect(shown).toEqual(threadCapture.thread.messages.map((message) => message.text));
    expect(rows(projection).map((item) => item.ordinal)).toEqual(
      rows(projection).map((_, index) => index),
    );
  });

  it("files each user message under the turn it started", () => {
    const firstRun = projection.runs[0];
    expect(firstRun?.userMessageId).toBe(threadCapture.thread.messages[0]?.id);
    const userRow = rows(projection).find((item) => item.type === "user_message");
    expect(userRow?.runId).toBe(firstRun?.id);
    expect(projection.runs.map((run) => run.status)).toEqual(["completed", "completed", "running"]);
  });

  it("shows one row per tool call with its final state", () => {
    const calls = new Set(
      threadCapture.thread.activities.flatMap((activity) =>
        activity.tone === "tool" && "toolCallId" in activity.payload
          ? [activity.payload.toolCallId]
          : [],
      ),
    );
    const tools = rows(projection).filter(
      (item) => item.type === "command_execution" || item.type === "dynamic_tool",
    );
    expect(tools.map((item) => item.id).toSorted()).toEqual(
      [...calls].map((id) => `tool:${id}`).toSorted(),
    );
    const command = tools.find((item) => item.type === "command_execution");
    expect(command).toMatchObject({
      input: "echo redacted",
      output: "redacted output\n",
      status: "completed",
    });
    expect(tools.find((item) => item.type === "dynamic_tool")).toMatchObject({ toolName: "Write" });
  });

  it("keeps an answered question as history, with nothing left to answer", () => {
    const question = rows(projection).find((item) => item.type === "user_input_request");
    expect(question).toMatchObject({
      status: "completed",
      questions: [{ question: "Question 1?" }],
    });
    expect(projection.runtimeRequests).toMatchObject([{ kind: "user_input", status: "resolved" }]);
    expect(derivePendingThreadRequests(projection)).toEqual({ approvals: [], userInputs: [] });
  });

  it("shows both plans, the built one as done", () => {
    expect(projection.plans.map((plan) => [plan.kind, plan.status])).toEqual([
      ["proposed_plan", "active"],
      ["proposed_plan", "completed"],
    ]);
    const plan = rows(projection).findLast((item) => item.type === "proposed_plan");
    expect(plan).toMatchObject({ markdown: threadCapture.thread.proposedPlans[1]?.planMarkdown });
    expect(projection.runs.at(-1)?.sourcePlanRef?.planId).toBe(
      threadCapture.thread.proposedPlans[1]?.id,
    );
  });

  it("shows a turn that failed to start as an error row", () => {
    const failure = rows(projection).find((item) => item.type === "error");
    expect(failure).toMatchObject({ status: "failed", runId: null });
  });

  it("reads as a working thread whose turn can be stopped", () => {
    const runtime = deriveThreadRuntime(projection);
    expect(runtime).toMatchObject({
      status: "running",
      activeRunId: threadCapture.thread.latestTurn.turnId,
    });
  });
});

describe("states built by hand from the V1 schema", () => {
  it("offers a pending approval under the id an answer must name", () => {
    const projection = project(pendingApprovalThread);
    expect(derivePendingThreadRequests(projection).approvals).toMatchObject([
      {
        requestId: "synthetic-approval-1",
        requestKind: "command",
        detail: "rm -rf build",
        responseCapability: "live",
      },
    ]);
    expect(rows(projection).at(-1)).toMatchObject({ type: "approval_request", status: "waiting" });
  });

  it("offers a pending question with its options", () => {
    const projection = project(pendingUserInputThread);
    const [question] = derivePendingThreadRequests(projection).userInputs;
    expect(question).toMatchObject({ requestId: "synthetic-question-1", dismissible: false });
    expect(question?.questions[0]?.options.map((option) => option.label)).toEqual([
      "Option 1",
      "Option 2",
      "Option 3",
    ]);
  });

  it("closes a request its turn ended without answering", () => {
    const projection = project({
      ...pendingApprovalThread,
      latestTurn: stoppedTurnThread.latestTurn,
      session: stoppedTurnThread.session,
    });
    expect(derivePendingThreadRequests(projection).approvals).toEqual([]);
  });

  it("shows a stopped turn as stopped, with no work still spinning", () => {
    const projection = project(stoppedTurnThread);
    expect(projection.runs.at(-1)?.status).toBe("interrupted");
    expect(deriveThreadRuntime(projection)).toMatchObject({
      status: "interrupted",
      activeRunId: null,
    });
    expect(rows(projection).filter((item) => item.status === "running")).toEqual([]);
  });

  it("shows a failed turn with the machine's error", () => {
    const projection = project(failedTurnThread);
    expect(projection.runs.at(-1)?.status).toBe("failed");
    expect(deriveThreadRuntime(projection)).toMatchObject({
      status: "failed",
      lastError: "The provider rejected the request.",
    });
    expect(rows(projection).at(-1)).toMatchObject({ type: "error", status: "failed" });
  });
});

describe("a generation-1 machine's captured thread list", () => {
  const snapshot = mapShellSnapshot(decodeShell(shellCapture));

  it("is a shell snapshot the client can decode", () => {
    validShell(snapshot);
    expect(snapshot.threads).toMatchObject([
      {
        id: shellCapture.threads[0]?.id,
        title: "Redacted thread",
        status: "running",
        activeRunId: shellCapture.threads[0]?.latestTurn.turnId,
        pendingRuntimeRequest: null,
      },
    ]);
    expect(snapshot.projects.map((entry) => entry.title)).toEqual(["Redacted project"]);
  });

  it("carries what a running turn is doing now, and its plan's step", () => {
    const thread = shellCapture.threads[0]!;
    const startedAt = "2026-10-27T12:00:05.000Z";
    const [mapped] = mapShellSnapshot(
      decodeShell({
        ...shellCapture,
        threads: [
          {
            ...thread,
            planProgress: { step: "Run the tests", completedSteps: 1, totalSteps: 3 },
            currentWork: {
              kind: "tool",
              startedAt,
              activity: {
                id: "activity-1",
                tone: "tool",
                kind: "tool.updated",
                summary: "Ran command",
                payload: { itemType: "command_execution", data: { command: "bun run test" } },
                turnId: thread.latestTurn.turnId,
                createdAt: startedAt,
              },
            },
          },
        ],
      }),
    ).threads;
    validShell({ ...snapshot, threads: [mapped] });
    expect(mapped?.liveWork).toMatchObject({
      kind: "tool",
      startedAt: DateTime.makeUnsafe(startedAt),
      tool: { type: "command_execution", input: "bun run test", status: "running" },
      plan: { step: "Run the tests", completedSteps: 1, totalSteps: 3 },
    });
    // The capture itself was taken while its turn was thinking.
    expect(snapshot.threads[0]?.liveWork).toMatchObject({ kind: "thinking", tool: null });
  });

  it("maps list updates", () => {
    const decode = decodeShellItem;
    const updated = mapShellStreamItem(
      decode({ kind: "thread-upserted", sequence: 9, thread: shellCapture.threads[0] }),
    );
    validShellItem(updated);
    expect(updated).toMatchObject({ kind: "thread.updated", sequence: 9, location: "active" });
    expect(
      mapShellStreamItem(
        decode({ kind: "thread-removed", sequence: 10, threadId: shellCapture.threads[0]?.id }),
      ),
    ).toMatchObject({ kind: "thread.removed", sequence: 10 });
  });
});

describe("a generation-1 machine's captured thread stream", () => {
  const decodeItem = decodeStreamItem;
  const start: ThreadStreamState = {
    thread: decodeThread(threadCapture.thread),
    sequence: threadCapture.snapshotSequence,
  };

  it("turns live events into snapshots the client applies", () => {
    let state = start;
    let last: OrchestrationV2ThreadProjection | undefined;
    for (const raw of streamCapture) {
      const step = stepThreadStream(state, decodeItem(raw));
      expect(step.reload).toBe(false);
      state = step.state;
      for (const item of step.items) {
        if (item.kind !== "snapshot") continue;
        validProjection(item.projection);
        last = item.projection;
      }
    }
    expect(state.sequence).toBe(streamCapture.at(-1)?.event.sequence);

    const toolEvent = streamCapture.find((raw) => raw.event.type === "thread.activity-appended");
    const toolCallId =
      toolEvent && "activity" in toolEvent.event.payload
        ? toolEvent.event.payload.activity.payload.toolCallId
        : undefined;
    expect(rows(last!).find((item) => item.id === `tool:${toolCallId}`)).toMatchObject({
      status: "completed",
    });
    // Streamed pieces join; the closing event, which carries no text, keeps them.
    expect(rows(last!).at(-1)).toMatchObject({
      type: "reasoning",
      text: "delta 1 delta 2 ",
      streaming: false,
    });
  });

  it("skips events the snapshot already holds and reloads on ones it cannot apply", () => {
    const [first] = streamCapture;
    const replayed = stepThreadStream(
      { ...start, sequence: first!.event.sequence },
      decodeItem(first),
    );
    expect(replayed).toMatchObject({ items: [], reload: false });
    const reverted = stepThreadStream(
      start,
      decodeItem({
        kind: "event",
        event: {
          ...first!.event,
          type: "thread.reverted",
          payload: { threadId: threadCapture.thread.id, turnCount: 1 },
        },
      }),
    );
    expect(reverted).toMatchObject({ items: [], reload: true });
  });
});

describe("commands sent to a generation-1 machine", () => {
  const threadId = ThreadId.make(threadCapture.thread.id);
  const context: V1CommandContext = {
    now: "2026-11-24T06:20:00.000Z",
    thread: () => ({ runtimeMode: "full-access", interactionMode: "plan" }),
  };
  const commandId = CommandId.make("command-1");
  const sent = (command: OrchestrationV2Command) => {
    const result = toV1Commands(command, context);
    if (result.kind !== "send") throw new Error(`not sent: ${command.type}`);
    // Round-trips through the V1 command schema, so the machine would accept it.
    return result.commands.map((entry) => decodeV1Command(entry));
  };
  const dispatch = {
    type: "message.dispatch",
    createdBy: "user",
    creationSource: "web",
    commandId,
    threadId,
    messageId: MessageId.make("message-1"),
    text: "Carry on",
    attachments: [],
    dispatchMode: { type: "start_immediately" },
  } satisfies OrchestrationV2Command;

  it("starts a turn with the thread's modes", () => {
    expect(
      sent({
        ...dispatch,
        modelSelection: decodeThread(threadCapture.thread).modelSelection,
      }),
    ).toMatchObject([
      {
        type: "thread.turn.start",
        message: { messageId: "message-1", role: "user", text: "Carry on" },
        modelSelection: { model: threadCapture.thread.modelSelection.model },
        runtimeMode: "full-access",
        interactionMode: "plan",
        createdAt: context.now,
      },
    ]);
  });

  it("accepts a plan by building it", () => {
    const plan = decodeThread(threadCapture.thread).proposedPlans![0]!;
    expect(sent({ ...dispatch, sourcePlanRef: { threadId, planId: plan.id } })).toMatchObject([
      { interactionMode: "default", sourceProposedPlan: { threadId, planId: plan.id } },
    ]);
  });

  it("stops, approves, answers and dismisses under the ids the mapped thread showed", () => {
    const projection = project(pendingApprovalThread);
    const approval = derivePendingThreadRequests(projection).approvals[0]!;
    const question = derivePendingThreadRequests(project(pendingUserInputThread)).userInputs[0]!;
    const runId = deriveThreadRuntime(projection)!.activeRunId!;
    expect(sent({ type: "run.interrupt", commandId, threadId, runId: RunId.make(runId) })).toEqual([
      {
        type: "thread.turn.interrupt",
        commandId,
        threadId,
        turnId: threadCapture.thread.latestTurn.turnId,
        createdAt: context.now,
      },
    ]);
    expect(
      sent({
        type: "runtime-request.respond",
        commandId,
        threadId,
        requestId: approval.requestId,
        decision: "decline",
      }),
    ).toMatchObject([
      { type: "thread.approval.respond", requestId: "synthetic-approval-1", decision: "decline" },
    ]);
    expect(
      sent({
        type: "runtime-request.respond",
        commandId,
        threadId,
        requestId: question.requestId,
        answers: { [question.questions[0]!.id]: "Option 2" },
      }),
    ).toMatchObject([{ type: "thread.user-input.respond", requestId: "synthetic-question-1" }]);
    expect(
      sent({
        type: "thread.user-input.dismiss",
        commandId,
        threadId,
        requestId: RuntimeRequestId.make("synthetic-question-1"),
      }),
    ).toMatchObject([{ type: "thread.user-input.dismiss" }]);
  });

  it("renames, changes mode and files threads away", () => {
    const types = (
      [
        { type: "thread.metadata.update", commandId, threadId, title: "New title" },
        { type: "thread.interaction-mode.set", commandId, threadId, interactionMode: "plan" },
        { type: "thread.settle", commandId, threadId },
        { type: "thread.unsettle", commandId, threadId, reason: "user" },
        { type: "thread.archive", commandId, threadId },
        { type: "thread.unarchive", commandId, threadId },
        { type: "thread.delete", commandId, threadId },
        { type: "thread.snooze", commandId, threadId, snoozedUntil: "2026-11-25T00:00:00.000Z" },
        { type: "thread.unsnooze", commandId, threadId, reason: "user" },
        { type: "thread.pin", commandId, threadId },
        { type: "thread.unpin", commandId, threadId },
      ] satisfies Array<OrchestrationV2Command>
    ).flatMap((command) => sent(command).map((entry) => entry.type));
    expect(types).toEqual([
      "thread.meta.update",
      "thread.interaction-mode.set",
      "thread.settle",
      "thread.unsettle",
      "thread.archive",
      "thread.unarchive",
      "thread.delete",
      "thread.snooze",
      "thread.unsnooze",
      "thread.pin",
      "thread.unpin",
    ]);
  });

  it("refuses what a V1 machine cannot do and skips what it does not keep", () => {
    expect(
      toV1Commands(
        { ...dispatch, dispatchMode: { type: "steer_active", targetRunId: RunId.make("run") } },
        context,
      ),
    ).toEqual({ kind: "unsupported", type: "message.dispatch:steer_active" });
    expect(
      toV1Commands({ type: "thread.visit", commandId, threadId, visitedAt: context.now }, context),
    ).toEqual({ kind: "skip" });
    expect(
      toV1Commands({ type: "thread.fork", commandId, threadId } as never, context),
    ).toMatchObject({ kind: "unsupported" });
  });
});
