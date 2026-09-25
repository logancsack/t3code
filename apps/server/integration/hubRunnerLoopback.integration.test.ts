// @effect-diagnostics nodeBuiltinImport:off
/**
 * The remote provider driver and the orchestration reactors on a hub, against
 * a real runner over the runner protocol (loopback WebSocket, one process).
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  type ProviderRuntimeEvent,
  TurnId,
} from "@t3tools/contracts";
import { projectVirtualRoot } from "@t3tools/contracts/runner";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { checkpointRefForThreadTurn } from "../src/checkpointing/Utils.ts";
import {
  type HubRunnerLoopbackHarness,
  LOOPBACK_INSTANCE_ID,
  LOOPBACK_PROVIDER,
  makeHubRunnerLoopbackHarness,
} from "./HubRunnerLoopbackHarness.integration.ts";
import type { TestTurnResponse } from "./TestProviderAdapter.integration.ts";

const PROJECT_ID = ProjectId.make("project-loopback");
const MODEL = { instanceId: LOOPBACK_INSTANCE_ID, model: "gpt-5-codex" };
const at = (second: number) => `2026-09-25T00:00:${String(second).padStart(2, "0")}.000Z`;

const withHarness = <A, E>(use: (harness: HubRunnerLoopbackHarness) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(makeHubRunnerLoopbackHarness(), use, (harness) => harness.dispose);

const seed = (harness: HubRunnerLoopbackHarness) =>
  Effect.gen(function* () {
    const engine = harness.engine();
    yield* engine.dispatch({
      type: "project.create",
      commandId: CommandId.make("cmd-project-create"),
      projectId: PROJECT_ID,
      title: "Loopback",
      workspaceRoot: projectVirtualRoot(PROJECT_ID),
      defaultModelSelection: MODEL,
      createdAt: at(0),
    });
    yield* engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make("cmd-thread-create"),
      threadId: harness.threadId,
      projectId: PROJECT_ID,
      title: "Loopback thread",
      modelSelection: MODEL,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required",
      branch: null,
      worktreePath: harness.checkout,
      createdAt: at(1),
    });
  });

const startTurn = (harness: HubRunnerLoopbackHarness, n: number, text: string) =>
  harness.engine().dispatch({
    type: "thread.turn.start",
    commandId: CommandId.make(`cmd-turn-start-${n}`),
    threadId: harness.threadId,
    message: { messageId: MessageId.make(`msg-user-${n}`), role: "user", text, attachments: [] },
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "approval-required",
    createdAt: at(10 + n),
  });

const fixture = (harness: HubRunnerLoopbackHarness, id: string) => ({
  eventId: EventId.make(id),
  provider: LOOPBACK_PROVIDER,
  createdAt: at(30),
  threadId: harness.threadId,
  turnId: "turn-fixture",
});

/** A runtime event appended straight to the runner outbox, as a provider would emit it. */
const outboxEvent = (
  harness: HubRunnerLoopbackHarness,
  id: string,
  turnId: string,
  body:
    | { readonly type: "turn.started"; readonly payload: Record<string, never> }
    | {
        readonly type: "content.delta";
        readonly payload: { readonly streamKind: "assistant_text"; readonly delta: string };
      }
    | { readonly type: "turn.completed"; readonly payload: { readonly state: "completed" } },
): ProviderRuntimeEvent =>
  ({
    eventId: EventId.make(id),
    provider: LOOPBACK_PROVIDER,
    providerInstanceId: LOOPBACK_INSTANCE_ID,
    threadId: harness.threadId,
    turnId: TurnId.make(turnId),
    createdAt: at(40),
    ...body,
  }) as ProviderRuntimeEvent;

const runFirstTurn = (harness: HubRunnerLoopbackHarness) =>
  Effect.gen(function* () {
    const response: TestTurnResponse = {
      events: [
        { type: "turn.started", ...fixture(harness, "evt-1") },
        { type: "message.delta", ...fixture(harness, "evt-2"), delta: "Hello from the runner.\n" },
        { type: "turn.completed", ...fixture(harness, "evt-3"), status: "completed" },
      ],
      mutateWorkspace: ({ cwd }) =>
        Effect.sync(() =>
          NodeFS.writeFileSync(NodePath.join(cwd, "notes.txt"), "edited remotely\n"),
        ),
    };
    yield* harness.runner().adapterHarness.queueTurnResponseForNextSession(response);
    // The scripted provider edits the checkout synchronously inside sendTurn, so
    // capture the pre-turn baseline up front instead of racing the reactor.
    yield* harness.checkpointStore().captureCheckpoint({
      cwd: harness.checkout,
      checkpointRef: checkpointRefForThreadTurn(harness.threadId, 0),
    });
    yield* startTurn(harness, 1, "Edit notes.txt");
    return yield* harness.waitForThread(
      (thread) =>
        thread.latestTurn?.state === "completed" &&
        thread.checkpoints.length === 1 &&
        thread.messages.some((message) => message.role === "assistant" && !message.streaming),
      "first turn settled with a checkpoint",
    );
  });

