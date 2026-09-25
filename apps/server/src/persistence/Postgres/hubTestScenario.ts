/**
 * A shared orchestration scenario for hub tests: commands that touch every
 * projection, and a read of every snapshot query method.
 */
import {
  CheckpointRef,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";

export const at = (second: number) => `2026-09-25T00:00:${String(second).padStart(2, "0")}.000Z`;
export const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5-codex",
};
export const projectId = ProjectId.make("project-shared");
export const threadId = ThreadId.make("thread-shared");
export const otherThreadId = ThreadId.make("thread-archived");
export const turnId = TurnId.make("turn-1");

// Both tenants reuse the same ids: isolation must come from the tenant key.
export const commandsFor = (
  label: string,
  workspaceRoot = `/workspace/p/${projectId}`,
): ReadonlyArray<OrchestrationCommand> => [
  {
    type: "project.create",
    commandId: CommandId.make("cmd-project-create"),
    projectId,
    title: `Project of ${label}`,
    workspaceRoot,
    defaultModelSelection: modelSelection,
    createdAt: at(1),
  },
  {
    type: "thread.create",
    commandId: CommandId.make("cmd-thread-create"),
    threadId,
    projectId,
    title: `Thread of ${label}`,
    modelSelection,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "approval-required",
    branch: null,
    worktreePath: `/workspace/t/${threadId}`,
    createdAt: at(2),
  },
  {
    type: "thread.turn.start",
    commandId: CommandId.make("cmd-turn-start"),
    threadId,
    message: {
      messageId: MessageId.make("msg-user-1"),
      role: "user",
      text: `hello from ${label}`,
      attachments: [],
    },
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "approval-required",
    createdAt: at(3),
  },
  {
    type: "thread.session.set",
    commandId: CommandId.make("cmd-session-set"),
    threadId,
    session: {
      threadId,
      status: "running",
      providerName: "codex",
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeMode: "approval-required",
      activeTurnId: turnId,
      lastError: null,
      updatedAt: at(4),
    },
    createdAt: at(4),
  },
  {
    type: "thread.activity.append",
    commandId: CommandId.make("cmd-activity-1"),
    threadId,
    activity: {
      id: EventId.make("activity-1"),
      tone: "tool",
      kind: "tool.completed",
      summary: `tool ran for ${label}`,
      // JSON payloads may carry escaped NULs; Postgres keeps them as text.
      payload: { owner: label, output: "binary\u0000tail" },
      turnId,
      createdAt: at(5),
    },
    createdAt: at(5),
  },
  {
    type: "thread.message.assistant.delta",
    commandId: CommandId.make("cmd-assistant-delta-1"),
    threadId,
    messageId: MessageId.make("msg-assistant-1"),
    delta: `reply to ${label}`,
    turnId,
    createdAt: at(6),
  },
  {
    type: "thread.message.assistant.complete",
    commandId: CommandId.make("cmd-assistant-complete-1"),
    threadId,
    messageId: MessageId.make("msg-assistant-1"),
    turnId,
    createdAt: at(7),
  },
  {
    type: "thread.proposed-plan.upsert",
    commandId: CommandId.make("cmd-plan-1"),
    threadId,
    proposedPlan: {
      id: "plan-1",
      turnId,
      planMarkdown: `# Plan for ${label}`,
      implementedAt: null,
      implementationThreadId: null,
      createdAt: at(8),
      updatedAt: at(8),
    },
    createdAt: at(8),
  },
  {
    type: "thread.turn.diff.complete",
    commandId: CommandId.make("cmd-diff-1"),
    threadId,
    turnId,
    completedAt: at(9),
    checkpointRef: CheckpointRef.make("refs/t3/checkpoints/thread-shared/turn/1"),
    status: "ready",
    files: [{ path: "notes.txt", kind: "modified", additions: 1, deletions: 0 }],
    assistantMessageId: MessageId.make("msg-assistant-1"),
    checkpointTurnCount: 1,
    createdAt: at(9),
  },
  {
    type: "thread.meta.update",
    commandId: CommandId.make("cmd-thread-rename"),
    threadId,
    title: `Renamed thread of ${label}`,
  },
  {
    type: "thread.create",
    commandId: CommandId.make("cmd-thread-archived-create"),
    threadId: otherThreadId,
    projectId,
    title: `Archived thread of ${label}`,
    modelSelection,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "full-access",
    branch: null,
    worktreePath: null,
    createdAt: at(10),
  },
  {
    type: "thread.archive",
    commandId: CommandId.make("cmd-thread-archive"),
    threadId: otherThreadId,
  },
];

/** Dispatches the scenario and reads back through every snapshot query method. */
export const orchestrationScenario = (label: string, workspaceRoot?: string) =>
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    for (const command of commandsFor(label, workspaceRoot)) {
      yield* engine.dispatch(command);
    }
    return yield* readScenario(workspaceRoot);
  });

/** Reads the scenario back through the event stream and every snapshot query. */
export const readScenario = (workspaceRoot?: string) =>
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    const query = yield* ProjectionSnapshotQuery;
    const events = yield* Stream.runCollect(engine.readEvents(0));
    return {
      events: Array.from(events, (event) => ({
        sequence: event.sequence,
        type: event.type,
        aggregateId: event.aggregateId,
        payload: event.payload,
      })),
      commandReadModel: yield* query.getCommandReadModel(),
      snapshot: yield* query.getSnapshot(),
      shell: yield* query.getShellSnapshot(),
      archivedShell: yield* query.getArchivedShellSnapshot(),
      counts: yield* query.getCounts(),
      snapshotSequence: yield* query.getSnapshotSequence(),
      projectByRoot: yield* query.getActiveProjectByWorkspaceRoot(
        workspaceRoot ?? `/workspace/p/${projectId}`,
      ),
      projectShell: yield* query.getProjectShellById(projectId),
      firstThread: yield* query.getFirstActiveThreadIdByProjectId(projectId),
      checkpointContext: yield* query.getThreadCheckpointContext(threadId),
      fullDiffContext: yield* query.getFullThreadDiffContext(threadId, 1),
      threadShell: yield* query.getThreadShellById(threadId),
      threadDetail: yield* query.getThreadDetailById(threadId),
      detailSnapshot: yield* query.getThreadDetailSnapshot(threadId),
      windowedDetail: yield* query.getThreadDetailSnapshot(threadId, { turnLimit: 1 }),
      search: yield* query.searchThreads({ query: "RENAMED" }),
    };
  });
