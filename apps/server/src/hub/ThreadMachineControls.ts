/**
 * Client controls for thread machines (`threadMachines.wake`,
 * `threadMachines.pause`).
 *
 * - `wake` resumes or recreates the machine through the connection pool (the
 *   same path a turn takes, so the runner is connected and its handlers run
 *   once it is up). It waits at most `WAKE_REPLY_WAIT` for the result and
 *   otherwise returns the state the directory reported so far; the rest of
 *   the wake continues in the background and is visible on the thread shell.
 * - `pause` releases the hub's hold: it closes the runner connection and
 *   reports the machine idle, after which the platform pauses it. A running
 *   turn refuses with `busy`.
 *
 * Only existing, unarchived threads are controlled; the provider sign-in
 * machine is managed by the sign-in flow.
 *
 * @module hub/ThreadMachineControls
 */
import {
  PROVIDER_SIGN_IN_THREAD_ID,
  type ThreadId,
  ThreadMachineControlError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadMachineControls, type ThreadMachineControlsShape } from "../serverModeHooks.ts";
import { RunnerConnectionPool } from "./RunnerConnectionPool.ts";
import { ThreadMachineStates, toShellMachineStatus } from "./ThreadMachineStates.ts";

/** How long `wake` waits for the machine before answering with its progress. */
const WAKE_REPLY_WAIT = "2 seconds";

export const make = Effect.gen(function* () {
  const pool = yield* RunnerConnectionPool;
  const states = yield* ThreadMachineStates;
  const projections = yield* ProjectionSnapshotQuery;
  const scope = yield* Effect.scope;

  const requireThread = (operation: string, threadId: ThreadId) =>
    Effect.gen(function* () {
      const thread =
        threadId === PROVIDER_SIGN_IN_THREAD_ID
          ? Option.none()
          : yield* projections
              .getThreadShellById(threadId)
              .pipe(Effect.orElseSucceed(() => Option.none()));
      if (Option.isNone(thread)) {
        return yield* new ThreadMachineControlError({
          operation,
          reason: "not-found",
          detail: `Thread ${threadId} does not exist or is archived.`,
        });
      }
    });

  const current = (threadId: ThreadId) => toShellMachineStatus(states.get(threadId));

  const wake: ThreadMachineControlsShape["wake"] = (threadId) =>
    Effect.gen(function* () {
      yield* requireThread("threadMachines.wake", threadId);
      const fiber = yield* pool
        .use(threadId, { wake: true, operation: "threadMachines.wake" }, () => Effect.void)
        .pipe(
          Effect.tapError((error) =>
            Effect.logInfo("thread machine wake did not complete", {
              threadId,
              reason: error.reason,
              detail: error.detail,
            }),
          ),
          Effect.forkIn(scope),
        );
      const settled = yield* Fiber.await(fiber).pipe(Effect.timeoutOption(WAKE_REPLY_WAIT));
      if (Option.isSome(settled) && Exit.isFailure(settled.value)) {
        const failure = Exit.findErrorOption(settled.value);
        if (Option.isSome(failure)) {
          return yield* new ThreadMachineControlError({
            operation: "threadMachines.wake",
            reason: "unavailable",
            ...(failure.value.state !== undefined ? { state: failure.value.state } : {}),
            detail: failure.value.detail,
          });
        }
      }
      return current(threadId);
    });

  const pause: ThreadMachineControlsShape["pause"] = (threadId) =>
    Effect.gen(function* () {
      yield* requireThread("threadMachines.pause", threadId);
      if ((yield* pool.idle(threadId)) === "busy") {
        return yield* new ThreadMachineControlError({
          operation: "threadMachines.pause",
          reason: "busy",
          detail: "A turn is running on this thread's machine.",
        });
      }
      return current(threadId);
    });

  return { wake, pause } satisfies ThreadMachineControlsShape;
});

export const layer = Layer.effect(ThreadMachineControls, make);