it.live(
  "runs a turn on the runner, projects it on the hub, and serves its diff without the machine",
  () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        yield* seed(harness);
        const thread = yield* runFirstTurn(harness);

        assert.deepEqual(
          thread.messages
            .filter((message) => message.role === "assistant")
            .map((message) => message.text),
          ["Hello from the runner.\n"],
        );
        assert.deepEqual(
          thread.checkpoints[0]?.files.map((file) => file.path),
          ["notes.txt"],
        );
        assert.equal(harness.runner().adapterHarness.getStartCount(), 1);

        // The capture stored the patch on the hub; stop the runner and read it back.
        const diffs = harness.diffStore();

        yield* harness
          .waitForThread(() => true, "noop")
          .pipe(
            Effect.andThen(
              Effect.repeat(
                diffs.get({
                  threadId: harness.threadId,
                  fromTurnCount: 0,
                  toTurnCount: 1,
                  ignoreWhitespace: true,
                }),
                { until: Option.isSome },
              ),
            ),
          );
        yield* harness.restartRunner().pipe(Effect.andThen(Effect.void));
        const patch = yield* harness.checkpointStore().diffCheckpoints({
          cwd: harness.checkout,
          fromCheckpointRef: checkpointRefForThreadTurn(harness.threadId, 0),
          toCheckpointRef: checkpointRefForThreadTurn(harness.threadId, 1),
          ignoreWhitespace: true,
        });
        assert.include(patch, "notes.txt");
        assert.include(patch, "+edited remotely");
      }),
    ),
);

it.live("routes an approval from the runner to the hub and the decision back", () =>
  withHarness((harness) =>
    Effect.gen(function* () {
      yield* seed(harness);
      yield* harness.runner().adapterHarness.queueTurnResponseForNextSession({
        events: [
          { type: "turn.started", ...fixture(harness, "evt-a1") },
          {
            type: "approval.requested",
            ...fixture(harness, "evt-a2"),
            requestId: "req-loopback-1",
            requestKind: "command",
            detail: "Run tests",
          },
          { type: "turn.completed", ...fixture(harness, "evt-a3"), status: "completed" },
        ],
      });
      yield* startTurn(harness, 1, "Needs approval");
      yield* harness.waitForPendingApproval("req-loopback-1", (row) => row.status === "pending");
      yield* harness.engine().dispatch({
        type: "thread.approval.respond",
        commandId: CommandId.make("cmd-approval-respond"),
        threadId: harness.threadId,
        requestId: "req-loopback-1" as never,
        decision: "accept",
        createdAt: at(20),
      });
      yield* harness.waitForPendingApproval(
        "req-loopback-1",
        (row) => row.status === "resolved" && row.decision === "accept",
      );
      const responses = yield* Effect.repeat(
        Effect.sync(() => harness.runner().adapterHarness.getApprovalResponses(harness.threadId)),
        { until: (value) => value.length === 1 },
      );
      assert.equal(responses[0]?.decision, "accept");
    }),
  ),
);

it.live("settles a running turn when the runner restarts without its session, then resumes", () =>
  withHarness((harness) =>
    Effect.gen(function* () {
      yield* seed(harness);
      yield* runFirstTurn(harness);

      // The provider starts another turn, then the machine restarts and loses it.
      yield* harness
        .runner()
        .outbox.append(
          outboxEvent(harness, "evt-open-1", "turn-open", { type: "turn.started", payload: {} }),
        );
      yield* harness.waitForThread(
        (thread) => thread.session?.activeTurnId === "turn-open",
        "the provider-started turn is active",
      );
      yield* harness.restartRunner({ freshAdapter: true });
      const settled = yield* harness.waitForThread(
        (thread) => thread.session?.activeTurnId === null && thread.session?.status !== "running",
        "the interrupted turn settled after the runner restart",
      );
      assert.notEqual(settled.session?.status, "running");

      // The next turn resumes the session from the persisted resume cursor.
      yield* harness.runner().adapterHarness.queueTurnResponseForNextSession({
        events: [
          { type: "turn.started", ...fixture(harness, "evt-r1") },
          { type: "message.delta", ...fixture(harness, "evt-r2"), delta: "Back again.\n" },
        ],
      });
      yield* startTurn(harness, 2, "Continue");
      // The scripted provider numbers turns per session, so the resumed session's
      // first turn reuses the id `turn-1`; assert on the text, not the turn id.
      const resumed = yield* harness.waitForThread(
        (thread) =>
          thread.latestTurn?.state === "completed" &&
          thread.messages.some(
            (message) => message.role === "assistant" && message.text.includes("Back again."),
          ),
        "resumed turn",
      );
      assert.equal(harness.runner().adapterHarness.getStartCount(), 1);
      assert.equal(resumed.session?.status, "ready");
    }),
  ),
);

