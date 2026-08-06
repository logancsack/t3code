/**
 * MuseAdapter — first-class T3 runtime adapter for `muse exec --json`.
 *
 * Muse currently exposes a process-per-turn headless protocol rather than a
 * long-lived RPC server. A durable Muse session UUID supplies continuation;
 * every T3 turn launches one scoped process against that UUID and translates
 * the JSONL stream into canonical provider runtime events.
 */

import {
  EventId,
  type MuseSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInteractionMode,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  RuntimeItemId,
  type RuntimeMode,
  ThreadId,
  type ToolLifecycleItemType,
  TurnId,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import type { MuseAdapterShape } from "../Services/MuseAdapter.ts";
import type { EventNdjsonLogger } from "./EventNdjsonLogger.ts";
import {
  filterMuseLaunchArgs,
  isMuseUserVisibleTaskKind,
  museOutputDelta,
  musePlanDelta,
  museReasoningDelta,
  museTaskLifecycle,
  museTerminalRecord,
  parseMuseJsonLine,
  type MuseJsonEvent,
  type MuseTerminalRecord,
} from "./MuseProtocol.ts";

const PROVIDER = ProviderDriverKind.make("muse");
const MUSE_RESUME_VERSION = 1 as const;
const DEFAULT_MUSE_MODEL = "muse-spark-1.2";
const DEFAULT_REASONING_EFFORT = "high";
const MAX_DIAGNOSTIC_CHARS = 16_000;
const decodeUnknownJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const MUSE_REASONING_EFFORTS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "ultra",
]);

interface MuseTurnSnapshot {
  readonly id: TurnId;
  readonly items: Array<unknown>;
}

interface MuseActiveRun {
  readonly turnId: TurnId;
  readonly cancelRequested: Deferred.Deferred<void>;
  readonly done: Deferred.Deferred<void>;
  child: ChildProcessSpawner.ChildProcessHandle | undefined;
  interrupted: boolean;
  phase: "open" | "settling" | "settled";
}

interface MuseSessionContext {
  session: ProviderSession;
  readonly museSessionId: string;
  readonly approvalPolicy: "untrusted" | "on-failure" | "on-request" | "never" | undefined;
  readonly sandboxMode: "read-only" | "workspace-write" | "danger-full-access" | undefined;
  readonly turns: Array<MuseTurnSnapshot>;
  activeRun: MuseActiveRun | undefined;
  stopped: boolean;
}

interface MuseTaskState {
  taskKind: string | undefined;
  operation: string | undefined;
  started: boolean;
  completed: boolean;
}

export interface MuseAdapterLiveOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
  readonly nativeEventLogger?: EventNdjsonLogger;
}

interface BuildMuseExecArgsInput {
  readonly sessionId: string;
  readonly cwd: string;
  readonly promptFile: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly runtimeMode: RuntimeMode;
  readonly approvalPolicy?: "untrusted" | "on-failure" | "on-request" | "never" | undefined;
  readonly sandboxMode?: "read-only" | "workspace-write" | "danger-full-access" | undefined;
  readonly interactionMode?: ProviderInteractionMode | undefined;
  readonly imagePaths: ReadonlyArray<string>;
  readonly launchArgs?: string | undefined;
}

export function buildMuseExecArgs(input: BuildMuseExecArgsInput): ReadonlyArray<string> {
  const args = [
    "exec",
    ...filterMuseLaunchArgs(input.launchArgs),
    "--json",
    "--provider",
    "meta",
    "--session-id",
    input.sessionId,
    "--workspace",
    input.cwd,
    "--prompt-file",
    input.promptFile,
    "--model",
    input.model,
    "--reasoning-effort",
    input.reasoningEffort,
    "--parallel-tool-calls",
  ];

  // RuntimeMode is the safety authority. Muse headless has no channel for
  // answering a mid-run approval prompt and otherwise waits forever after
  // emitting only to its retained session log. Plan and approval-required
  // therefore become sandboxed read-only runs; automatic modes retain Muse's
  // default sandbox but do not block on an unreachable prompt.
  const readOnly = input.interactionMode === "plan" || input.runtimeMode === "approval-required";
  if (input.runtimeMode === "full-access" && !readOnly) {
    args.push("--yolo");
  } else {
    args.push("--trust-workspace", "--disable-approval");
    if (readOnly) {
      args.push("--disable-write", "--disable-shell");
    }
  }
  for (const imagePath of input.imagePaths) {
    args.push("--image", imagePath);
  }
  return args;
}

function parseMuseResume(raw: unknown): { readonly sessionId: string } | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== MUSE_RESUME_VERSION) {
    return undefined;
  }
  if (typeof record.sessionId !== "string" || record.sessionId.trim().length === 0) {
    return undefined;
  }
  return { sessionId: record.sessionId.trim() };
}

function museResumeCursor(sessionId: string) {
  return { schemaVersion: MUSE_RESUME_VERSION, sessionId } as const;
}

function reasoningEffortFromTurn(input: ProviderSendTurnInput): string {
  const requested = getModelSelectionStringOptionValue(input.modelSelection, "reasoningEffort");
  return requested && MUSE_REASONING_EFFORTS.has(requested) ? requested : DEFAULT_REASONING_EFFORT;
}

