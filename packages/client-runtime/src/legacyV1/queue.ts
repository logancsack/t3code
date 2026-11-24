/**
 * A generation-1 machine has no queue: a message it is sent mid-turn joins or follows that turn at
 * once. So a queued message waits in this tab and leaves when the turn is over, and Stop holds
 * what is still waiting, as these machines' client did before.
 */
import {
  RunId,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import type { V1ClientCommand, V1ThreadShell } from "./wire.ts";

export type V1TurnStart = Extract<V1ClientCommand, { readonly type: "thread.turn.start" }>;

export interface ThreadQueue {
  readonly messages: ReadonlyArray<V1TurnStart>;
  readonly held: boolean;
  /** "sent" from a queued message leaving until the machine shows the turn it started. */
  readonly turn: "running" | "sent" | "over";
}

type Turn = Pick<V1ThreadShell, "session" | "latestTurn">;

export const isTurnRunning = (thread: Turn) =>
  thread.latestTurn?.state === "running" ||
  thread.session?.status === "running" ||
  thread.session?.status === "starting";

const wasStopped = (thread: Turn) =>
  thread.latestTurn?.state === "interrupted" ||
  thread.session?.status === "interrupted" ||
  thread.session?.status === "stopped";

const runIdOf = (message: V1TurnStart) => RunId.make(message.message.messageId);

export const enqueue = (queue: ThreadQueue | undefined, message: V1TurnStart): ThreadQueue => ({
  messages: [...(queue?.messages ?? []), message],
  held: queue?.held ?? false,
  turn: queue?.turn ?? "running",
});

/** Follows the thread's turn. One that was stopped, from any tab, holds the queue. */
export function observeTurn(queue: ThreadQueue, thread: Turn): ThreadQueue {
  if (isTurnRunning(thread))
    return queue.turn === "running" ? queue : { ...queue, turn: "running" };
  if (queue.turn !== "running") return queue;
  return { ...queue, turn: "over", held: queue.held || wasStopped(thread) };
}

/** The message to send now, with the queue as it is once it has left. */
export function takeDue(
  queue: ThreadQueue,
): { readonly queue: ThreadQueue; readonly send: V1TurnStart } | null {
  const [send, ...messages] = queue.messages;
  return send === undefined || queue.held || queue.turn !== "over"
    ? null
    : { queue: { ...queue, messages, turn: "sent" }, send };
}

/** What a queue command does to the messages waiting here; null for any other command. */
export function applyQueueCommand(
  queue: ThreadQueue,
  command: OrchestrationV2Command,
): { readonly queue: ThreadQueue; readonly send?: V1TurnStart } | null {
  const without = (runId: RunId) => queue.messages.filter((message) => runIdOf(message) !== runId);
  switch (command.type) {
    case "queue.resume":
      return { queue: { ...queue, held: false } };
    case "queued-run.cancel":
      return { queue: { ...queue, messages: without(command.runId) } };
    case "queued-run.start":
    case "queued-message.promote-to-steer": {
      const runId = command.type === "queued-run.start" ? command.runId : command.queuedRunId;
      const send = queue.messages.find((message) => runIdOf(message) === runId);
      if (send === undefined) return { queue };
      // Sent into a running turn it joins that turn, and the rest still wait for its end.
      const turn = queue.turn === "over" ? "sent" : queue.turn;
      return { queue: { ...queue, messages: without(runId), turn }, send };
    }
    case "queued-run.edit":
      return {
        queue: {
          ...queue,
          messages: queue.messages.map((queued) => {
            if (runIdOf(queued) !== command.runId) return queued;
            const { context: _context, ...message } = queued.message;
            return {
              ...queued,
              message: {
                ...message,
                text: command.text,
                ...(command.attachments === undefined ? {} : { attachments: command.attachments }),
                ...(command.context === undefined ? {} : { context: command.context }),
              },
            };
          }),
        },
      };
    case "queued-run.reorder": {
      const moved = queue.messages.find((message) => runIdOf(message) === command.runId);
      if (moved === undefined) return { queue };
      const rest = without(command.runId);
      const index = rest.findIndex((message) => runIdOf(message) === command.beforeRunId);
      rest.splice(index === -1 ? rest.length : index, 0, moved);
      return { queue: { ...queue, messages: rest } };
    }
    default:
      return null;
  }
}

/** The thread as the client shows it: each waiting message as a queued run behind the rest. */
export function withQueuedRuns(
  projection: OrchestrationV2ThreadProjection,
  queue: ThreadQueue | undefined,
): OrchestrationV2ThreadProjection {
  if (queue === undefined || queue.messages.length === 0) return projection;
  const { thread, runs, messages } = projection;
  return {
    ...projection,
    runs: [
      ...runs,
      ...queue.messages.map((queued, index) => ({
        id: runIdOf(queued),
        threadId: thread.id,
        ordinal: runs.length + index + 1,
        providerInstanceId: (queued.modelSelection ?? thread.modelSelection).instanceId,
        modelSelection: queued.modelSelection ?? thread.modelSelection,
        providerThreadId: null,
        userMessageId: queued.message.messageId,
        rootNodeId: null,
        activeAttemptId: null,
        status: "queued" as const,
        queuePosition: index + 1,
        queueHeld: queue.held,
        requestedAt: DateTime.makeUnsafe(queued.createdAt),
        startedAt: null,
        completedAt: null,
        checkpointId: null,
        contextHandoffId: null,
      })),
    ],
    messages: [
      ...messages,
      ...queue.messages.map((queued) => ({
        createdBy: "user" as const,
        creationSource: "web" as const,
        id: queued.message.messageId,
        threadId: thread.id,
        runId: runIdOf(queued),
        nodeId: null,
        role: "user" as const,
        text: queued.message.text,
        ...(queued.message.context === undefined ? {} : { context: queued.message.context }),
        // An upload still on its way has no stored form to show yet.
        attachments: queued.message.attachments.flatMap((attachment) =>
          "dataUrl" in attachment ? [] : [attachment],
        ),
        streaming: false,
        createdAt: DateTime.makeUnsafe(queued.createdAt),
        updatedAt: DateTime.makeUnsafe(queued.createdAt),
      })),
    ],
  };
}
