/**
 * A managed workspace runs with nobody watching, so a turn whose provider went silent would hold
 * the machine up for ever. This interrupts such a turn, says why, and continues it a bounded
 * number of times. A restart's cut-off turns are `RestartContinuation`'s; this covers a provider
 * that stays connected and says nothing, and a connection that did not survive a pause.
 */
import {
  CommandId,
  MessageId,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2TurnItem,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import { forkParked } from "../serverActivation.ts";
import { stallMessage, type StallReason } from "./turnStall.ts";

export interface TurnLivenessOptions {
  /** How long a turn may say nothing while its model is the one being waited on. */
  readonly silenceMs: number;
  /** How long a turn gets to speak again after the machine was paused under it. */
  readonly resumeGraceMs: number;
  readonly maxAutoRetries: number;
}

export const DEFAULT_OPTIONS: TurnLivenessOptions = {
  silenceMs: 10 * 60_000,
  resumeGraceMs: 90_000,
  maxAutoRetries: 2,
};
const RETRY_DELAY_MS = 30_000;
const RETRY_BUDGET_EXPIRY_MS = 24 * 60 * 60_000;
/** Sweeps come every few seconds; one this late means the machine itself was paused. */
const SUSPEND_GAP_MS = 60_000;
const RECHECK_MS = 60_000;

const OPEN_ITEM_STATUSES = new Set<OrchestrationV2TurnItem["status"]>([
  "pending",
  "running",
  "waiting",
]);
const TOOL_ITEM_TYPES = new Set<OrchestrationV2TurnItem["type"]>([
  "command_execution",
  "file_change",
  "file_search",
  "web_search",
  "dynamic_tool",
  "subagent",
]);

type Shell = Pick<
  OrchestrationV2ThreadShell,
  | "activeRunId"
  | "activityRunStatus"
  | "pendingRuntimeRequest"
  | "pendingBackgroundTasks"
  | "archivedAt"
  | "deletedAt"
>;

/**
 * Whether a silent thread is waiting on its model. A person asked to approve or answer, a tool
 * still running and background work may all take as long as they take.
 */
export function waitsOnModel(
  shell: Shell,
  items: ReadonlyArray<Pick<OrchestrationV2TurnItem, "type" | "status">>,
): boolean {
  return (
    (shell.activityRunStatus === "starting" || shell.activityRunStatus === "running") &&
    shell.pendingRuntimeRequest === null &&
    (shell.pendingBackgroundTasks ?? []).length === 0 &&
    !items.some((item) => TOOL_ITEM_TYPES.has(item.type) && OPEN_ITEM_STATUSES.has(item.status))
  );
}

const readInt = (name: string, minimum: number) =>
  Config.Int(name).pipe(
    Config.option,
    Effect.map((value) =>
      value._tag === "Some" && value.value >= minimum ? value.value : undefined,
    ),
    Effect.orElseSucceed(() => undefined),
  );

const optionsFromEnv = Effect.gen(function* () {
  const stallSeconds = yield* readInt("T3CODE_TURN_STALL_SECONDS", 1);
  const graceSeconds = yield* readInt("T3CODE_TURN_RECOVERY_GRACE_SECONDS", 1);
  const retries = yield* readInt("T3CODE_TURN_AUTO_RETRIES", 0);
  const enabled = yield* Config.String("T3CODE_TURN_WATCHDOG").pipe(
    Config.withDefault("1"),
    Effect.orElseSucceed(() => "1"),
  );
  return {
    enabled: enabled !== "0",
    options: {
      silenceMs: stallSeconds === undefined ? DEFAULT_OPTIONS.silenceMs : stallSeconds * 1000,
      resumeGraceMs:
        graceSeconds === undefined ? DEFAULT_OPTIONS.resumeGraceMs : graceSeconds * 1000,
      maxAutoRetries: retries ?? DEFAULT_OPTIONS.maxAutoRetries,
    } satisfies TurnLivenessOptions,
  };
});

interface Watched {
  lastEventAtMs: number;
  /** The machine was paused under this thread; it is judged by the shorter grace. */
  resumed: boolean;
  /** A silent thread found waiting on a person or a tool is not read again before this. */
  recheckAtMs: number;
}

export const make = Effect.fn("TurnLivenessWatchdog.make")(function* (
  options: TurnLivenessOptions,
) {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const watched = new Map<ThreadId, Watched>();
  const retried = new Map<ThreadId, { attempts: number; lastAtMs: number }>();
  const retries = new Map<ThreadId, { runId: RunId; attempt: number; dueAtMs: number }>();
  let lastSweepAtMs: number | undefined;

  // Every persisted event of a thread is a sign of life, whatever it says.
  yield* forkParked(
    Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
      Clock.currentTimeMillis.pipe(
        Effect.map((nowMs) => {
          watched.set(event.threadId, { lastEventAtMs: nowMs, resumed: false, recheckAtMs: 0 });
          // A turn that finished its work earns the thread its retries back.
          if (event.type === "run.updated" && event.payload.status === "completed") {
            retried.delete(event.threadId);
          }
        }),
      ),
    ),
  );

  const dispatch = (
    command: Extract<OrchestrationV2Command, { type: "run.interrupt" | "message.dispatch" }>,
  ) =>
    threads.dispatch(command).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("managed turn liveness command was not taken", {
          threadId: command.threadId,
          type: command.type,
          cause,
        }),
      ),
    );

  const judge = Effect.fn("TurnLivenessWatchdog.judge")(function* (
    threadId: ThreadId,
    entry: Watched,
    nowMs: number,
  ) {
    const shell = yield* threads.getThreadShell(threadId);
    const runId = shell?.activeRunId ?? null;
    if (shell === null || runId === null || shell.deletedAt !== null) {
      watched.delete(threadId);
      return;
    }
    const { turnItems } = yield* threads.getThreadRecords(threadId, ["turnItems"], {
      turnItemRunIds: [runId],
    });
    if (!waitsOnModel(shell, turnItems)) {
      entry.recheckAtMs = nowMs + RECHECK_MS;
      return;
    }
    const reason: StallReason = entry.resumed ? "suspend-silence" : "model-silence";
    watched.delete(threadId);
    yield* dispatch({
      type: "run.interrupt",
      commandId: CommandId.make(`turn-liveness:stall:${runId}`),
      threadId,
      runId,
      reason: stallMessage(reason, nowMs - entry.lastEventAtMs),
    });
    const spent = retried.get(threadId);
    const attempts =
      spent === undefined || nowMs - spent.lastAtMs > RETRY_BUDGET_EXPIRY_MS ? 0 : spent.attempts;
    if (attempts >= options.maxAutoRetries) return;
    retries.set(threadId, { runId, attempt: attempts + 1, dueAtMs: nowMs + RETRY_DELAY_MS });
  });

  const retry = Effect.fn("TurnLivenessWatchdog.retry")(function* (
    threadId: ThreadId,
    pending: { readonly runId: RunId; readonly attempt: number },
    nowMs: number,
  ) {
    const shell = yield* threads.getThreadShell(threadId);
    // The stop is still landing: look again on the next sweep.
    if (shell !== null && shell.activeRunId === pending.runId) return;
    retries.delete(threadId);
    // Anyone who moved the thread on since (a new message, a stop, an archive) owns it now.
    if (
      shell === null ||
      shell.latestRunId !== pending.runId ||
      shell.status !== "interrupted" ||
      shell.activeRunId !== null ||
      shell.pendingRuntimeRequest !== null ||
      shell.archivedAt !== null ||
      shell.deletedAt !== null
    ) {
      return;
    }
    retried.set(threadId, { attempts: pending.attempt, lastAtMs: nowMs });
    const identity = `turn-liveness:retry:${pending.runId}:${pending.attempt}`;
    yield* dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(identity),
      messageId: MessageId.make(identity),
      threadId,
      manualContinuationOfRunId: pending.runId,
      text: "Continue where you left off.",
      attachments: [],
      dispatchMode: { type: "start_immediately" },
      createdBy: "agent",
      creationSource: "server",
    });
  });

  return Effect.fn("TurnLivenessWatchdog.sweep")(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    if (lastSweepAtMs !== undefined && nowMs - lastSweepAtMs > SUSPEND_GAP_MS) {
      // The silence was the machine's. Each turn gets a short while to show its provider is there.
      for (const entry of watched.values()) {
        entry.lastEventAtMs = nowMs;
        entry.resumed = true;
        entry.recheckAtMs = 0;
      }
    }
    lastSweepAtMs = nowMs;
    for (const [threadId, entry] of watched) {
      const limit = entry.resumed ? options.resumeGraceMs : options.silenceMs;
      if (nowMs - entry.lastEventAtMs >= limit && nowMs >= entry.recheckAtMs) {
        yield* judge(threadId, entry, nowMs);
      }
    }
    for (const [threadId, pending] of retries) {
      if (nowMs >= pending.dueAtMs) yield* retry(threadId, pending, nowMs);
    }
  });
});

/** Watches turns only on a managed workspace (`T3CODE_MANAGED_DEVPC`), unless switched off. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    if (!config.managedDevPc) return;
    const { enabled, options } = yield* optionsFromEnv;
    if (!enabled) return;
    const sweep = yield* make(options);
    const scheduler = yield* Scheduler.Scheduler;
    yield* scheduler.register("managed-turn-liveness", sweep());
  }),
);
