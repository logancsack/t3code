import { CommandId, EventId, type ThreadId } from "@t3tools/contracts";
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
  seededTurnLiveness,
  stalledTurns,
  type StalledTurn,
  type TurnLiveness,
} from "../turnLiveness.ts";

const DEFAULT_MODEL_SILENCE_MS = 10 * 60 * 1000;
const DEFAULT_RECOVERY_GRACE_MS = 90 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 30 * 1000;

export interface TurnLivenessWatchdogLiveOptions {
  readonly modelSilenceMs?: number;
  readonly recoveryGraceMs?: number;
  readonly sweepIntervalMs?: number;
  readonly enabled?: boolean;
}

function envInt(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
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

    const entries = new Map<ThreadId, TurnLiveness>();

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
      });

    const sweep = Effect.gen(function* () {
      const nowMs = yield* Clock.currentTimeMillis;
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
    });

    const followRuntimeEvents = Stream.runForEach(providerService.streamEvents, (event) =>
      Effect.gen(function* () {
        const nowMs = yield* Clock.currentTimeMillis;
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
        });
      });

    return {
      start,
    } satisfies TurnLivenessWatchdogShape;
  });

export const makeTurnLivenessWatchdogLive = (options?: TurnLivenessWatchdogLiveOptions) =>
  Layer.effect(TurnLivenessWatchdog, makeTurnLivenessWatchdog(options));

export const TurnLivenessWatchdogLive = makeTurnLivenessWatchdogLive();
