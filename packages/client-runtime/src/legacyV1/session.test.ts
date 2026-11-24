import {
  CommandId,
  MessageId,
  ModelSelection,
  OrchestrationV2ThreadStreamItem,
  ProjectId,
  RunId,
  RuntimeRequestId,
  ServerConfig,
  ThreadId,
  type OrchestrationV2Command,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import configCapture from "./fixtures/config.v1.json" with { type: "json" };
import shellCapture from "./fixtures/shell.real.json" with { type: "json" };
import threadCapture from "./fixtures/thread.real.json" with { type: "json" };
import streamCapture from "./fixtures/threadStream.real.json" with { type: "json" };
import { readLegacyFrame, wrapLegacyClient, type V1Client } from "./session.ts";
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
function makeMachine(
  threadReads: ReadonlyArray<ReadonlyArray<unknown>> = [],
  shellReads: ReadonlyArray<ReadonlyArray<unknown>> = [],
) {
  const sent: Array<V1ClientCommand> = [];
  let reads = 0;
  let shells = 0;
  const v1 = {
    [V1.dispatchCommand]: (command: V1ClientCommand) =>
      command.type === "thread.delete"
        ? Effect.fail({ _tag: "OrchestrationDispatchCommandError", message: "Thread is busy." })
        : Effect.sync(() => ({ sequence: sent.push(acceptCommand(command)) })),
    [V1.subscribeShell]: () =>
      Stream.fromIterable(
        (
          shellReads[shells++] ?? [
            { kind: "snapshot", snapshot: shellCapture },
            { kind: "synchronized" },
          ]
        ).map((item) => decodeShellItem(item)),
      ),
    [V1.subscribeThread]: () =>
      Stream.fromIterable((threadReads[reads++] ?? []).map((item) => decodeThreadItem(item))),
  } as unknown as V1Client;
  return {
    sent,
    reads: () => reads,
    client: wrapLegacyClient({} as WsRpcProtocolClient, v1, new Map()),
  };
}

describe("a generation-1 machine's config", () => {
  // The fixture is a V1 machine's descriptor, sign-in methods and settings file as the V1 schema
  // puts them on the wire; its lists are empty.
  const decodeConfig = Schema.decodeUnknownSync(ServerConfig);
  const read = (config: unknown) =>
    decodeConfig(JSON.parse(readLegacyFrame(JSON.stringify(config)) as string));

  it("decodes as this client's config", () => {
    expect(read(configCapture)).toMatchObject({
      environment: { orchestrationProtocolVersion: 1 },
      settings: { responseStreamingMode: "paragraph", guestSharingEnabled: false },
    });
  });

  it("maps or drops every value and field only V1 has", () => {
    const { environment, settings } = configCapture;
    const config = read({
      ...configCapture,
      environment: {
        ...environment,
        capabilities: { ...environment.capabilities, primeAgentSubscriptionOAuth: true },
      },
      settings: {
        ...settings,
        responseStreamingMode: "token",
        projectSettingsOverrides: {
          "project-1": { responseStreamingMode: "token", worktreeCleanup: { mode: "off" } },
        },
        cursorKeychainUsageEnabled: true,
        backgroundActivity: {
          ...settings.backgroundActivity,
          overrides: { idleClientTtl: 60_000 },
        },
        sourceControlWritingStyle: { mode: "custom", customInstructions: "Short." },
        usageLimitSources: {
          hub: { kind: "cliproxy", url: "https://hub.test", managementKey: "key" },
        },
      },
    });

    expect(config.settings).toMatchObject({
      responseStreamingMode: "paragraph",
      projectSettingsOverrides: {
        "project-1": { responseStreamingMode: "paragraph", worktreeCleanup: { mode: "off" } },
      },
      sourceControlWritingStyle: { mode: "custom", customInstructions: "Short." },
      usageLimitSources: { hub: { managementKey: "key", enabled: true } },
    });
    for (const dropped of ["providers", "bitbucket", "cursorKeychainUsageEnabled"]) {
      expect(configCapture.settings).toHaveProperty(dropped);
      expect(config.settings).not.toHaveProperty(dropped);
    }
    expect(config.settings.backgroundActivity.overrides).toEqual({});
    expect(config.environment.capabilities).not.toHaveProperty("primeAgentSubscriptionOAuth");
    for (const dropped of ["threadProviderContinuation", "reasoningMessages"]) {
      expect(configCapture).toHaveProperty(dropped);
      expect(config).not.toHaveProperty(dropped);
    }
  });
});

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

  it.effect(
    "steers at once, holds a queued message for the end of the turn, and Stop holds it",
    () =>
      Effect.gen(function* () {
        const running = shellCapture.threads[0]!;
        const turnEnded = (state: "completed" | "interrupted") => ({
          kind: "thread-upserted",
          sequence: shellCapture.snapshotSequence + 1,
          thread: {
            ...running,
            session: { ...running.session, status: state === "completed" ? "ready" : state },
            latestTurn: { ...running.latestTurn, state, completedAt: "2026-11-24T06:30:00.000Z" },
          },
        });
        const turnRunning = { ...turnEnded("completed"), thread: running };
        const thread = [{ kind: "snapshot", snapshot: threadCapture }];
        const machine = makeMachine(
          [thread, thread],
          [
            [{ kind: "snapshot", snapshot: shellCapture }],
            [turnEnded("interrupted")],
            [turnRunning],
            [turnEnded("completed")],
          ],
        );
        const dispatch = machine.client[ORCHESTRATION.dispatchCommand];
        const shellMoves = Effect.suspend(() =>
          Stream.runDrain(machine.client[ORCHESTRATION.subscribeShell]({})),
        );
        const message = (id: string, mode: "queue" | "steer") =>
          ({
            type: "message.dispatch",
            createdBy: "user",
            creationSource: "web",
            commandId,
            threadId,
            messageId: MessageId.make(id),
            text: id,
            attachments: [],
            ...(mode === "steer" ? { deliveryIntent: "steer" } : {}),
            dispatchMode: { type: mode === "steer" ? "start_immediately" : "queue_after_active" },
          }) satisfies OrchestrationV2Command;
        const queued = Effect.map(
          Effect.suspend(() =>
            Stream.runCollect(
              machine.client[ORCHESTRATION.subscribeThread]({ threadId, afterSequence: 0 }),
            ),
          ),
          (items) => {
            for (const item of items) validThreadItem(item);
            const [first] = items;
            return first?.kind === "snapshot"
              ? first.projection.runs.flatMap((run) =>
                  run.status === "queued" ? [[run.userMessageId, run.queueHeld]] : [],
                )
              : null;
          },
        );
        const sentIds = () =>
          machine.sent.flatMap((command) =>
            command.type === "thread.turn.start" ? [command.message.messageId] : [],
          );

        yield* shellMoves;
        yield* dispatch(message("steered", "steer"));
        yield* dispatch(message("first", "queue"));
        yield* dispatch(message("second", "queue"));
        expect(sentIds()).toEqual(["steered"]);
        expect(yield* queued).toEqual([
          ["first", false],
          ["second", false],
        ]);

        // Stopped from anywhere: what waits stays until the user says so.
        yield* shellMoves;
        expect(sentIds()).toEqual(["steered"]);
        yield* dispatch({
          type: "queued-run.cancel",
          commandId,
          threadId,
          runId: RunId.make("second"),
        });
        expect(yield* queued).toEqual([["first", true]]);
        yield* dispatch({ type: "queue.resume", commandId, threadId });
        expect(sentIds()).toEqual(["steered", "first"]);

        yield* shellMoves;
        yield* dispatch(message("third", "queue"));
        expect(sentIds()).toEqual(["steered", "first"]);
        yield* shellMoves;
        expect(sentIds()).toEqual(["steered", "first", "third"]);

        // Nothing runs and nothing waits: a queued message is an ordinary one.
        yield* dispatch(message("idle", "queue"));
        expect(sentIds()).toEqual(["steered", "first", "third", "idle"]);
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
