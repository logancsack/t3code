import * as NodeOS from "node:os";
import {
  EventId,
  type PrimeSettings,
  type ProviderRuntimeEvent,
  type ProviderSession,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeItemId,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpSchema from "effect-acp/schema";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { mapAcpToAdapterError } from "../acp/AcpAdapterSupport.ts";
import type * as AcpSessionRuntime from "../acp/AcpSessionRuntime.ts";
import {
  makeAcpAssistantItemEvent,
  makeAcpContentDeltaEvent,
  makeAcpPlanUpdatedEvent,
  makeAcpToolCallEvent,
} from "../acp/AcpCoreRuntimeEvents.ts";
import { makeAcpNativeLoggerFactory } from "../acp/AcpNativeLogging.ts";
import {
  makePrimeAcpRuntime,
  makePrimeResumeCursor,
  makePrimeSessionKey,
  parsePrimeModelSlug,
  parsePrimeResumeCursor,
  resolvePrimeAgentDirectory,
  resolvePrimeSessionDirectory,
} from "../acp/PrimeAcpSupport.ts";
import {
  clearPrimeAgentSessionActivity,
  parsePrimeAgentSessionMetadata,
  updatePrimeAgentSubagentActivity,
} from "../PrimeAgentActivity.ts";
import type { PrimeAdapterShape } from "../Services/PrimeAdapter.ts";
import type { EventNdjsonLogger } from "./EventNdjsonLogger.ts";

const PROVIDER = ProviderDriverKind.make("primeAgent");

export interface PrimeAdapterLiveOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly nativeEventLogger?: EventNdjsonLogger;
  readonly instanceId?: ProviderInstanceId;
}

interface PrimeSessionContext {
  readonly threadId: ThreadId;
  readonly activityKey: string;
  readonly acpSessionId: string;
  readonly scope: Scope.Closeable;
  readonly acp: AcpSessionRuntime.AcpSessionRuntime["Service"];
  session: ProviderSession;
  notificationFiber: Fiber.Fiber<void, never> | undefined;
  processFiber: Fiber.Fiber<void, never> | undefined;
  turns: Array<{ id: TurnId; items: Array<unknown> }>;
  activeTurnId: TurnId | undefined;
  reasoningItemId: RuntimeItemId | undefined;
  reasoningStarted: boolean;
  promptActive: boolean;
  interrupted: boolean;
  stopped: boolean;
}

function modelForInstance(
  instanceId: ProviderInstanceId,
  selection: { readonly instanceId: ProviderInstanceId; readonly model: string } | undefined,
  fallback?: string,
): string {
  return selection?.instanceId === instanceId
    ? selection.model.trim() || "auto"
    : (fallback ?? "auto");
}