function planPrompt(prompt: string): string {
  return [
    "Planning mode is active. Investigate as needed, then return a concrete implementation plan.",
    "Do not modify files or perform other state-changing actions.",
    "",
    prompt,
  ].join("\n");
}

function terminalState(
  terminal: MuseTerminalRecord | undefined,
  interrupted: boolean,
  exitCode: number,
): "completed" | "failed" | "interrupted" | "cancelled" {
  if (interrupted) {
    return "interrupted";
  }
  const value = terminal?.terminal.toLowerCase();
  if (value === "completed" || value === "success" || value === "succeeded") {
    return exitCode === 0 ? "completed" : "failed";
  }
  if (value === "interrupted") {
    return "interrupted";
  }
  if (value === "cancelled" || value === "canceled") {
    return "cancelled";
  }
  return "failed";
}

function toolItemType(taskKind: string): ToolLifecycleItemType {
  const normalized = taskKind.toLowerCase();
  if (
    normalized.includes("bash") ||
    normalized.includes("shell") ||
    normalized.includes("command")
  ) {
    return "command_execution";
  }
  if (normalized.includes("write") || normalized.includes("edit") || normalized.includes("patch")) {
    return "file_change";
  }
  if (normalized.includes("web") || normalized.includes("search")) {
    return "web_search";
  }
  if (normalized.includes("image")) {
    return "image_view";
  }
  if (normalized.includes("agent") || normalized.includes("workflow")) {
    return "collab_agent_tool_call";
  }
  if (normalized.includes("mcp")) {
    return "mcp_tool_call";
  }
  return "dynamic_tool_call";
}

function taskOutputDetail(event: MuseJsonEvent): string | undefined {
  const nested = event.payload.event;
  if (typeof nested !== "object" || nested === null || Array.isArray(nested)) {
    return undefined;
  }
  const chunk = (nested as Record<string, unknown>).chunk;
  if (typeof chunk !== "string" || chunk.trim().length === 0) {
    return undefined;
  }
  const parsed = Option.getOrUndefined(decodeUnknownJson(chunk));
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    for (const key of ["output", "description", "command"] as const) {
      if (typeof record[key] === "string" && record[key].trim().length > 0) {
        return record[key].slice(0, 4_000);
      }
    }
  }
  return chunk.slice(0, 4_000);
}

function appendDiagnostic(current: string, line: string): string {
  if (line.length === 0 || current.length >= MAX_DIAGNOSTIC_CHARS) {
    return current;
  }
  const next = current.length === 0 ? line : `${current}\n${line}`;
  return next.slice(0, MAX_DIAGNOSTIC_CHARS);
}

function suffixNotAlreadyEmitted(emitted: string, complete: string): string {
  if (complete.startsWith(emitted)) {
    return complete.slice(emitted.length);
  }
  return emitted.length === 0 ? complete : "";
}

