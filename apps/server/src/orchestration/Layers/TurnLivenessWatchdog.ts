import { CommandId, EventId, type ThreadId, type TurnId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  TurnLivenessWatchdog,
  type TurnLivenessWatchdogShape,
} from "../Services/TurnLivenessWatchdog.ts";
import {
  applyRuntimeEvent,
  rebaseAfterSuspend,
  seededTurnLiveness,
  stalledTurns,
  type StalledTurn,
  type TurnLiveness,
} from "../turnLiveness.ts";

const DEFAULT_MODEL_SILENCE_MS = 10 * 60 * 1000;
const DEFAULT_RECOVERY_GRACE_MS = 90 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 30 * 1000;
const DEFAULT_MAX_AUTO_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 30 * 1000;
/** Failed attempts stop counting against the budget after this long. */
const RETRY_BUDGET_EXPIRY_MS = 24 * 60 * 60 * 1000;
/**
 * A clock reading arriving this many sweep intervals past the previous one
 * means the VM was suspended, not that the event loop hiccuped. Two full
 * intervals of slack keeps load-induced jitter from reading as a suspend.
 */
const SUSPEND_GAP_SWEEP_INTERVALS = 2;
/**
 * Window after a detected resume in which a turn failure is attributed to
 * the suspend (its provider connection died with the VM's TCP state) and is
 * therefore auto-retried within the normal budget.
 */
const POST_RESUME_FAILURE_WINDOW_MS = 3 * 60 * 1000;

export interface TurnLivenessWatchdogLiveOptions {
  readonly modelSilenceMs?: number;
  readonly recoveryGraceMs?: number;
  readonly sweepIntervalMs?: number;
  readonly maxAutoRetries?: number;
  readonly retryDelayMs?: number;
  readonly enabled?: boolean;
}

/**
 * Consecutive-failure bookkeeping for one thread's auto-retries.
 *
 * The budget is what makes retry loops impossible: attempts only reset on a
 * completed turn (real success) or after a day, so a turn that stalls every
 * time it runs is retried at most `maxAutoRetries` times and then stays
 * visibly failed for the human to decide.
 */
interface ThreadRetryState {
  attempts: number;
  lastAttemptAtMs: number;
  scheduled: { turnId: TurnId; notBeforeMs: number } | null;
}

function envInt(name: string, minimum = 1): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : undefined;
}

function describeSilence(silentForMs: number): string {
  const minutes = Math.round(silentForMs / 60_000);
  if (minutes < 2) return `${Math.max(1, Math.round(silentForMs / 1000))} seconds`;
  return `${minutes} minutes`;
}