export const makePrimeAdapter = Effect.fn("makePrimeAdapter")(function* (
  primeSettings: PrimeSettings,
  options?: PrimeAdapterLiveOptions,
) {
  const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("primeAgent");
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const serverConfig = yield* ServerConfig;
  const crypto = yield* Crypto.Crypto;
  const makeAcpNativeLoggers = yield* makeAcpNativeLoggerFactory();
  const sessions = new Map<ThreadId, PrimeSessionContext>();
  const locksRef = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());
  const runtimeEvents = yield* PubSub.unbounded<ProviderRuntimeEvent>();

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const randomUUIDv4 = crypto.randomUUIDv4.pipe(
    Effect.mapError(
      (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "crypto/randomUUIDv4",
          detail: "Failed to generate a Prime Agent runtime identifier.",
          cause,
        }),
    ),
  );
  const eventStamp = () =>
    Effect.all({
      eventId: Effect.map(randomUUIDv4, EventId.make),
      createdAt: nowIso,
    });
  const emit = (event: ProviderRuntimeEvent) =>
    PubSub.publish(runtimeEvents, event).pipe(Effect.asVoid);

  const getSemaphore = (threadId: string) =>
    SynchronizedRef.modifyEffect(locksRef, (current) => {
      const existing = current.get(threadId);
      if (existing) return Effect.succeed([existing, current] as const);
      return Semaphore.make(1).pipe(
        Effect.map((semaphore) => {
          const next = new Map(current);
          next.set(threadId, semaphore);
          return [semaphore, next] as const;
        }),
      );
    });
  const withThreadLock = <A, E, R>(threadId: string, effect: Effect.Effect<A, E, R>) =>
    Effect.flatMap(getSemaphore(threadId), (semaphore) => semaphore.withPermit(effect));

  const requireSession = (
    threadId: ThreadId,
  ): Effect.Effect<PrimeSessionContext, ProviderAdapterSessionNotFoundError> => {
    const context = sessions.get(threadId);
    return context && !context.stopped
      ? Effect.succeed(context)
      : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
  };

  const emitReasoningCompletion = Effect.fn("PrimeAdapter.emitReasoningCompletion")(function* (
    context: PrimeSessionContext,
    state: "completed" | "failed",
  ) {
    if (!context.reasoningStarted || !context.reasoningItemId || !context.activeTurnId) return;
    yield* emit({
      type: "item.completed",
      ...(yield* eventStamp()),
      provider: PROVIDER,
      threadId: context.threadId,
      turnId: context.activeTurnId,
      itemId: context.reasoningItemId,
      payload: { itemType: "reasoning", status: state },
    });
    context.reasoningStarted = false;
    context.reasoningItemId = undefined;
  });

  const stopSessionInternal = Effect.fn("PrimeAdapter.stopSessionInternal")(function* (
    context: PrimeSessionContext,
  ) {
    if (context.stopped) return;
    context.stopped = true;
    clearPrimeAgentSessionActivity(context.activityKey);
    // Closing the owned scope terminates the child and lets its exit-status
    // effect settle. Interrupting the watcher first can deadlock with process
    // adapters whose exit wait is not itself interruptible.
    yield* Scope.close(context.scope, Exit.void).pipe(Effect.ignore);
    if (context.notificationFiber) yield* Fiber.interrupt(context.notificationFiber);
    if (context.processFiber) yield* Fiber.interrupt(context.processFiber);
    sessions.delete(context.threadId);
    yield* emit({
      type: "session.exited",
      ...(yield* eventStamp()),
      provider: PROVIDER,
      threadId: context.threadId,
      payload: { exitKind: "graceful" },
    });
  });

  const handleUnexpectedProcessExit = Effect.fn("PrimeAdapter.handleUnexpectedProcessExit")(
    function* (context: PrimeSessionContext, reason: string) {
      yield* withThreadLock(
        context.threadId,
        Effect.gen(function* () {
          if (context.stopped) return;
          context.stopped = true;
          clearPrimeAgentSessionActivity(context.activityKey);
          if (context.notificationFiber) yield* Fiber.interrupt(context.notificationFiber);
          const activeTurnId = context.activeTurnId;
          yield* emitReasoningCompletion(context, "failed");
          context.promptActive = false;
          context.activeTurnId = undefined;
          context.session = {
            ...context.session,
            status: "error",
            updatedAt: yield* nowIso,
            lastError: reason,
          };
          sessions.delete(context.threadId);
          if (activeTurnId) {
            yield* emit({
              type: "turn.completed",
              ...(yield* eventStamp()),
              provider: PROVIDER,
              threadId: context.threadId,
              turnId: activeTurnId,
              payload: { state: "failed", errorMessage: reason },
            });
          }
          yield* emit({
            type: "session.state.changed",
            ...(yield* eventStamp()),
            provider: PROVIDER,
            threadId: context.threadId,
            payload: { state: "error", reason },
          });
          yield* emit({
            type: "session.exited",
            ...(yield* eventStamp()),
            provider: PROVIDER,
            threadId: context.threadId,
            payload: { exitKind: "error", reason, recoverable: true },
          });
          yield* Scope.close(context.scope, Exit.void).pipe(Effect.ignore);
        }),
      );
    },
  );

  const startSession: PrimeAdapterShape["startSession"] = (input) =>
    withThreadLock(
      input.threadId,
      Effect.gen(function* () {
        if (input.provider !== undefined && input.provider !== PROVIDER) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
          });
        }
        if (
          input.providerInstanceId !== undefined &&
          input.providerInstanceId !== boundInstanceId
        ) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Expected provider instance '${boundInstanceId}' but received '${input.providerInstanceId}'.`,
          });
        }
        if (input.runtimeMode !== "full-access") {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue:
              "Prime Agent requires full-access runtime mode because its ACP server does not expose per-tool approvals.",
          });
        }
        if (!input.cwd?.trim()) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: "cwd is required and must be non-empty.",
          });
        }

        const cwd = path.resolve(input.cwd.trim());
        const model = modelForInstance(boundInstanceId, input.modelSelection);
        if (model !== "auto" && !parsePrimeModelSlug(model)) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: "Prime Agent models must use a provider/model slug (for example, openai/gpt-5).",
          });
        }
        const sessionKey = yield* makePrimeSessionKey(boundInstanceId, input.threadId).pipe(
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.mapError(
            (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "crypto/digest",
                detail: "Failed to derive a private Prime Agent session directory.",
                cause,
              }),
          ),
        );
        const suppliedResumeCursor = parsePrimeResumeCursor(input.resumeCursor);
        if (
          input.resumeCursor !== undefined &&
          input.resumeCursor !== null &&
          suppliedResumeCursor?.sessionKey !== sessionKey
        ) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue:
              "Prime Agent resume cursor does not belong to this thread and provider instance.",
          });
        }
        const executionEnvironment = options?.environment ?? process.env;
        const agentDirectory = resolvePrimeAgentDirectory(
          path,
          executionEnvironment,
          NodeOS.homedir(),
        );
        const persistentSession = {
          directory: resolvePrimeSessionDirectory(path, agentDirectory, sessionKey),
          continueSession: suppliedResumeCursor?.sessionKey === sessionKey,
        };
        yield* fileSystem
          .makeDirectory(persistentSession.directory, { recursive: true, mode: 0o700 })
          .pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterProcessError({
                  provider: PROVIDER,
                  threadId: input.threadId,
                  detail: "Failed to create the private Prime Agent session directory.",
                  cause,
                }),
            ),
          );
        // Preserve a healthy active session until all deterministic input,
        // cursor, and filesystem validation for its replacement has passed.
        // A malformed retry must not tear down the session it failed to replace.
        const existing = sessions.get(input.threadId);
        if (existing && !existing.stopped) yield* stopSessionInternal(existing);
        const sessionScope = yield* Scope.make("sequential");
        let transferred = false;
        yield* Effect.addFinalizer(() =>
          transferred ? Effect.void : Scope.close(sessionScope, Exit.void),
        );
        const nativeLoggers = makeAcpNativeLoggers({
          nativeEventLogger: options?.nativeEventLogger,
          provider: PROVIDER,
          threadId: input.threadId,
        });
        const acp = yield* makePrimeAcpRuntime({
          primeSettings,
          ...(options?.environment ? { environment: options.environment } : {}),
          childProcessSpawner,
          cwd,
          model,
          executionProfile: "agentic-session",
          persistentSession,
          clientInfo: { name: "t3-code", version: "0.0.0" },
          ...nativeLoggers,
        }).pipe(
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.provideService(Scope.Scope, sessionScope),
          Effect.mapError(
            (cause) =>
              new ProviderAdapterProcessError({
                provider: PROVIDER,
                threadId: input.threadId,
                detail: cause.message,
                cause,
              }),
          ),
        );
        const started = yield* acp
          .start()
          .pipe(
            Effect.mapError((cause) =>
              mapAcpToAdapterError(PROVIDER, input.threadId, "session/start", cause),
            ),
          );
        // Give a child that exits immediately after acknowledging
        // `session/new` a small stabilization window before publishing
        // `session.started`. Waiting on `processExit` directly is unsuitable:
        // some process adapters cannot interrupt that wait, which would make
        // a timeout block for the full lifetime of a healthy child.
        yield* Effect.sleep("25 millis");
        const processRunning = yield* acp.isProcessRunning.pipe(
          Effect.mapError((cause) =>
            mapAcpToAdapterError(PROVIDER, input.threadId, "process/is_running", cause),
          ),
        );
        if (!processRunning) {
          return yield* new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId: input.threadId,
            detail: "Prime Agent ACP process exited during session startup.",
          });
        }
        const createdAt = yield* nowIso;
        const session: ProviderSession = {
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          status: "ready",
          runtimeMode: input.runtimeMode,
          cwd,
          model,
          threadId: input.threadId,
          resumeCursor: makePrimeResumeCursor(sessionKey),
          createdAt,
          updatedAt: createdAt,
        };
        const context: PrimeSessionContext = {
          threadId: input.threadId,
          activityKey: `${boundInstanceId}:${input.threadId}:${started.sessionId}`,
          acpSessionId: started.sessionId,
          scope: sessionScope,
          acp,
          session,
          notificationFiber: undefined,
          processFiber: undefined,
          turns: [],
          activeTurnId: undefined,
          reasoningItemId: undefined,
          reasoningStarted: false,
          promptActive: false,
          interrupted: false,
          stopped: false,
        };
        sessions.set(input.threadId, context);
        transferred = true;

        context.notificationFiber = yield* Stream.runDrain(
          Stream.mapEffect(acp.getEvents(), (event) =>
            Effect.gen(function* () {
              switch (event._tag) {
                case "EventStreamBarrier":
                  yield* Deferred.succeed(event.acknowledge, undefined);
                  return;
                case "ModeChanged":
                  return;
                case "SessionInfoUpdated": {
                  updatePrimeAgentSubagentActivity(context.activityKey, event.metadata, {
                    threadId: context.threadId,
                    providerInstanceId: boundInstanceId,
                  });
                  const metadata = parsePrimeAgentSessionMetadata(event.metadata);
                  if (!metadata) return;
                  yield* emit({
                    type: "thread.metadata.updated",
                    ...(yield* eventStamp()),
                    provider: PROVIDER,
                    threadId: context.threadId,
                    turnId: context.activeTurnId,
                    payload: { metadata: { primeAgent: metadata } },
                    raw: {
                      source: "acp.primeAgent.extension",
                      method: "session/update",
                      payload: event.rawPayload,
                    },
                  });
                  return;
                }
                case "ThoughtDelta": {
                  if (!context.activeTurnId) return;
                  const itemId =
                    context.reasoningItemId ??
                    RuntimeItemId.make(`prime-reasoning-${context.activeTurnId}`);
                  context.reasoningItemId = itemId;
                  if (!context.reasoningStarted) {
                    context.reasoningStarted = true;
                    yield* emit(
                      makeAcpAssistantItemEvent({
                        stamp: yield* eventStamp(),
                        provider: PROVIDER,
                        threadId: context.threadId,
                        turnId: context.activeTurnId,
                        itemId,
                        lifecycle: "item.started",
                        itemType: "reasoning",
                      }),
                    );
                  }
                  yield* emit(
                    makeAcpContentDeltaEvent({
                      stamp: yield* eventStamp(),
                      provider: PROVIDER,
                      threadId: context.threadId,
                      turnId: context.activeTurnId,
                      itemId,
                      text: event.text,
                      streamKind: "reasoning_text",
                      rawPayload: event.rawPayload,
                    }),
                  );
                  return;
                }
                case "AssistantItemStarted":
                  if (!context.activeTurnId) return;
                  yield* emit(
                    makeAcpAssistantItemEvent({
                      stamp: yield* eventStamp(),
                      provider: PROVIDER,
                      threadId: context.threadId,
                      turnId: context.activeTurnId,
                      itemId: event.itemId,
                      lifecycle: "item.started",
                    }),
                  );
                  return;
                case "AssistantItemCompleted":
                  if (!context.activeTurnId) return;
                  yield* emit(
                    makeAcpAssistantItemEvent({
                      stamp: yield* eventStamp(),
                      provider: PROVIDER,
                      threadId: context.threadId,
                      turnId: context.activeTurnId,
                      itemId: event.itemId,
                      lifecycle: "item.completed",
                    }),
                  );
                  return;
                case "PlanUpdated":
                  if (!context.activeTurnId) return;
                  yield* emit(
                    makeAcpPlanUpdatedEvent({
                      stamp: yield* eventStamp(),
                      provider: PROVIDER,
                      threadId: context.threadId,
                      turnId: context.activeTurnId,
                      payload: event.payload,
                      source: "acp.jsonrpc",
                      method: "session/update",
                      rawPayload: event.rawPayload,
                    }),
                  );
                  return;
                case "ToolCallUpdated":
                  if (!context.activeTurnId) return;
                  yield* emit(
                    makeAcpToolCallEvent({
                      stamp: yield* eventStamp(),
                      provider: PROVIDER,
                      threadId: context.threadId,
                      turnId: context.activeTurnId,
                      toolCall: event.toolCall,
                      rawPayload: event.rawPayload,
                    }),
                  );
                  return;
                case "ContentDelta":
                  if (!context.activeTurnId) return;
                  yield* emit(
                    makeAcpContentDeltaEvent({
                      stamp: yield* eventStamp(),
                      provider: PROVIDER,
                      threadId: context.threadId,
                      turnId: context.activeTurnId,
                      ...(event.itemId ? { itemId: event.itemId } : {}),
                      text: event.text,
                      rawPayload: event.rawPayload,
                    }),
                  );
                  return;
              }
            }),
          ),
        ).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logError("Failed to process Prime Agent runtime notification.").pipe(
                  Effect.annotateLogs({ cause: Cause.pretty(cause) }),
                ),
          ),
          Effect.ensuring(Effect.sync(() => clearPrimeAgentSessionActivity(context.activityKey))),
          Effect.forkChild,
        );

        context.processFiber = yield* acp.processExit.pipe(
          Effect.matchEffect({
            onFailure: (cause) => handleUnexpectedProcessExit(context, cause.message),
            onSuccess: (exitCode) =>
              handleUnexpectedProcessExit(
                context,
                `Prime Agent ACP process exited unexpectedly with code ${exitCode}.`,
              ),
          }),
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logError("Failed to handle Prime Agent ACP process exit.").pipe(
                  Effect.annotateLogs({ cause: Cause.pretty(cause) }),
                  Effect.tap(() =>
                    Effect.sync(() => clearPrimeAgentSessionActivity(context.activityKey)),
                  ),
                ),
          ),
          Effect.forkChild,
        );

        yield* emit({
          type: "session.started",
          ...(yield* eventStamp()),
          provider: PROVIDER,
          threadId: input.threadId,
          payload: {
            resume: {
              continued: persistentSession.continueSession,
              initializeResult: started.initializeResult,
            },
          },
        });
        yield* emit({
          type: "session.state.changed",
          ...(yield* eventStamp()),
          provider: PROVIDER,
          threadId: input.threadId,
          payload: {
            state: "ready",
            reason:
              "Prime Agent ACP session ready; model-generated code runs with workspace-user permissions.",
          },
        });
        yield* emit({
          type: "thread.started",
          ...(yield* eventStamp()),
          provider: PROVIDER,
          threadId: input.threadId,
          payload: { providerThreadId: started.sessionId },
        });
        return session;
      }).pipe(Effect.scoped),
    );

  const settleTurn = Effect.fn("PrimeAdapter.settleTurn")(function* (
    threadId: ThreadId,
    turnId: TurnId,
    result: EffectAcpSchema.PromptResponse | undefined,
    errorMessage?: string,
  ) {
    yield* withThreadLock(
      threadId,
      Effect.gen(function* () {
        const context = sessions.get(threadId);
        if (!context || context.stopped || context.activeTurnId !== turnId) return;
        const failed = errorMessage !== undefined;
        const cancelled = context.interrupted || result?.stopReason === "cancelled";
        yield* emitReasoningCompletion(context, failed || cancelled ? "failed" : "completed");
        context.promptActive = false;
        context.interrupted = false;
        context.activeTurnId = undefined;
        const { activeTurnId: _activeTurnId, ...settledSession } = context.session;
        context.session = {
          ...settledSession,
          status: failed ? "error" : "ready",
          updatedAt: yield* nowIso,
          ...(failed ? { lastError: errorMessage } : {}),
        };
        yield* emit({
          type: "turn.completed",
          ...(yield* eventStamp()),
          provider: PROVIDER,
          threadId,
          turnId,
          payload: failed
            ? { state: "failed", errorMessage }
            : {
                state: cancelled ? "cancelled" : "completed",
                stopReason: result?.stopReason ?? null,
              },
        });
      }),
    );
  });

  const sendTurn: PrimeAdapterShape["sendTurn"] = (input) =>
    Effect.gen(function* () {
      const prepared = yield* withThreadLock(
        input.threadId,
        Effect.gen(function* () {
          const context = yield* requireSession(input.threadId);
          if (context.promptActive) {
            return yield* new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "session/prompt",
              detail: "Prime Agent ACP does not support steering a prompt already in progress.",
            });
          }
          const requestedModel = modelForInstance(
            boundInstanceId,
            input.modelSelection,
            context.session.model,
          );
          if (requestedModel !== context.session.model) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue: "Prime Agent model changes require a new thread.",
            });
          }
          const prompt: Array<EffectAcpSchema.ContentBlock> = [];
          const textParts: Array<string> = input.input?.trim() ? [input.input.trim()] : [];
          for (const attachment of input.attachments ?? []) {
            const attachmentPath = resolveAttachmentPath({
              attachmentsDir: serverConfig.attachmentsDir,
              attachment,
            });
            if (!attachmentPath) {
              return yield* new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "session/prompt",
                detail: `Invalid attachment id '${attachment.id}'.`,
              });
            }
            if (attachment.type === "image") {
              const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
                Effect.mapError(
                  (cause) =>
                    new ProviderAdapterRequestError({
                      provider: PROVIDER,
                      method: "session/prompt",
                      detail: cause.message,
                      cause,
                    }),
                ),
              );
              prompt.push({
                type: "image",
                data: Buffer.from(bytes).toString("base64"),
                mimeType: attachment.mimeType,
              });
            } else {
              const safeName = attachment.name.replaceAll("\r", " ").replaceAll("\n", " ");
              textParts.push(`The user attached file "${safeName}" at path: ${attachmentPath}`);
            }
          }
          if (textParts.length > 0) prompt.unshift({ type: "text", text: textParts.join("\n\n") });
          if (prompt.length === 0) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue: "Turn requires non-empty text or attachments.",
            });
          }
          const turnId = TurnId.make(yield* randomUUIDv4);
          context.activeTurnId = turnId;
          context.promptActive = true;
          context.interrupted = false;
          context.reasoningItemId = undefined;
          context.reasoningStarted = false;
          context.session = {
            ...context.session,
            status: "running",
            activeTurnId: turnId,
            updatedAt: yield* nowIso,
          };
          yield* emit({
            type: "turn.started",
            ...(yield* eventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            turnId,
            payload: { model: requestedModel },
          });
          return { context, prompt, turnId };
        }),
      );

      const promptExit = yield* prepared.context.acp.prompt({ prompt: prepared.prompt }).pipe(
        Effect.mapError((error) =>
          mapAcpToAdapterError(PROVIDER, input.threadId, "session/prompt", error),
        ),
        Effect.exit,
      );
      if (!prepared.context.stopped) yield* prepared.context.acp.drainEvents;
      yield* Effect.yieldNow;
      if (prepared.context.stopped || sessions.get(input.threadId) !== prepared.context) {
        return yield* new ProviderAdapterProcessError({
          provider: PROVIDER,
          threadId: input.threadId,
          detail:
            prepared.context.session.lastError ??
            "Prime Agent ACP process exited before the turn could settle.",
        });
      }
      if (Exit.isFailure(promptExit)) {
        const error = Cause.squash(promptExit.cause);
        const message = error instanceof Error ? error.message : String(error);
        yield* settleTurn(input.threadId, prepared.turnId, undefined, message);
        return yield* Effect.failCause(promptExit.cause);
      }
      prepared.context.turns.push({
        id: prepared.turnId,
        items: [{ prompt: prepared.prompt, result: promptExit.value }],
      });
      yield* settleTurn(input.threadId, prepared.turnId, promptExit.value);
      return {
        threadId: input.threadId,
        turnId: prepared.turnId,
      };
    });

  const interruptTurn: PrimeAdapterShape["interruptTurn"] = (threadId, turnId) =>
    withThreadLock(
      threadId,
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        if (!context.promptActive || !context.activeTurnId) return;
        if (turnId !== undefined && turnId !== context.activeTurnId) return;
        context.interrupted = true;
        yield* context.acp.cancel.pipe(
          Effect.mapError((error) =>
            mapAcpToAdapterError(PROVIDER, threadId, "session/cancel", error),
          ),
        );
      }),
    );

  const unsupportedInteractiveResponse = (threadId: ThreadId, method: string) =>
    requireSession(threadId).pipe(
      Effect.flatMap(
        () =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method,
            detail: "Prime Agent ACP does not expose interactive approval or user-input requests.",
          }),
      ),
    );
  const respondToRequest: PrimeAdapterShape["respondToRequest"] = (threadId) =>
    unsupportedInteractiveResponse(threadId, "session/request_permission");
  const respondToUserInput: PrimeAdapterShape["respondToUserInput"] = (threadId) =>
    unsupportedInteractiveResponse(threadId, "session/elicitation");
  const readThread: PrimeAdapterShape["readThread"] = (threadId) =>
    requireSession(threadId).pipe(Effect.map((context) => ({ threadId, turns: context.turns })));
  const rollbackThread: PrimeAdapterShape["rollbackThread"] = (threadId, numTurns) =>
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
        method: "thread/rollback",
        detail: "Prime Agent ACP does not support provider-side rollback.",
      });
    });
  const stopSession: PrimeAdapterShape["stopSession"] = (threadId) =>
    withThreadLock(threadId, requireSession(threadId).pipe(Effect.flatMap(stopSessionInternal)));
  const listSessions: PrimeAdapterShape["listSessions"] = () =>
    Effect.sync(() => Array.from(sessions.values(), (context) => ({ ...context.session })));
  const hasSession: PrimeAdapterShape["hasSession"] = (threadId) =>
    Effect.sync(() => {
      const context = sessions.get(threadId);
      return context !== undefined && !context.stopped;
    });
  const stopAll: PrimeAdapterShape["stopAll"] = () =>
    Effect.forEach(Array.from(sessions.values()), stopSessionInternal, { discard: true });

  yield* Effect.addFinalizer(() =>
    stopAll().pipe(
      Effect.ignore,
      Effect.tap(() => PubSub.shutdown(runtimeEvents)),
    ),
  );

  return {
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: "unsupported" },
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
    streamEvents: Stream.fromPubSub(runtimeEvents),
  } satisfies PrimeAdapterShape;
});