export const makeMuseAdapter = Effect.fn("makeMuseAdapter")(function* (
  museSettings: MuseSettings,
  options?: MuseAdapterLiveOptions,
) {
  const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("muse");
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const crypto = yield* Crypto.Crypto;
  const serverConfig = yield* ServerConfig;
  const environment = {
    ...(options?.environment ?? process.env),
    MUSE_NO_AUTO_UPDATE: options?.environment?.MUSE_NO_AUTO_UPDATE ?? "1",
  } satisfies NodeJS.ProcessEnv;
  const sensitiveEnvironmentValues = Object.entries(environment).flatMap(([name, value]) =>
    value && value.length >= 4 && /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)
      ? [value]
      : [],
  );
  const redactDiagnostic = (value: string) =>
    sensitiveEnvironmentValues.reduce(
      (current, sensitive) => current.replaceAll(sensitive, "<redacted>"),
      value,
    );
  const sessions = new Map<ThreadId, MuseSessionContext>();
  const threadLocksRef = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());
  const eventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const nativeEventLogger = options?.nativeEventLogger;

  const randomUUIDv4 = crypto.randomUUIDv4.pipe(
    Effect.mapError(
      (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "crypto/randomUUIDv4",
          detail: "Failed to generate a Muse runtime identifier.",
          cause,
        }),
    ),
  );
  const eventStamp = () =>
    Effect.all({
      eventId: Effect.map(randomUUIDv4, EventId.make),
      createdAt: Effect.map(DateTime.now, DateTime.formatIso),
    });
  const emit = (event: ProviderRuntimeEvent) =>
    PubSub.publish(eventPubSub, event).pipe(Effect.asVoid);
  const eventBase = Effect.fn("MuseAdapter.eventBase")(function* (input: {
    readonly threadId: ThreadId;
    readonly turnId?: TurnId | undefined;
    readonly itemId?: RuntimeItemId | undefined;
    readonly rawEvent?: MuseJsonEvent | undefined;
  }) {
    return {
      ...(yield* eventStamp()),
      provider: PROVIDER,
      providerInstanceId: boundInstanceId,
      threadId: input.threadId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      ...(input.itemId ? { itemId: input.itemId } : {}),
      ...(input.rawEvent
        ? {
            raw: {
              source: "muse.exec.event" as const,
              messageType: input.rawEvent.payload_type,
              payload: input.rawEvent,
            },
          }
        : {}),
    };
  });

  const logNative = (threadId: ThreadId, event: unknown) =>
    nativeEventLogger
      ? DateTime.now.pipe(
          Effect.map(DateTime.formatIso),
          Effect.flatMap((observedAt) => nativeEventLogger.write({ observedAt, event }, threadId)),
        )
      : Effect.void;

  const requireSession = (
    threadId: ThreadId,
  ): Effect.Effect<MuseSessionContext, ProviderAdapterSessionNotFoundError> => {
    const context = sessions.get(threadId);
    return context && !context.stopped
      ? Effect.succeed(context)
      : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
  };

  const getThreadSemaphore = (threadId: string) =>
    SynchronizedRef.modifyEffect(threadLocksRef, (current) => {
      const existing = Option.fromNullishOr(current.get(threadId));
      return Option.match(existing, {
        onNone: () =>
          Semaphore.make(1).pipe(
            Effect.map((semaphore) => {
              const next = new Map(current);
              next.set(threadId, semaphore);
              return [semaphore, next] as const;
            }),
          ),
        onSome: (semaphore) => Effect.succeed([semaphore, current] as const),
      });
    });
  const withThreadLock = <A, E, R>(threadId: string, effect: Effect.Effect<A, E, R>) =>
    Effect.flatMap(getThreadSemaphore(threadId), (semaphore) => semaphore.withPermit(effect));

  const stopContext = (context: MuseSessionContext) =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        if (context.stopped) return;
        context.stopped = true;
        const activeRun = context.activeRun;
        if (activeRun) {
          if (activeRun.phase === "open") {
            activeRun.interrupted = true;
            yield* Deferred.succeed(activeRun.cancelRequested, undefined).pipe(Effect.ignore);
          }
          if (activeRun.child) {
            yield* activeRun.child.kill({ forceKillAfter: 2_000 }).pipe(Effect.ignore);
          }
          // The send fiber exclusively owns terminal event settlement. Waiting
          // here guarantees session.exited is always the final event.
          yield* Deferred.await(activeRun.done);
        }
        if (sessions.get(context.session.threadId) === context) {
          sessions.delete(context.session.threadId);
        }
        yield* emit({
          ...(yield* eventBase({ threadId: context.session.threadId })),
          type: "session.exited",
          payload: { exitKind: "graceful" },
        });
      }),
    );

  const startSessionUnlocked: MuseAdapterShape["startSession"] = (input) =>
    Effect.gen(function* () {
      if (input.provider !== undefined && input.provider !== PROVIDER) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
        });
      }
      if (input.providerInstanceId !== undefined && input.providerInstanceId !== boundInstanceId) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: `Expected provider instance '${boundInstanceId}' but received '${input.providerInstanceId}'.`,
        });
      }
      if (!input.cwd?.trim()) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: "cwd is required and must be non-empty.",
        });
      }
      if (
        input.modelSelection !== undefined &&
        input.modelSelection.instanceId !== boundInstanceId
      ) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: `Muse model selection is bound to instance '${input.modelSelection.instanceId}', expected '${boundInstanceId}'.`,
        });
      }

      const existing = sessions.get(input.threadId);
      if (existing) {
        yield* stopContext(existing);
      }
      const museSessionId = parseMuseResume(input.resumeCursor)?.sessionId ?? (yield* randomUUIDv4);
      const now = DateTime.formatIso(yield* DateTime.now);
      const cwd = path.resolve(input.cwd.trim());
      const session: ProviderSession = {
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        status: "ready",
        runtimeMode: input.runtimeMode,
        cwd,
        model: input.modelSelection?.model ?? DEFAULT_MUSE_MODEL,
        threadId: input.threadId,
        resumeCursor: museResumeCursor(museSessionId),
        createdAt: now,
        updatedAt: now,
      };
      sessions.set(input.threadId, {
        session,
        museSessionId,
        approvalPolicy: input.approvalPolicy,
        sandboxMode: input.sandboxMode,
        turns: [],
        activeRun: undefined,
        stopped: false,
      });

      yield* emit({
        ...(yield* eventBase({ threadId: input.threadId })),
        type: "session.started",
        payload: {
          message: "Muse Code session ready",
          resume: museResumeCursor(museSessionId),
        },
      });
      yield* emit({
        ...(yield* eventBase({ threadId: input.threadId })),
        type: "session.state.changed",
        payload: { state: "ready", reason: "Muse Code session ready" },
      });
      yield* emit({
        ...(yield* eventBase({ threadId: input.threadId })),
        type: "thread.started",
        payload: { providerThreadId: museSessionId },
      });
      return session;
    });

  const startSession: MuseAdapterShape["startSession"] = (input) =>
    withThreadLock(input.threadId, startSessionUnlocked(input));

  const sendTurnUnlocked: MuseAdapterShape["sendTurn"] = Effect.fn("MuseAdapter.sendTurn")(
    function* (input) {
      const context = yield* requireSession(input.threadId);
      if (context.activeRun) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "exec",
          detail:
            "Muse Code cannot accept a steering message while its headless turn is running. Interrupt the turn and send the message again.",
        });
      }
      if (
        input.modelSelection !== undefined &&
        input.modelSelection.instanceId !== boundInstanceId
      ) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: `Muse model selection is bound to instance '${input.modelSelection.instanceId}', expected '${boundInstanceId}'.`,
        });
      }

      const text = input.input?.trim() ?? "";
      if (text.length === 0 && (input.attachments?.length ?? 0) === 0) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "Muse turns require text input or at least one attachment.",
        });
      }

      const imagePaths: Array<string> = [];
      const fileDescriptions: Array<string> = [];
      for (const attachment of input.attachments ?? []) {
        const attachmentPath = resolveAttachmentPath({
          attachmentsDir: serverConfig.attachmentsDir,
          attachment,
        });
        if (!attachmentPath) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "exec",
            detail: `Invalid attachment id '${attachment.id}'.`,
          });
        }
        if (attachment.type === "image") {
          imagePaths.push(attachmentPath);
        } else {
          const safeName = attachment.name.replaceAll("\r", " ").replaceAll("\n", " ");
          fileDescriptions.push(`The user attached file "${safeName}" at path: ${attachmentPath}`);
        }
      }

      const basePrompt = [
        text || (imagePaths.length > 0 ? "Please analyze the attached image." : ""),
        ...fileDescriptions,
      ]
        .filter((part) => part.length > 0)
        .join("\n\n");
      const prompt = input.interactionMode === "plan" ? planPrompt(basePrompt) : basePrompt;
      const turnId = TurnId.make(`muse-turn-${yield* randomUUIDv4}`);
      const model = input.modelSelection?.model ?? context.session.model ?? DEFAULT_MUSE_MODEL;
      const reasoningEffort = reasoningEffortFromTurn(input);
      const startedAt = DateTime.formatIso(yield* DateTime.now);
      const turn: MuseTurnSnapshot = {
        id: turnId,
        items: [{ role: "user", text: basePrompt, attachments: input.attachments ?? [] }],
      };
      const assistantItemId = RuntimeItemId.make(`muse-assistant-${turnId}`);
      const reasoningItemId = RuntimeItemId.make(`muse-reasoning-${turnId}`);
      let assistantStarted = false;
      let reasoningStarted = false;
      let assistantText = "";
      let reasoningText = "";
      let planText = "";
      let terminal: MuseTerminalRecord | undefined;
      let diagnostics = "";
      const tasks = new Map<string, MuseTaskState>();
      const cancelRequested = yield* Deferred.make<void>();
      const done = yield* Deferred.make<void>();
      const activeRun: MuseActiveRun = {
        turnId,
        cancelRequested,
        done,
        child: undefined,
        interrupted: false,
        phase: "open",
      };

      const ensureItemStarted = Effect.fn("MuseAdapter.ensureItemStarted")(function* (
        itemId: RuntimeItemId,
        itemType: "assistant_message" | "reasoning",
        rawEvent: MuseJsonEvent,
      ) {
        yield* emit({
          ...(yield* eventBase({ threadId: input.threadId, turnId, itemId, rawEvent })),
          type: "item.started",
          payload: { itemType, status: "inProgress" },
        });
      });

      const handleTaskLifecycle = Effect.fn("MuseAdapter.handleTaskLifecycle")(function* (
        event: MuseJsonEvent,
      ) {
        const lifecycle = museTaskLifecycle(event);
        if (!lifecycle) return;
        const current = tasks.get(lifecycle.taskId) ?? {
          taskKind: undefined,
          operation: undefined,
          started: false,
          completed: false,
        };
        if (lifecycle.taskKind) current.taskKind = lifecycle.taskKind;
        if (lifecycle.operation) current.operation = lifecycle.operation;
        tasks.set(lifecycle.taskId, current);
        const taskKind = current.taskKind ?? current.operation;
        if (!taskKind || !isMuseUserVisibleTaskKind(taskKind)) return;
        const itemId = RuntimeItemId.make(`muse-task-${lifecycle.taskId}`);
        const itemType = toolItemType(taskKind);
        const title = current.operation ?? current.taskKind ?? "Muse tool";

        if (lifecycle.lifecycle === "started" && !current.started) {
          current.started = true;
          yield* emit({
            ...(yield* eventBase({ threadId: input.threadId, turnId, itemId, rawEvent: event })),
            type: "item.started",
            payload: { itemType, status: "inProgress", title, data: event.payload },
          });
          return;
        }
        if (lifecycle.lifecycle === "output") {
          if (!current.started) {
            current.started = true;
            yield* emit({
              ...(yield* eventBase({ threadId: input.threadId, turnId, itemId, rawEvent: event })),
              type: "item.started",
              payload: { itemType, status: "inProgress", title, data: event.payload },
            });
          }
          const detail = taskOutputDetail(event);
          yield* emit({
            ...(yield* eventBase({ threadId: input.threadId, turnId, itemId, rawEvent: event })),
            type: "item.updated",
            payload: {
              itemType,
              status: "inProgress",
              title,
              ...(detail ? { detail } : {}),
              data: event.payload,
            },
          });
          return;
        }
        if (
          (lifecycle.lifecycle === "completed" ||
            lifecycle.lifecycle === "failed" ||
            lifecycle.lifecycle === "cancelled" ||
            lifecycle.lifecycle === "timed_out") &&
          !current.completed
        ) {
          if (!current.started) {
            current.started = true;
            yield* emit({
              ...(yield* eventBase({ threadId: input.threadId, turnId, itemId, rawEvent: event })),
              type: "item.started",
              payload: { itemType, status: "inProgress", title, data: event.payload },
            });
          }
          current.completed = true;
          yield* emit({
            ...(yield* eventBase({ threadId: input.threadId, turnId, itemId, rawEvent: event })),
            type: "item.completed",
            payload: {
              itemType,
              status: lifecycle.lifecycle === "completed" ? "completed" : "failed",
              title,
              ...(lifecycle.reason
                ? { detail: lifecycle.reason }
                : lifecycle.lifecycle === "timed_out"
                  ? { detail: "Muse tool timed out." }
                  : {}),
              data: event.payload,
            },
          });
        }
      });

      const settleOpenTasks = Effect.fn("MuseAdapter.settleOpenTasks")(function* (
        state: "completed" | "failed" | "interrupted" | "cancelled",
        detail?: string,
      ) {
        for (const [taskId, task] of tasks) {
          if (!task.started || task.completed) continue;
          task.completed = true;
          const taskKind = task.taskKind ?? task.operation ?? "Muse tool";
          yield* emit({
            ...(yield* eventBase({
              threadId: input.threadId,
              turnId,
              itemId: RuntimeItemId.make(`muse-task-${taskId}`),
            })),
            type: "item.completed",
            payload: {
              itemType: toolItemType(taskKind),
              status: state === "completed" ? "completed" : "failed",
              title: task.operation ?? task.taskKind ?? "Muse tool",
              ...(detail ? { detail } : {}),
            },
          });
        }
      });

      const settleRun = <E, R>(
        body: (interrupted: boolean) => Effect.Effect<void, E, R>,
      ): Effect.Effect<void, E, R> =>
        Effect.uninterruptible(
          Effect.suspend(() => {
            if (activeRun.phase !== "open") {
              return Deferred.await(activeRun.done);
            }

            // This synchronous transition is the turn's linearization point.
            // A stop that wins first sets interrupted while the run is open; a
            // stop after this point waits for this owner and cannot replace its
            // terminal outcome.
            activeRun.phase = "settling";
            const interrupted = activeRun.interrupted;
            let settlementCompleted = false;

            return body(interrupted).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  settlementCompleted = true;
                }),
              ),
              Effect.ensuring(
                Effect.gen(function* () {
                  if (context.activeRun === activeRun) {
                    context.activeRun = undefined;
                  }
                  const { activeTurnId: _activeTurnId, ...sessionWithoutActiveTurn } =
                    context.session;
                  context.session = settlementCompleted
                    ? sessionWithoutActiveTurn
                    : {
                        ...sessionWithoutActiveTurn,
                        status: "error",
                        lastError: "Muse Code turn settlement failed.",
                        updatedAt: DateTime.formatIso(yield* DateTime.now),
                      };
                  activeRun.phase = "settled";
                  yield* Deferred.succeed(activeRun.done, undefined).pipe(Effect.ignore);
                }),
              ),
            );
          }),
        );

      const finalizeAbandonedRun = () =>
        settleRun((interrupted) =>
          Effect.gen(function* () {
            if (activeRun.child) {
              yield* activeRun.child.kill({ forceKillAfter: 2_000 }).pipe(Effect.ignore);
            }

            const state = interrupted ? "interrupted" : "failed";
            const errorMessage = interrupted
              ? "Muse Code turn was interrupted."
              : "Muse Code turn ended unexpectedly.";
            yield* settleOpenTasks(state, errorMessage);
            if (reasoningStarted) {
              yield* emit({
                ...(yield* eventBase({
                  threadId: input.threadId,
                  turnId,
                  itemId: reasoningItemId,
                })),
                type: "item.completed",
                payload: { itemType: "reasoning", status: "failed" },
              });
            }
            if (assistantStarted) {
              yield* emit({
                ...(yield* eventBase({
                  threadId: input.threadId,
                  turnId,
                  itemId: assistantItemId,
                })),
                type: "item.completed",
                payload: { itemType: "assistant_message", status: "failed" },
              });
            }
            if (!interrupted) {
              yield* emit({
                ...(yield* eventBase({ threadId: input.threadId, turnId })),
                type: "runtime.error",
                payload: { message: errorMessage, class: "provider_error" },
              });
            }
            yield* emit({
              ...(yield* eventBase({ threadId: input.threadId, turnId })),
              type: "turn.completed",
              payload: {
                state,
                stopReason: interrupted ? "interrupted" : null,
                ...(!interrupted ? { errorMessage } : {}),
              },
            });
            turn.items.push({
              role: input.interactionMode === "plan" ? "plan" : "assistant",
              text: input.interactionMode === "plan" ? planText : assistantText,
              reasoning: reasoningText,
              state,
            });
            if (!context.stopped) {
              const { activeTurnId: _activeTurnId, ...settledSession } = context.session;
              context.session = {
                ...settledSession,
                status: state === "failed" ? "error" : "ready",
                updatedAt: DateTime.formatIso(yield* DateTime.now),
                ...(state === "failed" ? { lastError: errorMessage } : { lastError: undefined }),
              };
              yield* emit({
                ...(yield* eventBase({ threadId: input.threadId, turnId })),
                type: "session.state.changed",
                payload:
                  state === "failed"
                    ? { state: "error", reason: errorMessage }
                    : { state: "ready", reason: "Muse Code turn interrupted" },
              });
            }
          }),
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Failed to settle an abandoned Muse Code turn.", { cause }),
          ),
        );

      // All potentially yielding preparation is complete. Publish ownership
      // synchronously so stopSession either sees this run or wins before it.
      if (context.stopped || sessions.get(input.threadId) !== context) {
        return yield* new ProviderAdapterSessionNotFoundError({
          provider: PROVIDER,
          threadId: input.threadId,
        });
      }
      context.activeRun = activeRun;
      context.session = {
        ...context.session,
        status: "running",
        activeTurnId: turnId,
        model,
        updatedAt: startedAt,
        lastError: undefined,
      };
      context.turns.push(turn);

      return yield* Effect.gen(function* () {
        yield* emit({
          ...(yield* eventBase({ threadId: input.threadId, turnId })),
          type: "turn.started",
          payload: { model, effort: reasoningEffort },
        });
        yield* emit({
          ...(yield* eventBase({ threadId: input.threadId, turnId })),
          type: "session.state.changed",
          payload: { state: "running", reason: "Muse Code turn started" },
        });
        if (context.session.runtimeMode === "approval-required") {
          yield* emit({
            ...(yield* eventBase({ threadId: input.threadId, turnId })),
            type: "runtime.warning",
            payload: {
              message:
                "Muse Code headless mode cannot relay interactive approvals, so this approval-required turn is read-only. Use Auto or Full Access to allow changes.",
            },
          });
        }

        const handleEventUnlocked = Effect.fn("MuseAdapter.handleEvent")(function* (
          event: MuseJsonEvent,
        ) {
          if (context.stopped) return;
          yield* logNative(input.threadId, event);
          const task = museTaskLifecycle(event);
          if (task) {
            yield* handleTaskLifecycle(event);
          }

          const reasoningDelta = museReasoningDelta(event);
          if (reasoningDelta !== undefined && reasoningDelta.length > 0) {
            if (!reasoningStarted) {
              reasoningStarted = true;
              yield* ensureItemStarted(reasoningItemId, "reasoning", event);
            }
            reasoningText += reasoningDelta;
            yield* emit({
              ...(yield* eventBase({
                threadId: input.threadId,
                turnId,
                itemId: reasoningItemId,
                rawEvent: event,
              })),
              type: "content.delta",
              payload: { streamKind: "reasoning_text", delta: reasoningDelta },
            });
          }

          const nativePlanDelta = musePlanDelta(event);
          const outputDelta = museOutputDelta(event);
          const proposedDelta =
            nativePlanDelta ?? (input.interactionMode === "plan" ? outputDelta : undefined);
          if (proposedDelta !== undefined && proposedDelta.length > 0) {
            planText += proposedDelta;
            yield* emit({
              ...(yield* eventBase({ threadId: input.threadId, turnId, rawEvent: event })),
              type: "turn.proposed.delta",
              payload: { delta: proposedDelta },
            });
          } else if (outputDelta !== undefined && outputDelta.length > 0) {
            if (!assistantStarted) {
              assistantStarted = true;
              yield* ensureItemStarted(assistantItemId, "assistant_message", event);
            }
            assistantText += outputDelta;
            yield* emit({
              ...(yield* eventBase({
                threadId: input.threadId,
                turnId,
                itemId: assistantItemId,
                rawEvent: event,
              })),
              type: "content.delta",
              payload: { streamKind: "assistant_text", delta: outputDelta },
            });
          }

          terminal = museTerminalRecord(event) ?? terminal;
        });
        const handleEvent = (event: MuseJsonEvent) =>
          Effect.uninterruptible(handleEventUnlocked(event));

        const runProcess = Effect.gen(function* () {
          const promptFile = yield* fileSystem.makeTempFileScoped({
            prefix: "t3-muse-prompt-",
            suffix: ".md",
          });
          yield* fileSystem.writeFileString(promptFile, prompt);
          const args = buildMuseExecArgs({
            sessionId: context.museSessionId,
            cwd: context.session.cwd ?? process.cwd(),
            promptFile,
            model,
            reasoningEffort,
            runtimeMode: context.session.runtimeMode,
            approvalPolicy: context.approvalPolicy,
            sandboxMode: context.sandboxMode,
            interactionMode: input.interactionMode,
            imagePaths,
            launchArgs: museSettings.launchArgs,
          });
          const binaryPath = museSettings.binaryPath || "muse";
          const resolved = yield* resolveSpawnCommand(binaryPath, args, { env: environment }).pipe(
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.provideService(Path.Path, path),
          );
          if (yield* Deferred.isDone(activeRun.cancelRequested)) {
            return yield* Effect.interrupt;
          }
          const child = yield* spawner.spawn(
            ChildProcess.make(resolved.command, resolved.args, {
              cwd: context.session.cwd,
              env: environment,
              shell: resolved.shell,
              stdin: "ignore",
              stdout: "pipe",
              stderr: "pipe",
              forceKillAfter: 2_000,
            }),
          );
          activeRun.child = child;
          if (activeRun.interrupted || context.stopped) {
            yield* child.kill({ forceKillAfter: 2_000 }).pipe(Effect.ignore);
          }

          const stdoutDrain = child.stdout.pipe(
            Stream.decodeText(),
            Stream.splitLines,
            Stream.runForEach((line) => {
              const parsed = parseMuseJsonLine(line);
              if (parsed.kind === "event") {
                return handleEvent(parsed.event);
              }
              const safeText = redactDiagnostic(parsed.text);
              diagnostics = appendDiagnostic(diagnostics, safeText);
              return parsed.text.length > 0
                ? logNative(input.threadId, { kind: "stdout-diagnostic", text: safeText })
                : Effect.void;
            }),
          );
          const stderrDrain = child.stderr.pipe(
            Stream.decodeText(),
            Stream.splitLines,
            Stream.runForEach((line) => {
              const safeLine = redactDiagnostic(line);
              diagnostics = appendDiagnostic(diagnostics, safeLine);
              return line.trim().length > 0
                ? logNative(input.threadId, { kind: "stderr", text: safeLine })
                : Effect.void;
            }),
          );
          const [, , exitCode] = yield* Effect.all(
            [stdoutDrain, stderrDrain, child.exitCode.pipe(Effect.map(Number))],
            { concurrency: "unbounded" },
          );
          return exitCode;
        }).pipe(
          Effect.scoped,
          Effect.mapError(
            (cause) =>
              new ProviderAdapterProcessError({
                provider: PROVIDER,
                threadId: input.threadId,
                detail: cause.message ?? "Muse Code process failed.",
                cause,
              }),
          ),
        );
        const runOutcome = yield* Deferred.isDone(activeRun.cancelRequested).pipe(
          Effect.flatMap((cancelledBeforeLaunch) =>
            cancelledBeforeLaunch
              ? Effect.succeed({ _tag: "Cancelled" } as const)
              : Effect.raceFirst(
                  runProcess.pipe(
                    Effect.result,
                    Effect.map((result) => ({ _tag: "Process" as const, result })),
                  ),
                  Deferred.await(activeRun.cancelRequested).pipe(
                    Effect.as({ _tag: "Cancelled" } as const),
                  ),
                ),
          ),
        );
        const runExitCode =
          runOutcome._tag === "Cancelled"
            ? 130
            : Result.match(runOutcome.result, {
                onFailure: (failure) => {
                  diagnostics = appendDiagnostic(diagnostics, redactDiagnostic(failure.message));
                  return 1;
                },
                onSuccess: (exitCode) => exitCode,
              });

        yield* settleRun((interrupted) =>
          Effect.gen(function* () {
            const state = terminalState(terminal, interrupted, runExitCode);
            const terminalText = terminal?.text ?? "";
            if (input.interactionMode === "plan") {
              const missingPlanSuffix = suffixNotAlreadyEmitted(planText, terminalText);
              if (missingPlanSuffix.length > 0) {
                planText += missingPlanSuffix;
                yield* emit({
                  ...(yield* eventBase({ threadId: input.threadId, turnId })),
                  type: "turn.proposed.delta",
                  payload: { delta: missingPlanSuffix },
                });
              }
              if (state === "completed" && planText.trim().length > 0) {
                yield* emit({
                  ...(yield* eventBase({ threadId: input.threadId, turnId })),
                  type: "turn.proposed.completed",
                  payload: { planMarkdown: planText.trim() },
                });
              }
            } else {
              const missingAssistantSuffix = suffixNotAlreadyEmitted(assistantText, terminalText);
              if (missingAssistantSuffix.length > 0) {
                if (!assistantStarted) {
                  assistantStarted = true;
                  yield* emit({
                    ...(yield* eventBase({
                      threadId: input.threadId,
                      turnId,
                      itemId: assistantItemId,
                    })),
                    type: "item.started",
                    payload: { itemType: "assistant_message", status: "inProgress" },
                  });
                }
                assistantText += missingAssistantSuffix;
                yield* emit({
                  ...(yield* eventBase({
                    threadId: input.threadId,
                    turnId,
                    itemId: assistantItemId,
                  })),
                  type: "content.delta",
                  payload: { streamKind: "assistant_text", delta: missingAssistantSuffix },
                });
              }
            }

            const errorMessage =
              terminal?.reason ??
              (state === "failed"
                ? diagnostics.trim() || `Muse Code exited with status ${runExitCode}.`
                : undefined);
            const unsettledItemDetail =
              state === "interrupted"
                ? "Muse Code turn was interrupted."
                : state === "cancelled"
                  ? "Muse Code turn was cancelled."
                  : errorMessage;
            yield* settleOpenTasks(state, unsettledItemDetail);

            if (reasoningStarted) {
              yield* emit({
                ...(yield* eventBase({
                  threadId: input.threadId,
                  turnId,
                  itemId: reasoningItemId,
                })),
                type: "item.completed",
                payload: {
                  itemType: "reasoning",
                  status: state === "completed" ? "completed" : "failed",
                },
              });
            }
            if (assistantStarted) {
              yield* emit({
                ...(yield* eventBase({
                  threadId: input.threadId,
                  turnId,
                  itemId: assistantItemId,
                })),
                type: "item.completed",
                payload: {
                  itemType: "assistant_message",
                  status: state === "completed" ? "completed" : "failed",
                },
              });
            }

            if (state === "failed" && errorMessage) {
              yield* emit({
                ...(yield* eventBase({ threadId: input.threadId, turnId })),
                type: "runtime.error",
                payload: { message: errorMessage, class: "provider_error" },
              });
            }
            yield* emit({
              ...(yield* eventBase({ threadId: input.threadId, turnId })),
              type: "turn.completed",
              payload: {
                state,
                stopReason: terminal?.reason ?? terminal?.terminal ?? null,
                ...(errorMessage ? { errorMessage } : {}),
              },
            });

            turn.items.push({
              role: input.interactionMode === "plan" ? "plan" : "assistant",
              text: input.interactionMode === "plan" ? planText : assistantText,
              reasoning: reasoningText,
              state,
            });
            if (!context.stopped) {
              context.session = {
                ...context.session,
                status: state === "failed" ? "error" : "ready",
                activeTurnId: undefined,
                updatedAt: DateTime.formatIso(yield* DateTime.now),
                ...(errorMessage ? { lastError: errorMessage } : { lastError: undefined }),
              };
              yield* emit({
                ...(yield* eventBase({ threadId: input.threadId, turnId })),
                type: "session.state.changed",
                payload:
                  state === "failed"
                    ? { state: "error", reason: errorMessage ?? "Muse Code turn failed" }
                    : { state: "ready", reason: "Muse Code turn finished" },
              });
            }
          }),
        );

        if (context.stopped) {
          return yield* new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId: input.threadId,
          });
        }

        return {
          threadId: input.threadId,
          turnId,
          resumeCursor: museResumeCursor(context.museSessionId),
        };
      }).pipe(Effect.ensuring(finalizeAbandonedRun()));
    },
  );

  // Muse has no external steering endpoint. Serializing turns gives a message
  // sent during a run deterministic queued-follow-up semantics, without ever
  // running two processes against the same durable Muse log concurrently.
  const sendTurn: MuseAdapterShape["sendTurn"] = (input) =>
    withThreadLock(input.threadId, sendTurnUnlocked(input));

  const interruptTurn: MuseAdapterShape["interruptTurn"] = (threadId, turnId) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      const active = context.activeRun;
      if (!active || (turnId !== undefined && active.turnId !== turnId)) return;
      if (active.phase !== "open") return;
      active.interrupted = true;
      yield* Deferred.succeed(active.cancelRequested, undefined).pipe(Effect.ignore);
      if (active.child) {
        yield* active.child.kill({ forceKillAfter: 2_000 }).pipe(Effect.ignore);
      }
    });

  const respondToRequest: MuseAdapterShape["respondToRequest"] = (
    _threadId,
    _requestId,
    _decision,
  ) =>
    Effect.fail(
      new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "respondToRequest",
        detail: "Muse Code headless mode does not expose interactive approval responses.",
      }),
    );

  const respondToUserInput: MuseAdapterShape["respondToUserInput"] = (
    _threadId,
    _requestId,
    _answers,
  ) =>
    Effect.fail(
      new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "respondToUserInput",
        detail: "Muse Code headless mode does not expose structured user-input prompts.",
      }),
    );

  const readThread: MuseAdapterShape["readThread"] = (threadId) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      return { threadId, turns: context.turns };
    });

  const rollbackThread: MuseAdapterShape["rollbackThread"] = (threadId, numTurns) =>
    Effect.gen(function* () {
      yield* requireSession(threadId);
      if (!Number.isInteger(numTurns) || numTurns < 1) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "rollbackThread",
          issue: "numTurns must be an integer >= 1.",
        });
      }
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "rollbackThread",
        detail: "Muse Code does not currently expose durable session rollback in headless mode.",
      });
    });

  const stopSession: MuseAdapterShape["stopSession"] = (threadId) =>
    Effect.flatMap(requireSession(threadId), stopContext);
  const listSessions: MuseAdapterShape["listSessions"] = () =>
    Effect.sync(() => Array.from(sessions.values(), ({ session }) => ({ ...session })));
  const hasSession: MuseAdapterShape["hasSession"] = (threadId) =>
    Effect.sync(() => {
      const context = sessions.get(threadId);
      return context !== undefined && !context.stopped;
    });
  const stopAll: MuseAdapterShape["stopAll"] = () =>
    Effect.forEach(sessions.values(), stopContext, { discard: true });

  yield* Effect.addFinalizer(() =>
    stopAll().pipe(
      Effect.tap(() => PubSub.shutdown(eventPubSub)),
      Effect.catch((cause) => Effect.logWarning("Failed to stop Muse sessions.", { cause })),
    ),
  );

  return {
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: "in-session" },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    stopAll,
    streamEvents: Stream.fromPubSub(eventPubSub),
  } satisfies MuseAdapterShape;
});
