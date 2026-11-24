import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  PlanId,
  RunId,
  ThreadId,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import {
  OrchestratorCommandPreviouslyRejectedError,
  OrchestratorDispatchError,
} from "../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ThreadLiveWork from "./ThreadLiveWork.ts";
import * as DocumentText from "../provider/DocumentText.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import { LegacyCommand } from "./legacyCommands.ts";
import * as ManagedDevPc from "./ManagedDevPc.ts";
import * as TurnInstructions from "./TurnInstructions.ts";

const threadId = ThreadId.make("thread-1");
const decode = Schema.decodeUnknownSync(LegacyCommand);

const existingThread = {
  id: threadId,
  status: "completed",
  activeRunId: null,
  deletedAt: null,
  runtimeMode: "full-access",
  interactionMode: "plan",
} as OrchestrationV2ThreadShell;

/** The service over a thread store that records what it is asked and answers as `dispatch` says. */
const layerWith = (input: {
  readonly shell?: OrchestrationV2ThreadShell | null;
  readonly captured: OrchestrationV2ServerCommand[];
  readonly dispatch?: (
    command: OrchestrationV2ServerCommand,
  ) => ReturnType<ThreadManagementService.ThreadManagementService["Service"]["dispatch"]>;
  readonly launched?: ThreadLaunchService.ThreadLaunchInput[];
}) =>
  ManagedDevPc.layer.pipe(
    Layer.provide(
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadShell: () =>
          Effect.succeed(input.shell === undefined ? existingThread : input.shell),
        hasReceipt: () => Effect.succeed(false),
        dispatch: (command) => {
          input.captured.push(command);
          return (
            input.dispatch?.(command) ??
            Effect.succeed({ sequence: input.captured.length, storedEvents: [] })
          );
        },
      }),
    ),
    Layer.provide(
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({
        launch: (launch) => {
          input.launched?.push(launch);
          return Effect.succeed({ threadId, sequence: 1 } as never);
        },
      }),
    ),
    Layer.provide(ThreadLiveWork.layerOff),
    Layer.provide(Layer.mock(ProjectStore.ProjectStoreV2)({})),
    Layer.provide(Layer.mock(ProviderRegistry.ProviderRegistry)({})),
    Layer.provide(Layer.mock(TurnInstructions.TurnInstructions)({})),
    Layer.provide(ServerSettings.layerTest()),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-managed-devpc-" }).pipe(
        Layer.provideMerge(DocumentText.layer.pipe(Layer.provideMerge(NodeServices.layer))),
      ),
    ),
  );

const dispatch = (command: unknown) =>
  Effect.flatMap(ManagedDevPc.ManagedDevPc, (managed) => managed.dispatch(decode(command)));

it.effect("starts work on an approved plan with one command: leaves plan mode, then sends", () => {
  const captured: OrchestrationV2ServerCommand[] = [];
  return Effect.gen(function* () {
    const receipt = yield* dispatch({
      type: "thread.turn.start",
      commandId: "cmd-1",
      threadId,
      message: { messageId: "msg-1", role: "user", text: "Carry out the plan", attachments: [] },
      interactionMode: "default",
      runtimeMode: "full-access",
      sourceProposedPlan: { threadId, planId: "plan-1" },
      createdAt: "2026-08-09T12:00:00.000Z",
    });
    expect(receipt).toEqual({ sequence: 2 });
    expect(captured).toMatchObject([
      {
        type: "thread.interaction-mode.set",
        commandId: CommandId.make("cmd-1:interaction-mode"),
        interactionMode: "default",
      },
      {
        type: "message.dispatch",
        commandId: CommandId.make("cmd-1"),
        messageId: MessageId.make("msg-1"),
        text: "Carry out the plan",
        sourcePlanRef: { threadId, planId: PlanId.make("plan-1") },
        dispatchMode: { type: "start_immediately" },
        createdBy: "user",
      },
    ]);
  }).pipe(Effect.provide(layerWith({ captured })));
});

it.effect(
  "hands a running turn the message to steer or queue, and continues a settled one by id",
  () => {
    const captured: OrchestrationV2ServerCommand[] = [];
    return Effect.gen(function* () {
      yield* dispatch({
        type: "thread.turn.start",
        commandId: "cmd-2",
        threadId,
        message: { messageId: "msg-2", role: "user", text: "Carry on", attachments: [] },
        continuation: { turnId: "run-0" },
      });
      expect(captured).toMatchObject([
        {
          type: "message.dispatch",
          manualContinuationOfRunId: RunId.make("run-0"),
          deliveryIntent: "auto",
          dispatchMode: { type: "queue_after_active" },
        },
      ]);
    }).pipe(
      Effect.provide(
        layerWith({
          captured,
          shell: {
            ...existingThread,
            status: "running",
            activeRunId: RunId.make("run-1"),
            interactionMode: "default",
          },
        }),
      ),
    );
  },
);

