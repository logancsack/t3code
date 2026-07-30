import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationReadModel,
  type OrchestrationSession,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const threadId = ThreadId.make("thread-1");
const failedTurnId = TurnId.make("turn-failed");

function makeMessage(overrides: {
  id: string;
  role: "user" | "assistant";
  turnId?: string | null;
  text?: string;
}): OrchestrationMessage {
  return {
    id: MessageId.make(overrides.id),
    role: overrides.role,
    text: overrides.text ?? "do the thing",
    attachments: [],
    turnId:
      overrides.turnId === undefined
        ? null
        : overrides.turnId === null
          ? null
          : TurnId.make(overrides.turnId),
    streaming: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeReadModel(input: {
  latestTurn: OrchestrationLatestTurn | null;
  messages?: OrchestrationMessage[];
  session?: OrchestrationSession | null;
}): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: threadId,
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: input.latestTurn,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        deletedAt: null,
        messages: input.messages ?? [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: input.session ?? null,
      },
    ],
    updatedAt: NOW,
  };
}

function makeLatestTurn(state: OrchestrationLatestTurn["state"]): OrchestrationLatestTurn {
  return {
    turnId: failedTurnId,
    state,
    requestedAt: NOW,
    startedAt: NOW,
    completedAt: state === "running" ? null : NOW,
    assistantMessageId: null,
  };
}

function retryCommand(commandId = "cmd-retry") {
  return {
    type: "thread.turn.retry",
    commandId: CommandId.make(commandId),
    threadId,
    turnId: failedTurnId,
    createdAt: NOW,
  } as const;
}

it.layer(NodeServices.layer)("turn retry decider", (it) => {
  it.effect("re-drives the failed turn's originating user message without a new message", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: retryCommand(),
        readModel: makeReadModel({
          latestTurn: makeLatestTurn("interrupted"),
          messages: [
            makeMessage({ id: "message-old", role: "user", turnId: "turn-old" }),
            makeMessage({ id: "message-failed", role: "user", turnId: "turn-failed" }),
            makeMessage({ id: "message-assistant", role: "assistant", turnId: "turn-failed" }),
          ],
        }),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("thread.turn-start-requested");
      if (events[0]?.type === "thread.turn-start-requested") {
        expect(events[0].payload.messageId).toBe("message-failed");
      }
    }),
  );

  it.effect("falls back to the last user message when the turn linkage is missing", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: retryCommand(),
        readModel: makeReadModel({
          latestTurn: makeLatestTurn("error"),
          messages: [
            makeMessage({ id: "message-first", role: "user", turnId: null }),
            makeMessage({ id: "message-last", role: "user", turnId: null }),
          ],
        }),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events[0]?.type).toBe("thread.turn-start-requested");
      if (events[0]?.type === "thread.turn-start-requested") {
        expect(events[0].payload.messageId).toBe("message-last");
      }
    }),
  );

  it.effect("rejects a retry for anything but the latest failed turn", () =>
    Effect.gen(function* () {
      const staleTurn = yield* decideOrchestrationCommand({
        command: retryCommand("cmd-retry-stale"),
        readModel: makeReadModel({
          latestTurn: { ...makeLatestTurn("interrupted"), turnId: TurnId.make("turn-newer") },
          messages: [makeMessage({ id: "message-1", role: "user" })],
        }),
      }).pipe(Effect.flip);
      expect(String(staleTurn)).toContain("not the latest turn");

      for (const state of ["running", "completed"] as const) {
        const wrongState = yield* decideOrchestrationCommand({
          command: retryCommand(`cmd-retry-${state}`),
          readModel: makeReadModel({
            latestTurn: makeLatestTurn(state),
            messages: [makeMessage({ id: "message-1", role: "user" })],
          }),
        }).pipe(Effect.flip);
        expect(String(wrongState)).toContain("not a failed turn");
      }
    }),
  );

  it.effect("rejects a retry while the session is running another turn", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: retryCommand("cmd-retry-busy"),
        readModel: makeReadModel({
          latestTurn: makeLatestTurn("interrupted"),
          messages: [makeMessage({ id: "message-1", role: "user" })],
          session: {
            threadId,
            status: "running",
            providerName: "Codex",
            runtimeMode: "full-access",
            activeTurnId: TurnId.make("turn-other"),
            lastError: null,
            updatedAt: NOW,
          },
        }),
      }).pipe(Effect.flip);
      expect(String(error)).toContain("already running");
    }),
  );

  it.effect("rejects a retry when the thread has no user message", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: retryCommand("cmd-retry-empty"),
        readModel: makeReadModel({
          latestTurn: makeLatestTurn("interrupted"),
          messages: [makeMessage({ id: "message-assistant", role: "assistant" })],
        }),
      }).pipe(Effect.flip);
      expect(String(error)).toContain("no user message");
    }),
  );
});
