/**
 * Thread activities a hub records about thread machines.
 *
 * Kinds (see `THREAD_MACHINE_ACTIVITY_KINDS` in contracts):
 * - `thread-machine.state` on every machine state transition, payload
 *   `{ state, detail, bootId }`, tone `error` for `failed`.
 * - `thread-machine.checkout.preparing` when bootstrap prepares the checkout.
 * - `thread-machine.failed` when bootstrap or checkout preparation fails.
 *
 * @module hub/threadMachineActivity
 */
import {
  CommandId,
  EventId,
  THREAD_MACHINE_ACTIVITY_KINDS,
  type ThreadId,
  type ThreadMachineState,
  type ThreadMachineStateActivityPayload,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";

export interface ThreadMachineActivity {
  readonly kind: string;
  readonly summary: string;
  readonly tone: "info" | "error";
  readonly payload: Record<string, unknown>;
}

const STATE_SUMMARIES: Record<ThreadMachineState, string> = {
  none: "No machine",
  preparing: "Preparing machine",
  starting: "Starting machine",
  running: "Machine running",
  paused: "Machine asleep",
  saved: "Machine saved",
  failed: "Machine failed",
};

/** The `thread-machine.state` activity for a machine state. */
export const threadMachineStateActivity = (
  payload: ThreadMachineStateActivityPayload,
): ThreadMachineActivity => ({
  kind: THREAD_MACHINE_ACTIVITY_KINDS.state,
  summary: STATE_SUMMARIES[payload.state],
  tone: payload.state === "failed" ? "error" : "info",
  payload: { state: payload.state, detail: payload.detail, bootId: payload.bootId },
});

/**
 * A function appending activities to threads; failures are logged, never
 * raised. Resolve it once where the orchestration engine is available.
 */
export const makeThreadMachineActivityRecorder = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;
  return (threadId: ThreadId, activity: ThreadMachineActivity): Effect.Effect<void> =>
    Effect.gen(function* () {
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      const uuid = yield* crypto.randomUUIDv4;
      yield* engine.dispatch({
        type: "thread.activity.append",
        commandId: CommandId.make(`server:thread-machine-activity:${uuid}`),
        threadId,
        activity: {
          id: EventId.make(uuid),
          tone: activity.tone,
          kind: activity.kind,
          summary: activity.summary,
          payload: activity.payload,
          turnId: null,
          createdAt,
        },
        createdAt,
      });
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("failed to record thread machine activity", {
          threadId,
          kind: activity.kind,
          detail: String(error.message).slice(0, 300),
        }),
      ),
    );
});
