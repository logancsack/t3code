/**
 * Turns the commands the client builds into the ones a generation-1 machine accepts. Ids pass
 * through unchanged (see `toV2.ts`), so only names and a few fields differ.
 */
import {
  ApprovalRequestId,
  TurnId,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadLaunchInput,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";

import type { V1ClientCommand } from "./wire.ts";

/** What a V1 command needs that the V2 command leaves to the thread. */
export interface V1CommandContext {
  readonly now: string;
  /** The thread's modes as last seen; V1 sends them with every turn. */
  readonly thread: (threadId: ThreadId) =>
    | {
        readonly runtimeMode: RuntimeMode;
        readonly interactionMode: ProviderInteractionMode;
      }
    | undefined;
}

export type V1CommandResult =
  | { readonly kind: "send"; readonly commands: ReadonlyArray<V1ClientCommand> }
  /** The command changes nothing a V1 machine keeps, so it succeeds without a request. */
  | { readonly kind: "skip" }
  | { readonly kind: "unsupported"; readonly type: string };

const send = (...commands: ReadonlyArray<V1ClientCommand>): V1CommandResult => ({
  kind: "send",
  commands,
});

export function toV1Commands(
  command: OrchestrationV2Command,
  context: V1CommandContext,
): V1CommandResult {
  const { commandId } = command;
  const createdAt = context.now;
  switch (command.type) {
    case "thread.archive":
    case "thread.unarchive":
    case "thread.delete":
    case "thread.settle":
    case "thread.unpin":
      return send({ type: command.type, commandId, threadId: command.threadId });
    case "thread.unsettle":
    case "thread.unsnooze":
      return send({ type: command.type, commandId, threadId: command.threadId, reason: "user" });
    case "thread.snooze":
      return send({
        type: command.type,
        commandId,
        threadId: command.threadId,
        snoozedUntil: command.snoozedUntil,
      });
    case "thread.pin":
      return send({
        type: command.type,
        commandId,
        threadId: command.threadId,
        ...(command.orderKey === undefined ? {} : { orderKey: command.orderKey }),
      });
    case "thread.pin.reorder":
    case "thread.active.reorder":
      return send({
        type: command.type,
        commandId,
        threadId: command.threadId,
        orderKey: command.orderKey,
      });
    case "thread.auto-settle.set":
      return send({
        type: command.type,
        commandId,
        threadId: command.threadId,
        enabled: command.enabled,
      });
    case "thread.metadata.update":
      return send({
        type: "thread.meta.update",
        commandId,
        threadId: command.threadId,
        ...(command.title === undefined ? {} : { title: command.title }),
        ...(command.regenerateTitle ? { regenerateTitle: true as const } : {}),
        ...(command.branch === undefined ? {} : { branch: command.branch }),
        ...(command.expectedBranch === undefined ? {} : { expectedBranch: command.expectedBranch }),
        ...(command.worktreePath === undefined ? {} : { worktreePath: command.worktreePath }),
        ...(command.linkedPullRequest === undefined
          ? {}
          : { linkedPullRequest: command.linkedPullRequest }),
      });
    case "thread.model-selection.set":
      return send({
        type: "thread.meta.update",
        commandId,
        threadId: command.threadId,
        modelSelection: command.modelSelection,
      });
    case "thread.runtime-mode.set":
      return send({
        type: command.type,
        commandId,
        threadId: command.threadId,
        runtimeMode: command.runtimeMode,
        createdAt,
      });
    case "thread.interaction-mode.set":
      return send({
        type: command.type,
        commandId,
        threadId: command.threadId,
        interactionMode: command.interactionMode,
        createdAt,
      });
    case "thread.create":
      return send({
        type: "thread.create",
        commandId,
        threadId: command.threadId,
        projectId: command.projectId,
        title: command.title,
        modelSelection: command.modelSelection,
        runtimeMode: command.runtimeMode,
        interactionMode: command.interactionMode,
        branch: command.branch,
        worktreePath: command.worktreePath,
        createdAt,
      });
    case "message.dispatch": {
      const thread = context.thread(command.threadId);
      // V1 has no queue and no steering: a message always starts a turn.
      if (thread === undefined || command.dispatchMode.type === "steer_active") {
        return { kind: "unsupported", type: `message.dispatch:${command.dispatchMode.type}` };
      }
      const continuation = command.manualContinuationOfRunId ?? command.restartContinuationOfRunId;
      return send({
        type: "thread.turn.start",
        commandId,
        threadId: command.threadId,
        message: {
          messageId: command.messageId,
          role: "user",
          text: command.text,
          attachments: command.attachments,
          ...(command.context === undefined ? {} : { context: command.context }),
        },
        ...(command.modelSelection === undefined ? {} : { modelSelection: command.modelSelection }),
        ...(command.titleSeed === undefined ? {} : { titleSeed: command.titleSeed }),
        runtimeMode: thread.runtimeMode,
        // Accepting a plan means building it, whatever mode the thread was planning in.
        interactionMode: command.sourcePlanRef === undefined ? thread.interactionMode : "default",
        ...(command.sourcePlanRef === undefined
          ? {}
          : { sourceProposedPlan: command.sourcePlanRef }),
        ...(continuation === undefined
          ? {}
          : { continuation: { turnId: TurnId.make(continuation) } }),
        createdAt,
      });
    }
    case "run.interrupt":
      return send({
        type: "thread.turn.interrupt",
        commandId,
        threadId: command.threadId,
        turnId: TurnId.make(command.runId),
        createdAt,
      });
    case "thread.stop":
      return send({
        type: "thread.turn.interrupt",
        commandId,
        threadId: command.threadId,
        createdAt,
      });
    case "runtime-request.respond": {
      const requestId = ApprovalRequestId.make(command.requestId);
      if (command.answers !== undefined) {
        return send({
          type: "thread.user-input.respond",
          commandId,
          threadId: command.threadId,
          requestId,
          answers: command.answers,
          ...(command.attachmentsByQuestionId === undefined
            ? {}
            : { attachmentsByQuestionId: command.attachmentsByQuestionId }),
          createdAt,
        });
      }
      // V1 takes a decision only; feedback typed with a decline is dropped.
      return command.decision === undefined
        ? { kind: "unsupported", type: "runtime-request.respond:empty" }
        : send({
            type: "thread.approval.respond",
            commandId,
            threadId: command.threadId,
            requestId,
            decision: command.decision,
            createdAt,
          });
    }
    case "thread.user-input.dismiss":
      return send({
        type: command.type,
        commandId,
        threadId: command.threadId,
        requestId: ApprovalRequestId.make(command.requestId),
        createdAt,
      });
    // Read state and tags live only on V2 machines.
    case "thread.visit":
    case "thread.mark-unread":
    case "thread.tag.set":
      return { kind: "skip" };
    default:
      return { kind: "unsupported", type: command.type };
  }
}

/**
 * A first message on a V1 machine is a turn start that also creates its thread. Worktree launches
 * are left to the caller: V1 needs the project's folder for them, which the launch input lacks.
 */
export function launchToV1Command(
  input: OrchestrationV2ThreadLaunchInput & { readonly threadId: ThreadId },
  now: string,
): V1ClientCommand | null {
  const { initialMessage, workspaceStrategy } = input;
  if (initialMessage?.messageId === undefined || workspaceStrategy.type === "worktree") return null;
  return {
    type: "thread.turn.start",
    commandId: input.commandId,
    threadId: input.threadId,
    message: {
      messageId: initialMessage.messageId,
      role: "user",
      text: initialMessage.text,
      attachments: initialMessage.attachments,
      ...(initialMessage.context === undefined ? {} : { context: initialMessage.context }),
    },
    modelSelection: input.modelSelection,
    ...(input.generateTitle ? { titleSeed: input.title } : {}),
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
    ...(input.reuseExistingThread
      ? {}
      : {
          bootstrap: {
            createThread: {
              projectId: input.projectId,
              title: input.title,
              modelSelection: input.modelSelection,
              runtimeMode: input.runtimeMode,
              interactionMode: input.interactionMode,
              branch: workspaceStrategy.branch ?? null,
              worktreePath:
                workspaceStrategy.type === "existing_worktree"
                  ? workspaceStrategy.worktreePath
                  : null,
              createdAt: now,
            },
          },
        }),
    createdAt: now,
  };
}
