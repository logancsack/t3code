import {
  CommandId,
  MessageId,
  ModelSelection,
  OrchestrationV2ThreadStreamItem,
  ProjectId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2Command,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import shellCapture from "./fixtures/shell.real.json" with { type: "json" };
import threadCapture from "./fixtures/thread.real.json" with { type: "json" };
import streamCapture from "./fixtures/threadStream.real.json" with { type: "json" };
import { wrapLegacyClient, type V1Client } from "./session.ts";
import {
  V1_WS_METHODS as V1,
  V1ClientCommand,
  V1ShellStreamItem,
  V1ThreadStreamItem,
} from "./wire.ts";

const ORCHESTRATION = {
  dispatchCommand: "orchestration.dispatchCommand",
  launchThread: "orchestration.launchThread",
  subscribeShell: "orchestration.subscribeShell",
  subscribeThread: "orchestration.subscribeThread",
} as const;

const decodeShellItem = Schema.decodeUnknownSync(V1ShellStreamItem);
const decodeThreadItem = Schema.decodeUnknownSync(V1ThreadStreamItem);
// Round-trips through the V1 command schema, so the machine would accept what was sent.
const acceptCommand = Schema.decodeSync(V1ClientCommand);
const validThreadItem = Schema.encodeUnknownSync(OrchestrationV2ThreadStreamItem);

const threadId = ThreadId.make(threadCapture.thread.id);
const turnId = threadCapture.thread.latestTurn.turnId;
const commandId = CommandId.make("command-1");
const modelSelection = Schema.decodeSync(ModelSelection)(shellCapture.threads[0]!.modelSelection);

/** A V1 machine that answers from the captures and records what it was sent. */
function makeMachine(threadReads: ReadonlyArray<ReadonlyArray<unknown>> = []) {
  const sent: Array<V1ClientCommand> = [];
  let reads = 0;
  const v1 = {
    [V1.dispatchCommand]: (command: V1ClientCommand) =>
      command.type === "thread.delete"
        ? Effect.fail({ _tag: "OrchestrationDispatchCommandError", message: "Thread is busy." })
        : Effect.sync(() => ({ sequence: sent.push(acceptCommand(command)) })),
    [V1.subscribeShell]: () =>
      Stream.make(
        decodeShellItem({ kind: "snapshot", snapshot: shellCapture }),
        decodeShellItem({ kind: "synchronized" }),
      ),
    [V1.subscribeThread]: () =>
      Stream.fromIterable((threadReads[reads++] ?? []).map((item) => decodeThreadItem(item))),
  } as unknown as V1Client;
  return {
    sent,
    reads: () => reads,
    client: wrapLegacyClient({} as WsRpcProtocolClient, v1),
  };
}

describe("a generation-1 machine behind the V2 client", () => {
  it.effect("sends, stops, approves and answers in the machine's own commands", () =>
    Effect.gen(function* () {
      const machine = makeMachine();
      const dispatch = machine.client[ORCHESTRATION.dispatchCommand];
      const message = {
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

      // Until the thread list arrives, the thread's modes are unknown and no turn can start.
      expect(yield* Effect.flip(dispatch(message))).toMatchObject({
        _tag: "OrchestrationV2DispatchCommandError",
        commandType: "message.dispatch",
      });
      const shell = yield* Stream.runCollect(machine.client[ORCHESTRATION.subscribeShell]({}));
      expect(shell.map((item) => item.kind)).toEqual(["snapshot", "synchronized"]);

      yield* dispatch({
        type: "thread.interaction-mode.set",
        commandId,
        threadId,
        interactionMode: "plan",
      });
      expect(yield* dispatch(message)).toEqual({ sequence: 2 });
      yield* dispatch({ type: "run.interrupt", commandId, threadId, runId: RunId.make(turnId) });
      yield* dispatch({
        type: "runtime-request.respond",
        commandId,
        threadId,
        requestId: RuntimeRequestId.make("approval-1"),
        decision: "accept",
      });
      yield* dispatch({
        type: "runtime-request.respond",
        commandId,
        threadId,
        requestId: RuntimeRequestId.make("question-1"),
        answers: { choice: "Option 2" },
      });
      // Read state lives only on V2 machines: it succeeds without a request.
      expect(
        yield* dispatch({
          type: "thread.visit",
          commandId,
          threadId,
          visitedAt: "2026-11-24T06:20:00.000Z",
        }),
      ).toEqual({
        sequence: 0,
      });

      expect(machine.sent.slice(1)).toMatchObject([
        {
          type: "thread.turn.start",
          message: { messageId: "message-1", text: "Carry on" },
          runtimeMode: shellCapture.threads[0]?.runtimeMode,
          interactionMode: "plan",
        },
        { type: "thread.turn.interrupt", turnId },
        { type: "thread.approval.respond", requestId: "approval-1", decision: "accept" },
        {
          type: "thread.user-input.respond",
          requestId: "question-1",
          answers: { choice: "Option 2" },
        },
      ]);

      expect(
        yield* Effect.flip(dispatch({ type: "thread.delete", commandId, threadId })),
      ).toMatchObject({
        _tag: "OrchestrationV2DispatchCommandError",
        message: "Thread is busy.",
      });
    }),
  );

  it.effect("starts a thread in a new worktree from the project's folder", () =>
    Effect.gen(function* () {
      const machine = makeMachine();
      yield* Stream.runDrain(machine.client[ORCHESTRATION.subscribeShell]({}));
      const created = ThreadId.make("thread-new");

      const launched = yield* machine.client[ORCHESTRATION.launchThread]({
        commandId,
        threadId: created,
        projectId: ProjectId.make(shellCapture.projects[0]!.id),
        title: "New thread",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        workspaceStrategy: { type: "worktree", baseRef: "main", branch: "feature" },
        initialMessage: { messageId: MessageId.make("message-2"), text: "Begin", attachments: [] },
      });

      expect(launched).toMatchObject({ threadId: created, resumed: false, sequence: 1 });
      expect(launched.projection.messages).toMatchObject([{ id: "message-2", text: "Begin" }]);
      expect(machine.sent).toMatchObject([
        {
          type: "thread.turn.start",
          threadId: created,
          bootstrap: {
            createThread: { title: "New thread", branch: "feature" },
            prepareWorktree: {
              projectCwd: shellCapture.projects[0]?.workspaceRoot,
              baseBranch: "main",
              branch: "feature",
            },
          },
        },
      ]);
    }),
  );

  it.effect("follows a thread as snapshots and reads it again for an event it cannot apply", () =>
    Effect.gen(function* () {
      const snapshot = { kind: "snapshot", snapshot: threadCapture };
      const last = streamCapture.at(-1)!.event;
      const reverted = {
        kind: "event",
        event: { ...last, sequence: last.sequence + 1, type: "thread.reverted", payload: {} },
      };
      const reread = {
        kind: "snapshot",
        snapshot: {
          snapshotSequence: last.sequence + 1,
          thread: { ...threadCapture.thread, title: "Read again" },
        },
      };
      const machine = makeMachine([
        [snapshot, { kind: "synchronized" }, ...streamCapture, reverted],
        [reread],
      ]);

      const items = yield* Stream.runCollect(
        machine.client[ORCHESTRATION.subscribeThread]({ threadId, afterSequence: 12 }),
      );

      for (const item of items) validThreadItem(item);
      // One burst of events is one mapped thread, however many events it held.
      expect(items.map((item) => item.kind)).toEqual(["snapshot", "synchronized"]);
      expect(items[0]).toMatchObject({
        snapshotSequence: last.sequence + 1,
        projection: { thread: { title: "Read again" } },
      });
      expect(machine.reads()).toBe(2);
    }),
  );
});
