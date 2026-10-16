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

import { projectEvent } from "./projector.ts";
import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const threadId = ThreadId.make("thread-1");

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
        pullRequests: [],
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

const plan = {
  id: "plan-1",
  turnId: TurnId.make("plan-turn"),
  planMarkdown: "# Build it",
  implementedAt: null,
  implementationThreadId: null,
  createdAt: NOW,
  updatedAt: NOW,
};
const command = {
  type: "thread.turn.start" as const,
  commandId: CommandId.make("approve-in-thread"),
  threadId,
  message: {
    messageId: MessageId.make("implement"),
    role: "user" as const,
    text: "Implement it",
    attachments: [],
  },
  sourceProposedPlan: { threadId, planId: plan.id },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  createdAt: NOW,
};

it.layer(NodeServices.layer)("plan acceptance", (it) => {
  it.effect(
    "persists acceptance before provider startup, then ignores approval from another device",
    () =>
      Effect.gen(function* () {
        let readModel = makeReadModel({ latestTurn: null });
        readModel = {
          ...readModel,
          threads: readModel.threads.map((t) => ({ ...t, proposedPlans: [plan] })),
        };
        const result = yield* decideOrchestrationCommand({ command, readModel });
        const events = Array.isArray(result) ? result : [result];
        expect(events.map((e) => e.type)).toEqual([
          "thread.proposed-plan-upserted",
          "thread.message-sent",
          "thread.turn-start-requested",
        ]);
        for (const [index, event] of events.entries()) {
          readModel = yield* projectEvent(readModel, { ...event, sequence: index + 1 });
        }
        expect(readModel.threads[0]?.proposedPlans[0]).toMatchObject({
          approvedAt: NOW,
          implementedAt: null,
        });
        const replay = yield* decideOrchestrationCommand({
          command: { ...command, commandId: CommandId.make("approve-by-phone") },
          readModel,
        });
        expect(replay).toEqual([]);
        const late = yield* decideOrchestrationCommand({
          command: {
            type: "thread.proposed-plan.upsert",
            commandId: CommandId.make("late-plan"),
            threadId,
            proposedPlan: { ...plan, planMarkdown: "# Late plan text" },
            createdAt: NOW,
          },
          readModel,
        });
        expect(late).toMatchObject({ payload: { proposedPlan: { approvedAt: NOW } } });
      }),
  );
});
