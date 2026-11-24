/**
 * Follows a generation-1 thread stream. The client only understands V2 items, and a V1 event has no
 * V2 event to become, so every change is handed over as a fresh snapshot of the mapped thread.
 */
import type { OrchestrationV2ThreadStreamItem } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { mapThreadProjection } from "./toV2.ts";
import {
  V1ActivityAppendedPayload,
  V1MessageSentPayload,
  V1SessionSetPayload,
  type V1Event,
  type V1LatestTurn,
  type V1Session,
  type V1Thread,
  type V1ThreadStreamItem,
} from "./wire.ts";

const messageSent = Schema.decodeUnknownOption(V1MessageSentPayload);
const activityAppended = Schema.decodeUnknownOption(V1ActivityAppendedPayload);
const sessionSet = Schema.decodeUnknownOption(V1SessionSetPayload);

const ENDED_TURN: Partial<Record<V1Session["status"], V1LatestTurn["state"]>> = {
  idle: "completed",
  ready: "completed",
  error: "error",
  interrupted: "interrupted",
  stopped: "interrupted",
};

function latestTurnForSession(thread: V1Thread, session: V1Session): V1Thread["latestTurn"] {
  const latest = thread.latestTurn;
  if (session.status === "running" && session.activeTurnId !== null) {
    const same = latest?.turnId === session.activeTurnId ? latest : null;
    return {
      turnId: session.activeTurnId,
      state: "running",
      requestedAt: same?.requestedAt ?? session.updatedAt,
      startedAt: same?.startedAt ?? session.updatedAt,
      completedAt: null,
      assistantMessageId: same?.assistantMessageId ?? null,
    };
  }
  const ended = ENDED_TURN[session.status];
  return latest?.state === "running" && ended !== undefined
    ? { ...latest, state: ended, completedAt: session.updatedAt }
    : latest;
}

/**
 * Applies the events that arrive many times a second while an agent works. Every other event
 * (a new turn, a plan, a revert, a rename) is rare and changes more than one part of the thread,
 * so it answers "reload": fetch the thread's snapshot again instead of re-deriving it here.
 */
export function applyThreadEvent(thread: V1Thread, event: V1Event): V1Thread | "reload" {
  if (event.type === "thread.message-sent") {
    const payload = messageSent(event.payload);
    if (Option.isNone(payload)) return "reload";
    const sent = payload.value;
    const index = thread.messages.findIndex((message) => message.id === sent.messageId);
    const known = thread.messages[index];
    if (known === undefined) {
      const { messageId, turnId, ...rest } = sent;
      return {
        ...thread,
        messages: [...thread.messages, { ...rest, id: messageId, turnId: turnId ?? null }],
        updatedAt: event.occurredAt,
      };
    }
    // A streaming event carries the next piece; the closing one carries the whole text or nothing.
    const messages = thread.messages.slice();
    messages[index] = {
      ...known,
      text: sent.streaming ? known.text + sent.text : sent.text || known.text,
      streaming: sent.streaming,
      updatedAt: sent.streaming ? known.updatedAt : sent.updatedAt,
      ...(sent.attachments === undefined ? {} : { attachments: sent.attachments }),
    };
    return { ...thread, messages, updatedAt: event.occurredAt };
  }
  if (event.type === "thread.activity-appended") {
    const payload = activityAppended(event.payload);
    if (Option.isNone(payload)) return "reload";
    const { activity } = payload.value;
    return {
      ...thread,
      activities: [...thread.activities.filter((known) => known.id !== activity.id), activity],
      updatedAt: event.occurredAt,
    };
  }
  if (event.type === "thread.session-set") {
    const payload = sessionSet(event.payload);
    if (Option.isNone(payload)) return "reload";
    const { session } = payload.value;
    return {
      ...thread,
      session,
      latestTurn: latestTurnForSession(thread, session),
      updatedAt: event.occurredAt,
    };
  }
  return "reload";
}

export interface ThreadStreamState {
  readonly thread: V1Thread | null;
  readonly sequence: number;
}

export interface ThreadStreamStep {
  readonly state: ThreadStreamState;
  readonly items: ReadonlyArray<OrchestrationV2ThreadStreamItem>;
  /** The caller must load the thread's snapshot and feed it back as a snapshot item. */
  readonly reload: boolean;
}

/**
 * A batch of V1 stream items in, the V2 items the client should see out. Mapping a thread costs
 * its whole length, so however many events the batch holds, the thread is mapped once.
 */
export function stepThreadStream(
  state: ThreadStreamState,
  batch: V1ThreadStreamItem | ReadonlyArray<V1ThreadStreamItem>,
): ThreadStreamStep {
  let { thread, sequence } = state;
  let synchronized = false;
  let reload = false;
  for (const item of Array.isArray(batch) ? batch : [batch as V1ThreadStreamItem]) {
    if (item.kind === "synchronized") {
      synchronized = true;
    } else if (item.kind === "snapshot") {
      thread = item.snapshot.thread;
      sequence = item.snapshot.snapshotSequence;
      reload = false;
    } else if (!reload && item.event.sequence > sequence) {
      // A replay can repeat what the snapshot already holds.
      const next = thread === null ? "reload" : applyThreadEvent(thread, item.event);
      // The snapshot loaded next holds this event and the rest of the batch.
      if (next === "reload") {
        reload = true;
      } else {
        thread = next;
        sequence = item.event.sequence;
      }
    }
  }
  return {
    state: { thread, sequence },
    items: [
      ...(reload || thread === null || thread === state.thread
        ? []
        : [snapshotItem(thread, sequence)]),
      ...(synchronized ? [{ kind: "synchronized" as const }] : []),
    ],
    reload,
  };
}

const snapshotItem = (thread: V1Thread, sequence: number): OrchestrationV2ThreadStreamItem => ({
  kind: "snapshot",
  snapshotSequence: sequence,
  projection: mapThreadProjection(thread),
});