it.effect("stores an inline image as an upload the message then carries by id", () => {
  const captured: OrchestrationV2ServerCommand[] = [];
  return Effect.gen(function* () {
    const bytes = Buffer.from([1, 2, 3]);
    yield* dispatch({
      type: "thread.turn.start",
      commandId: "cmd-3",
      threadId,
      message: {
        messageId: "msg-3",
        role: "user",
        text: "Look",
        attachments: [
          {
            type: "image",
            name: "screen.png",
            mimeType: "image/png",
            sizeBytes: 3,
            dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
          },
        ],
      },
    });
    const sent = captured.find((command) => command.type === "message.dispatch");
    expect(sent?.attachments).toMatchObject([{ type: "image", name: "screen.png", sizeBytes: 3 }]);
    // Claimed for the thread: the upload left the pending store under the thread's own id.
    expect(sent?.attachments[0]?.id.startsWith("thread-1-")).toBe(true);
  }).pipe(
    Effect.provide(
      layerWith({ captured, shell: { ...existingThread, interactionMode: "default" } }),
    ),
  );
});

it.effect("translates the first model's thread commands into today's", () => {
  const captured: OrchestrationV2ServerCommand[] = [];
  return Effect.gen(function* () {
    const base = { threadId, createdAt: "2026-08-09T12:00:00.000Z" };
    yield* dispatch({ ...base, type: "thread.turn.interrupt", commandId: "c1" });
    yield* dispatch({
      ...base,
      type: "thread.approval.respond",
      commandId: "c2",
      requestId: "req-1",
      decision: "accept",
    });
    yield* dispatch({
      ...base,
      type: "thread.user-input.respond",
      commandId: "c3",
      requestId: "req-2",
      answers: { q: ["yes"] },
    });
    yield* dispatch({ ...base, type: "thread.meta.update", commandId: "c4", title: "Renamed" });
    yield* dispatch({ ...base, type: "thread.unsettle", commandId: "c5" });
    expect(captured).toMatchObject([
      { type: "thread.stop", commandId: "c1" },
      { type: "runtime-request.respond", commandId: "c2", requestId: "req-1", decision: "accept" },
      { type: "runtime-request.respond", commandId: "c3", answers: { q: ["yes"] } },
      { type: "thread.metadata.update", commandId: "c4", title: "Renamed" },
      { type: "thread.unsettle", commandId: "c5", reason: "user" },
    ]);
  }).pipe(Effect.provide(layerWith({ captured })));
});

it.effect("refuses for good what was rejected before, in the words Aldo recognises", () => {
  const captured: OrchestrationV2ServerCommand[] = [];
  return Effect.gen(function* () {
    const error = yield* dispatch({
      type: "thread.archive",
      commandId: "cmd-rejected",
      threadId,
    }).pipe(Effect.flip);
    expect(error.refused).toBe(true);
    expect(error.detail).toBe(
      "Command previously rejected (cmd-rejected): Thread is already archived.",
    );
  }).pipe(
    Effect.provide(
      layerWith({
        captured,
        dispatch: (command) =>
          Effect.fail(
            new OrchestratorCommandPreviouslyRejectedError({
              commandId: command.commandId,
              commandType: command.type,
              detail: "Thread is already archived.",
            }),
          ),
      }),
    ),
  );
});

it.effect("keeps a command for another try when the server could not take it", () => {
  const captured: OrchestrationV2ServerCommand[] = [];
  return Effect.gen(function* () {
    const failure = yield* dispatch({ type: "thread.pin", commandId: "cmd-busy", threadId }).pipe(
      Effect.flip,
    );
    expect(failure.refused).toBe(false);
    const missing = yield* dispatch({
      type: "thread.turn.start",
      commandId: "cmd-missing",
      threadId,
      message: { messageId: "msg-4", role: "user", text: "Hello", attachments: [] },
    }).pipe(Effect.flip);
    expect(missing.refused).toBe(false);
  }).pipe(
    Effect.provide(
      layerWith({
        captured,
        dispatch: (command) =>
          Effect.fail(
            new OrchestratorDispatchError({
              commandId: command.commandId,
              commandType: command.type,
              cause: "database is locked",
            }),
          ),
      }),
    ),
  );
});

it.effect("refuses a turn or a command for a thread that does not exist", () => {
  const captured: OrchestrationV2ServerCommand[] = [];
  return Effect.gen(function* () {
    const error = yield* dispatch({
      type: "thread.turn.start",
      commandId: "cmd-none",
      threadId,
      message: { messageId: "msg-5", role: "user", text: "Hello", attachments: [] },
    }).pipe(Effect.flip);
    expect(error.refused).toBe(true);
    // A kept command for a thread since deleted must not hold up the ones behind it.
    const pin = yield* dispatch({ type: "thread.pin", commandId: "cmd-gone", threadId }).pipe(
      Effect.flip,
    );
    expect(pin.refused).toBe(true);
    expect(captured).toEqual([]);
  }).pipe(Effect.provide(layerWith({ captured, shell: null })));
});

it.effect("launches a new thread for a first message, not an update of one that is missing", () => {
  const launched: ThreadLaunchService.ThreadLaunchInput[] = [];
  return Effect.gen(function* () {
    yield* dispatch({
      type: "thread.turn.start",
      commandId: "cmd-first",
      threadId,
      message: { messageId: "msg-first", role: "user", text: "Hello", attachments: [] },
      bootstrap: {
        createThread: {
          projectId: "project-1",
          title: "First",
          modelSelection: { instanceId: "codex", model: "gpt-5" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
        },
      },
    });
    expect(launched).toHaveLength(1);
    expect(launched[0]?.threadId).toBe(threadId);
    expect(launched[0]?.reuseExistingThread).not.toBe(true);
  }).pipe(Effect.provide(layerWith({ captured: [], shell: null, launched })));
});