const makeTurnLivenessWatchdog = (options?: TurnLivenessWatchdogLiveOptions) =>
  Effect.gen(function* () {
    const providerService = yield* ProviderService;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const crypto = yield* Crypto.Crypto;

    const enabled = options?.enabled ?? process.env.T3CODE_TURN_WATCHDOG !== "0";
    const modelSilenceMs =
      options?.modelSilenceMs ??
      (envInt("T3CODE_TURN_STALL_SECONDS") ?? DEFAULT_MODEL_SILENCE_MS / 1000) * 1000;
    const recoveryGraceMs =
      options?.recoveryGraceMs ??
      (envInt("T3CODE_TURN_RECOVERY_GRACE_SECONDS") ?? DEFAULT_RECOVERY_GRACE_MS / 1000) * 1000;
    const sweepIntervalMs = Math.max(1, options?.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS);
    const maxAutoRetries =
      options?.maxAutoRetries ?? envInt("T3CODE_TURN_AUTO_RETRIES", 0) ?? DEFAULT_MAX_AUTO_RETRIES;
    const retryDelayMs = options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

    const entries = new Map<ThreadId, TurnLiveness>();
    const retryStateByThread = new Map<ThreadId, ThreadRetryState>();
    let lastObservedClockMs: number | null = null;
    let resumedAtMs: number | null = null;

    /**
     * Advance the shared clock baseline and detect a VM suspend: a reading
     * far past the last one plus a sweep interval means this machine slept
     * in between. Runs in BOTH the sweep and the runtime-event path — the
     * first thing delivered after a resume is often the dying provider
     * stream's terminal event, up to a full sweep interval before the timer
     * fires, and retry attribution must already know about the resume by
     * then.
     */
    const observeClock = (nowMs: number) =>
      Effect.gen(function* () {
        const previous = lastObservedClockMs;
        lastObservedClockMs = nowMs;
        if (
          previous === null ||
          nowMs - previous - sweepIntervalMs < SUSPEND_GAP_SWEEP_INTERVALS * sweepIntervalMs
        ) {
          return;
        }
        resumedAtMs = nowMs;
        rebaseAfterSuspend(entries, nowMs);
        yield* Effect.logInfo("turn.watchdog.resumed-after-suspend", {
          suspendedForMs: nowMs - previous - sweepIntervalMs,
          rebasedTurnCount: entries.size,
        });
      });

    const watchdogCommandId = (tag: string) =>
      crypto.randomUUIDv4.pipe(Effect.map((uuid) => CommandId.make(`watchdog:${tag}:${uuid}`)));

    const seedFromSnapshot = Effect.gen(function* () {
      const snapshot = yield* projectionSnapshotQuery.getShellSnapshot();
      const nowMs = yield* Clock.currentTimeMillis;
      let seeded = 0;
      for (const thread of snapshot.threads) {
        const latestTurn = thread.latestTurn;
        if (latestTurn === null || latestTurn.state !== "running") continue;
        entries.set(thread.id, seededTurnLiveness(latestTurn.turnId, nowMs));
        seeded += 1;
      }
      if (seeded > 0) {
        yield* Effect.logInfo("turn.watchdog.seeded-from-snapshot", {
          seededTurnCount: seeded,
          recoveryGraceMs,
        });
      }
    });

    const interruptStalledTurn = (stalled: StalledTurn) =>
      Effect.gen(function* () {
        // Re-check against the current projection before acting: the sweep
        // decision came from in-memory bookkeeping, and the turn may have
        // settled, moved on, or grown a pending human request since.
        const thread = yield* projectionSnapshotQuery
          .getThreadShellById(stalled.threadId)
          .pipe(Effect.map(Option.getOrUndefined));
        const latestTurn = thread?.latestTurn;
        if (
          thread === undefined ||
          latestTurn == null ||
          latestTurn.state !== "running" ||
          latestTurn.turnId !== stalled.turnId ||
          thread.hasPendingApprovals ||
          thread.hasPendingUserInput
        ) {
          entries.delete(stalled.threadId);
          return;
        }

        const createdAt = DateTime.formatIso(yield* DateTime.now);
        const summary =
          stalled.reason === "orphaned-after-restart"
            ? "This turn did not survive a server restart and was marked interrupted."
            : stalled.reason === "suspend-silence"
              ? "The workspace was paused mid-turn and the provider connection did not survive the resume — the turn was interrupted."
              : `No provider activity for ${describeSilence(stalled.silentForMs)} — the turn was interrupted.`;

        const activityCommandId = yield* watchdogCommandId("activity");
        const activityId = yield* crypto.randomUUIDv4.pipe(
          Effect.map((uuid) => EventId.make(`watchdog:${uuid}`)),
        );
        yield* orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId: activityCommandId,
          threadId: stalled.threadId,
          activity: {
            id: activityId,
            tone: "error",
            kind: "turn.stalled",
            summary,
            payload: {
              turnId: stalled.turnId,
              reason: stalled.reason,
              silentForMs: stalled.silentForMs,
            },
            turnId: stalled.turnId,
            createdAt,
          },
          createdAt,
        });

        const interruptCommandId = yield* watchdogCommandId("interrupt");
        yield* orchestrationEngine.dispatch({
          type: "thread.turn.interrupt",
          commandId: interruptCommandId,
          threadId: stalled.threadId,
          turnId: stalled.turnId,
          createdAt,
        });

        entries.delete(stalled.threadId);
        yield* Effect.logWarning("turn.watchdog.interrupted-stalled-turn", {
          threadId: stalled.threadId,
          turnId: stalled.turnId,
          reason: stalled.reason,
          silentForMs: stalled.silentForMs,
        });

        // A model-silence or suspend-silence stall is a dead provider
        // connection, which a fresh turn recovers from — schedule one bounded
        // retry. Restart orphans are not retried: the budget bookkeeping died
        // with the old process, and retrying there could loop across
        // repeated crashes.
        if (stalled.reason === "orphaned-after-restart" || maxAutoRetries < 1) return;
        const nowMs = yield* Clock.currentTimeMillis;
        const retryState = currentRetryState(stalled.threadId, nowMs);
        if (retryState.attempts >= maxAutoRetries) {
          yield* Effect.logInfo("turn.watchdog.retry-budget-exhausted", {
            threadId: stalled.threadId,
            turnId: stalled.turnId,
            attempts: retryState.attempts,
          });
          return;
        }
        retryState.scheduled = { turnId: stalled.turnId, notBeforeMs: nowMs + retryDelayMs };
        retryStateByThread.set(stalled.threadId, retryState);
      });

    const currentRetryState = (threadId: ThreadId, nowMs: number): ThreadRetryState => {
      const existing = retryStateByThread.get(threadId);
      if (existing === undefined || nowMs - existing.lastAttemptAtMs > RETRY_BUDGET_EXPIRY_MS) {
        return { attempts: 0, lastAttemptAtMs: nowMs, scheduled: null };
      }
      return existing;
    };

    const dispatchScheduledRetry = (threadId: ThreadId, retryState: ThreadRetryState) =>
      Effect.gen(function* () {
        const scheduled = retryState.scheduled;
        if (scheduled === null) return;
        retryState.scheduled = null;

        // Only retry if the interrupt actually landed and the human has not
        // already moved the thread on: the failed turn must still be the
        // latest, in a failed state, with nothing else running.
        const thread = yield* projectionSnapshotQuery
          .getThreadShellById(threadId)
          .pipe(Effect.map(Option.getOrUndefined));
        const latestTurn = thread?.latestTurn;
        if (
          thread === undefined ||
          latestTurn == null ||
          latestTurn.turnId !== scheduled.turnId ||
          (latestTurn.state !== "interrupted" && latestTurn.state !== "error") ||
          (thread.session?.status === "running" && thread.session.activeTurnId !== null)
        ) {
          return;
        }

        const nowMs = yield* Clock.currentTimeMillis;
        retryState.attempts += 1;
        retryState.lastAttemptAtMs = nowMs;
        retryStateByThread.set(threadId, retryState);

        const createdAt = DateTime.formatIso(yield* DateTime.now);
        const activityCommandId = yield* watchdogCommandId("retry-activity");
        const activityId = yield* crypto.randomUUIDv4.pipe(
          Effect.map((uuid) => EventId.make(`watchdog:${uuid}`)),
        );
        yield* orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId: activityCommandId,
          threadId,
          activity: {
            id: activityId,
            tone: "info",
            kind: "turn.auto-retried",
            summary: `Automatically retrying the interrupted turn (attempt ${retryState.attempts} of ${maxAutoRetries}).`,
            payload: {
              turnId: scheduled.turnId,
              attempt: retryState.attempts,
              maxAttempts: maxAutoRetries,
            },
            turnId: scheduled.turnId,
            createdAt,
          },
          createdAt,
        });

        const retryCommandId = yield* watchdogCommandId("retry");
        yield* orchestrationEngine.dispatch({
          type: "thread.turn.retry",
          commandId: retryCommandId,
          threadId,
          turnId: scheduled.turnId,
          createdAt,
        });

        yield* Effect.logInfo("turn.watchdog.auto-retried-turn", {
          threadId,
          turnId: scheduled.turnId,
          attempt: retryState.attempts,
          maxAttempts: maxAutoRetries,
        });
      });

    const sweep = Effect.gen(function* () {
      const nowMs = yield* Clock.currentTimeMillis;
      yield* observeClock(nowMs);
      const stalled = stalledTurns(entries, nowMs, { modelSilenceMs, recoveryGraceMs });
      for (const turn of stalled) {
        yield* interruptStalledTurn(turn).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("turn.watchdog.interrupt-failed", {
              threadId: turn.threadId,
              turnId: turn.turnId,
              cause,
            }),
          ),
        );
      }

      for (const [threadId, retryState] of retryStateByThread) {
        if (retryState.scheduled !== null && nowMs >= retryState.scheduled.notBeforeMs) {
          yield* dispatchScheduledRetry(threadId, retryState).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("turn.watchdog.retry-failed", { threadId, cause }),
            ),
          );
        }
        if (
          retryState.scheduled === null &&
          nowMs - retryState.lastAttemptAtMs > RETRY_BUDGET_EXPIRY_MS
        ) {
          retryStateByThread.delete(threadId);
        }
      }
    });

    const followRuntimeEvents = Stream.runForEach(providerService.streamEvents, (event) =>
      Effect.gen(function* () {
        // Some providers report a broken turn as a completion carrying a
        // failed state (ahead of their own error / session-exit events), so
        // "completed" alone is not proof of recovery.
        const failedCompletion =
          event.type === "turn.completed" &&
          "state" in event.payload &&
          event.payload.state === "failed";
        // A successfully completed turn is the proof of recovery that
        // refills the auto-retry budget; anything less keeps counting
        // toward the cap.
        if (event.type === "turn.completed" && !failedCompletion) {
          retryStateByThread.delete(event.threadId);
        }
        const nowMs = yield* Clock.currentTimeMillis;
        // The resume must be known BEFORE this event is judged: the first
        // thing delivered after a suspend is often the dying stream's own
        // terminal event, well ahead of the next sweep timer.
        yield* observeClock(nowMs);
        // A probation turn dying shortly after a resume-from-suspend is the
        // suspend's doing (its provider stream went down with the VM's TCP
        // state), not the model's — schedule a budgeted retry so the work
        // survives the pause instead of ending in a manual-retry error.
        // Turns started after the resume (or already proven live) fail for
        // their own reasons and are not second-guessed here.
        if (
          (event.type === "turn.aborted" ||
            event.type === "session.exited" ||
            event.type === "runtime.error" ||
            failedCompletion) &&
          resumedAtMs !== null &&
          nowMs - resumedAtMs <= POST_RESUME_FAILURE_WINDOW_MS &&
          maxAutoRetries > 0
        ) {
          const tracked = entries.get(event.threadId);
          if (tracked?.resumedProbation === true) {
            // A commanded interrupt (the user's Stop, or this watchdog's
            // own stall handling) projects the turn as interrupted before
            // the provider's terminal event arrives — deliberate stops must
            // never be auto-restarted. A pause-broken stream dies with no
            // command, leaving the projection running (or errored once the
            // failure is ingested). Unknown projection state errs toward
            // respecting the stop.
            const thread = yield* projectionSnapshotQuery.getThreadShellById(event.threadId).pipe(
              Effect.map(Option.getOrUndefined),
              Effect.orElseSucceed(() => undefined),
            );
            const latestTurn = thread?.latestTurn;
            const uncommanded =
              latestTurn != null &&
              latestTurn.turnId === tracked.turnId &&
              latestTurn.state !== "interrupted";
            const retryState = currentRetryState(event.threadId, nowMs);
            if (
              uncommanded &&
              retryState.attempts < maxAutoRetries &&
              retryState.scheduled === null
            ) {
              // A bare abort with no session-level follow-up never settles
              // the projected turn on its own (ingestion has no turn.aborted
              // lifecycle case), and the retry dispatcher only accepts
              // settled turns. Interrupt it explicitly so the scheduled
              // retry can land instead of being silently rejected.
              if (event.type === "turn.aborted" && latestTurn.state === "running") {
                yield* Effect.gen(function* () {
                  const createdAt = DateTime.formatIso(yield* DateTime.now);
                  const interruptCommandId = yield* watchdogCommandId("suspend-interrupt");
                  yield* orchestrationEngine.dispatch({
                    type: "thread.turn.interrupt",
                    commandId: interruptCommandId,
                    threadId: event.threadId,
                    turnId: tracked.turnId,
                    createdAt,
                  });
                }).pipe(
                  Effect.catchCause((cause) =>
                    Effect.logWarning("turn.watchdog.suspend-interrupt-failed", {
                      threadId: event.threadId,
                      turnId: tracked.turnId,
                      cause,
                    }),
                  ),
                );
              }
              retryState.scheduled = { turnId: tracked.turnId, notBeforeMs: nowMs + retryDelayMs };
              retryStateByThread.set(event.threadId, retryState);
              yield* Effect.logInfo("turn.watchdog.retry-after-suspend-failure", {
                threadId: event.threadId,
                turnId: tracked.turnId,
                eventType: event.type,
              });
            }
          }
        }
        const next = applyRuntimeEvent(entries.get(event.threadId), event, nowMs);
        if (next === null) {
          entries.delete(event.threadId);
          return;
        }
        entries.set(event.threadId, next);
      }),
    );

    const start: TurnLivenessWatchdogShape["start"] = () =>
      Effect.gen(function* () {
        if (!enabled) {
          yield* Effect.logInfo("turn.watchdog.disabled");
          return;
        }

        yield* seedFromSnapshot.pipe(
          Effect.catchCause((cause) => Effect.logWarning("turn.watchdog.seed-failed", { cause })),
        );

        yield* Effect.forkScoped(followRuntimeEvents);
        yield* Effect.forkScoped(
          sweep.pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("turn.watchdog.sweep-failed", { cause }),
            ),
            Effect.repeat(Schedule.spaced(Duration.millis(sweepIntervalMs))),
          ),
        );

        yield* Effect.logInfo("turn.watchdog.started", {
          modelSilenceMs,
          recoveryGraceMs,
          sweepIntervalMs,
          maxAutoRetries,
          retryDelayMs,
        });
      });

    return {
      start,
    } satisfies TurnLivenessWatchdogShape;
  });

export const makeTurnLivenessWatchdogLive = (options?: TurnLivenessWatchdogLiveOptions) =>
  Layer.effect(TurnLivenessWatchdog, makeTurnLivenessWatchdog(options));

export const TurnLivenessWatchdogLive = makeTurnLivenessWatchdogLive();