it.live("replays an open turn after a hub restart without duplicating anything", () =>
  withHarness((harness) =>
    Effect.gen(function* () {
      yield* seed(harness);
      yield* runFirstTurn(harness);
      const outbox = () => harness.runner().outbox;

      yield* outbox().append(
        outboxEvent(harness, "evt-h1", "turn-h", { type: "turn.started", payload: {} }),
      );
      yield* outbox().append(
        outboxEvent(harness, "evt-h2", "turn-h", {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "part A, " },
        }),
      );
      yield* harness.waitForThread(
        (thread) => thread.session?.activeTurnId === "turn-h",
        "open turn delivered",
      );
      yield* Effect.repeat(harness.delivery().state, {
        until: (state) =>
          state.get(harness.threadId)?.delivered === (state.get(harness.threadId)?.safe ?? 0) + 2,
      });

      yield* harness.restartHub;
      // The provider keeps going while the hub is down.
      yield* outbox().append(
        outboxEvent(harness, "evt-h3", "turn-h", {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "part B" },
        }),
      );
      yield* outbox().append(
        outboxEvent(harness, "evt-h4", "turn-h", {
          type: "turn.completed",
          payload: { state: "completed" },
        }),
      );

      const thread = yield* harness.waitForThread(
        (value) =>
          value.session?.activeTurnId === null &&
          value.messages.some(
            (message) => message.role === "assistant" && message.text === "part A, part B",
          ),
        "replayed turn completed with its full text",
      );
      const assistantTexts = thread.messages
        .filter((message) => message.role === "assistant")
        .map((message) => message.text);
      assert.deepEqual(assistantTexts, ["Hello from the runner.\n", "part A, part B"]);
      assert.equal(thread.checkpoints.length, 1);
    }),
  ),
);

it.live("bootstraps a new thread on its machine: checkout path, branch, and progress", () =>
  withHarness((harness) =>
    Effect.gen(function* () {
      yield* harness.engine().dispatch({
        type: "project.create",
        commandId: CommandId.make("cmd-project-create"),
        projectId: PROJECT_ID,
        title: "Loopback",
        workspaceRoot: projectVirtualRoot(PROJECT_ID),
        defaultModelSelection: MODEL,
        createdAt: at(0),
      });
      yield* harness.runner().adapterHarness.queueTurnResponseForNextSession({
        events: [
          { type: "turn.started", ...fixture(harness, "evt-b1") },
          { type: "message.delta", ...fixture(harness, "evt-b2"), delta: "Bootstrapped.\n" },
        ],
      });
      yield* harness.dispatchClientCommand({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-bootstrap-turn"),
        threadId: harness.threadId,
        message: {
          messageId: MessageId.make("msg-bootstrap"),
          role: "user",
          text: "Hi",
          attachments: [],
        },
        runtimeMode: "approval-required",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        bootstrap: {
          createThread: {
            projectId: PROJECT_ID,
            title: "New thread",
            modelSelection: MODEL,
            runtimeMode: "approval-required",
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            branch: null,
            worktreePath: "/somewhere/the/client/chose",
            createdAt: at(1),
          },
          prepareWorktree: {
            projectCwd: projectVirtualRoot(PROJECT_ID),
            baseBranch: "main",
            branch: "t3/feature-x",
          },
        },
        createdAt: at(2),
      });
      const thread = yield* harness.waitForThread(
        (value) =>
          value.latestTurn?.state === "completed" &&
          value.messages.some((message) => message.role === "assistant"),
        "bootstrapped turn",
      );
      assert.equal(thread.worktreePath, harness.checkout);
      assert.equal(thread.branch, "t3/feature-x");
      assert.include(
        thread.activities.map((activity) => activity.kind),
        "thread-machine.checkout.preparing",
      );
      const checkedOut = NodeFS.readFileSync(
        NodePath.join(harness.checkout, ".git", "HEAD"),
        "utf8",
      );
      assert.equal(checkedOut.trim(), "ref: refs/heads/t3/feature-x");
    }),
  ),
);
