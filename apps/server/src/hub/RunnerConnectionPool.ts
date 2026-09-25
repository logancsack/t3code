/**
 * RunnerConnectionPool - the hub's connections to thread machines.
 *
 * One connection per thread, opened on demand through the machine directory:
 *
 * - `use`/`stream` with `wake: true` resume or create the thread's machine,
 *   wait (bounded) until it is running, then connect. With `wake: false` a
 *   call only uses a machine that is already running; a paused, saved or
 *   missing machine fails with `ThreadMachineUnavailableError { reason:
 *   "asleep" }`, which read paths turn into cached results or a typed
 *   "machine asleep" answer. Which calls wake is decided by the callers and
 *   documented in docs/internals/thread-machines.md.
 * - The handshake negotiates the protocol version and proves the runner
 *   serves this thread. A new `bootId` is reported to connection handlers,
 *   which reconcile sessions that were active on the previous boot.
 * - Connection handlers (event delivery, git status, terminals) run in the
 *   connection's scope for as long as it is open.
 * - A connection is closed after `idleTimeout` without calls, open streams,
 *   or busy marks (a running turn), and the directory is told the machine is
 *   idle. An unexpected disconnect of a busy thread reconnects with backoff,
 *   without waking the machine.
 *
 * @module hub/RunnerConnectionPool
 */
import { type ProjectId, type ThreadId } from "@t3tools/contracts";
import {
  RUNNER_MIN_PROTOCOL_VERSION,
  RUNNER_PROTOCOL_VERSION,
  RUNNER_WS_PATH,
  type RunnerHello,
  RunnerRpcGroup,
  THREAD_CHECKOUT_ROOT,
  type ThreadMachineEnsureRequest,
  type ThreadMachineRepository,
  type ThreadMachineStatus,
  ThreadMachineUnavailableError,
  threadCheckoutPath,
} from "@t3tools/contracts/runner";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError";
import * as Socket from "effect/unstable/socket/Socket";

import { ServerConfig } from "../config.ts";
import { MachineDirectory, type MachineDirectoryError } from "./MachineDirectory.ts";

export type RunnerRpcClient = RpcClient.FromGroup<typeof RunnerRpcGroup, RpcClientError>;

export interface RunnerConnection {
  readonly threadId: ThreadId;
  readonly client: RunnerRpcClient;
  readonly hello: RunnerHello;
  /** Resolves when the socket closes for any reason. */
  readonly closed: Effect.Effect<void>;
}

/** What the directory needs to create a machine: from the thread and project. */
export interface ThreadMachineContext {
  readonly projectId: ProjectId | null;
  readonly repository: ThreadMachineRepository | null;
  readonly branch: string | null;
}

export type ThreadMachineContextResolver = (
  threadId: ThreadId,
) => Effect.Effect<ThreadMachineContext>;

export interface RunnerCallOptions {
  /** Resume or create the machine when it is not running. */
  readonly wake: boolean;
  /** Names the call in errors and logs. */
  readonly operation: string;
  /** Richer ensure context than the registered resolver provides. */
  readonly context?: ThreadMachineContext;
  /** Progress while waking (directory states before `running`). */
  readonly onWakeProgress?: (status: ThreadMachineStatus) => Effect.Effect<void>;
}

export type ConnectionHandler = (
  connection: RunnerConnection,
) => Effect.Effect<void, never, Scope.Scope>;

export type PoolLifecycleEvent =
  | { readonly _tag: "connected"; readonly connection: RunnerConnection }
  | { readonly _tag: "disconnected"; readonly threadId: ThreadId; readonly expected: boolean }
  /** The directory reports the machine failed or no longer exists. */
  | { readonly _tag: "lost"; readonly threadId: ThreadId; readonly status: ThreadMachineStatus };

export interface RunnerConnectionPoolShape {
  readonly checkoutRoot: string;
  readonly checkoutFor: (threadId: ThreadId) => string;
  readonly use: <A, E>(
    threadId: ThreadId,
    options: RunnerCallOptions,
    f: (connection: RunnerConnection) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | ThreadMachineUnavailableError>;
  /** Like `use`; the connection counts as active until the stream ends. */
  readonly stream: <A, E>(
    threadId: ThreadId,
    options: RunnerCallOptions,
    f: (connection: RunnerConnection) => Stream.Stream<A, E>,
  ) => Stream.Stream<A, E | ThreadMachineUnavailableError>;
  /** The open connection, if any. Never connects or wakes. */
  readonly current: (threadId: ThreadId) => Effect.Effect<Option.Option<RunnerConnection>>;
  readonly connections: Effect.Effect<ReadonlyArray<RunnerConnection>>;
  /** Directory state without waking. */
  readonly machineStatus: (
    threadId: ThreadId,
  ) => Effect.Effect<ThreadMachineStatus, ThreadMachineUnavailableError>;
  /** Runs `handler` in the scope of every current and future connection. */
  readonly onConnection: (handler: ConnectionHandler) => Effect.Effect<void>;
  readonly lifecycle: Stream.Stream<PoolLifecycleEvent>;
  /** Busy marks keep a connection open (and reconnecting) while set. */
  readonly setBusy: (threadId: ThreadId, reason: string, busy: boolean) => Effect.Effect<void>;
  /** Records activity so the idle timer restarts. */
  readonly touch: (threadId: ThreadId) => Effect.Effect<void>;
  readonly setContextResolver: (resolver: ThreadMachineContextResolver) => Effect.Effect<void>;
  /** Closes the connection and retires the machine. */
  readonly release: (threadId: ThreadId) => Effect.Effect<void>;
}

export class RunnerConnectionPool extends Context.Service<
  RunnerConnectionPool,
  RunnerConnectionPoolShape
>()("t3/hub/RunnerConnectionPool") {}

export interface RunnerConnectionPoolOptions {
  readonly checkoutRoot?: string;
  readonly wakeTimeout?: Duration.Input;
  readonly wakePollInterval?: Duration.Input;
  readonly idleTimeout?: Duration.Input;
  readonly idleCheckInterval?: Duration.Input;
  readonly connectTimeout?: Duration.Input;
  readonly reconnectMaxDelay?: Duration.Input;
}

const DEFAULTS = {
  wakeTimeout: Duration.minutes(5),
  wakePollInterval: Duration.seconds(2),
  idleTimeout: Duration.minutes(10),
  idleCheckInterval: Duration.seconds(30),
  connectTimeout: Duration.seconds(15),
  reconnectMaxDelay: Duration.seconds(15),
} as const;

const COMING_UP: ReadonlySet<ThreadMachineStatus["state"]> = new Set(["preparing", "starting"]);

interface Slot {
  attempt: Deferred.Deferred<RunnerConnection, ThreadMachineUnavailableError>;
  wake: boolean;
  connection: RunnerConnection | null;
  scope: Scope.Closeable | null;
  closing: boolean;
}

interface Activity {
  inFlight: number;
  lastActivityAt: number;
  readonly busy: Set<string>;
}

const describe = (cause: unknown): string =>
  cause && typeof cause === "object" && "message" in cause
    ? String((cause as { readonly message: unknown }).message)
    : String(cause);

/** A WebSocket constructor that presents the runner token as a bearer header. */
const bearerWebSocketConstructor = (token: string) =>
  Layer.succeed(Socket.WebSocketConstructor)(
    (url, protocols) =>
      // Node's and Bun's WebSocket accept an init object with headers.
      new globalThis.WebSocket(url, {
        ...(protocols !== undefined ? { protocols } : {}),
        headers: { authorization: `Bearer ${token}` },
      } as unknown as string[]),
  );

const runnerSocketUrl = (url: string) => {
  const parsed = new URL(url);
  if (parsed.pathname === "/" || parsed.pathname === "") parsed.pathname = RUNNER_WS_PATH;
  return parsed.toString();
};

export const make = (options: RunnerConnectionPoolOptions = {}) =>
  Effect.gen(function* () {
    const directory = yield* MachineDirectory;
    const poolScope = yield* Effect.scope;
    const checkoutRoot = options.checkoutRoot ?? THREAD_CHECKOUT_ROOT;
    const wakeTimeout = Duration.fromInputUnsafe(options.wakeTimeout ?? DEFAULTS.wakeTimeout);
    const wakePollInterval = Duration.fromInputUnsafe(
      options.wakePollInterval ?? DEFAULTS.wakePollInterval,
    );
    const idleTimeout = Duration.fromInputUnsafe(options.idleTimeout ?? DEFAULTS.idleTimeout);
    const idleCheckInterval = Duration.fromInputUnsafe(
      options.idleCheckInterval ?? DEFAULTS.idleCheckInterval,
    );
    const connectTimeout = Duration.fromInputUnsafe(
      options.connectTimeout ?? DEFAULTS.connectTimeout,
    );
    const reconnectMaxDelay = Duration.fromInputUnsafe(
      options.reconnectMaxDelay ?? DEFAULTS.reconnectMaxDelay,
    );

    const slots = new Map<ThreadId, Slot>();
    const activity = new Map<ThreadId, Activity>();
    const handlers: Array<ConnectionHandler> = [];
    const lifecycle = yield* PubSub.unbounded<PoolLifecycleEvent>();
    let contextResolver: ThreadMachineContextResolver | null = null;

    const checkoutFor = (threadId: ThreadId) => threadCheckoutPath(threadId, checkoutRoot);
    const activityOf = (threadId: ThreadId, now: number): Activity => {
      let entry = activity.get(threadId);
      if (!entry) {
        entry = { inFlight: 0, lastActivityAt: now, busy: new Set() };
        activity.set(threadId, entry);
      }
      return entry;
    };

    const unavailable = (
      threadId: ThreadId,
      operation: string,
      reason: ThreadMachineUnavailableError["reason"],
      detail: string,
      state?: ThreadMachineStatus["state"],
    ) =>
      new ThreadMachineUnavailableError({
        threadId,
        reason,
        operation,
        detail,
        ...(state !== undefined ? { state } : {}),
      });
    const fromDirectoryError =
      (threadId: ThreadId, operation: string) => (error: MachineDirectoryError) =>
        unavailable(threadId, operation, "directory", error.message);

    const ensureRequest = (
      threadId: ThreadId,
      context: ThreadMachineContext | undefined,
    ): Effect.Effect<ThreadMachineEnsureRequest> =>
      Effect.gen(function* () {
        const resolved =
          context ??
          (contextResolver
            ? yield* contextResolver(threadId).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("thread machine context lookup failed", {
                    threadId,
                    cause: Cause.pretty(cause),
                  }).pipe(Effect.as(undefined)),
                ),
              )
            : undefined);
        return {
          projectId: resolved?.projectId ?? null,
          repository: resolved?.repository ?? null,
          branch: resolved?.branch ?? null,
          checkout: checkoutFor(threadId),
          wake: true,
        };
      });

    /** Resolves a running machine through the directory, waking it when asked. */
    const resolveRunning = (threadId: ThreadId, callOptions: RunnerCallOptions) =>
      Effect.gen(function* () {
        const { operation } = callOptions;
        let status: ThreadMachineStatus = callOptions.wake
          ? yield* directory
              .ensure(threadId, yield* ensureRequest(threadId, callOptions.context))
              .pipe(Effect.mapError(fromDirectoryError(threadId, operation)))
          : yield* directory
              .status(threadId)
              .pipe(Effect.mapError(fromDirectoryError(threadId, operation)));
        if (callOptions.wake) {
          const deadline = (yield* Clock.currentTimeMillis) + Duration.toMillis(wakeTimeout);
          while (status.state !== "running" && status.state !== "failed") {
            if (callOptions.onWakeProgress) yield* callOptions.onWakeProgress(status);
            if ((yield* Clock.currentTimeMillis) >= deadline) {
              return yield* unavailable(
                threadId,
                operation,
                "wake-timeout",
                `The machine did not start within ${Duration.format(wakeTimeout)} (last state ${status.state}${status.detail ? `: ${status.detail}` : ""}).`,
                status.state,
              );
            }
            yield* Effect.sleep(wakePollInterval);
            status = yield* directory
              .status(threadId)
              .pipe(Effect.mapError(fromDirectoryError(threadId, operation)));
          }
        }
        switch (status.state) {
          case "running":
            if (!status.runner) {
              return yield* unavailable(
                threadId,
                operation,
                "unreachable",
                "The directory reports the machine running without a runner endpoint.",
                status.state,
              );
            }
            return { status, runner: status.runner };
          case "failed":
            yield* PubSub.publish(lifecycle, { _tag: "lost", threadId, status });
            return yield* unavailable(
              threadId,
              operation,
              "failed",
              status.detail ?? "The machine failed.",
              status.state,
            );
          case "none":
            yield* PubSub.publish(lifecycle, { _tag: "lost", threadId, status });
            return yield* unavailable(
              threadId,
              operation,
              "asleep",
              "The thread has no machine.",
              status.state,
            );
          default:
            return yield* unavailable(
              threadId,
              operation,
              "asleep",
              COMING_UP.has(status.state) ? "The machine is starting." : "The machine is asleep.",
              status.state,
            );
        }
      });

    /** Opens the socket, runs the handshake, and starts connection handlers. */
    const open = (
      threadId: ThreadId,
      runner: { readonly url: string; readonly token: string },
      operation: string,
      scope: Scope.Closeable,
    ) =>
      Effect.gen(function* () {
        const closed = yield* Deferred.make<void>();
        const hooks = RpcClient.ConnectionHooks.of({
          onConnect: Effect.void,
          onDisconnect: Deferred.succeed(closed, undefined).pipe(Effect.asVoid),
        });
        const protocolContext = yield* Layer.buildWithScope(
          Layer.effect(
            RpcClient.Protocol,
            RpcClient.makeProtocolSocket({ retryTransientErrors: false }),
          ).pipe(
            Layer.provide(
              Layer.mergeAll(
                Socket.layerWebSocket(runnerSocketUrl(runner.url), {
                  openTimeout: connectTimeout,
                }).pipe(Layer.provide(bearerWebSocketConstructor(runner.token))),
                RpcSerialization.layerJson,
                Layer.succeed(RpcClient.ConnectionHooks, hooks),
              ),
            ),
          ),
          scope,
        );
        const client = yield* RpcClient.make(RunnerRpcGroup, { disableTracing: true }).pipe(
          Effect.provide(protocolContext),
          Scope.provide(scope),
        );
        const hello = yield* client["runner.hello"]({
          protocolVersion: RUNNER_PROTOCOL_VERSION,
          minProtocolVersion: RUNNER_MIN_PROTOCOL_VERSION,
          threadId,
        }).pipe(
          Effect.timeoutOrElse({
            duration: connectTimeout,
            orElse: () =>
              Effect.fail(
                unavailable(
                  threadId,
                  operation,
                  "unreachable",
                  `The runner did not answer within ${Duration.format(connectTimeout)}.`,
                  "running",
                ),
              ),
          }),
          Effect.mapError((error) => {
            switch (error._tag) {
              case "ThreadMachineUnavailableError":
                return error;
              case "RunnerProtocolMismatchError":
              case "RunnerThreadMismatchError":
                return unavailable(threadId, operation, "incompatible", error.message, "running");
              default:
                return unavailable(
                  threadId,
                  operation,
                  "unreachable",
                  `The runner connection failed: ${describe(error)}`,
                  "running",
                );
            }
          }),
        );
        return {
          threadId,
          client,
          hello,
          closed: Deferred.await(closed),
        } satisfies RunnerConnection;
      });

    const runHandlers = (connection: RunnerConnection, scope: Scope.Closeable) =>
      Effect.forEach(
        [...handlers],
        (handler) =>
          handler(connection).pipe(
            Scope.provide(scope),
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : Effect.logWarning("runner connection handler failed", {
                    threadId: connection.threadId,
                    cause: Cause.pretty(cause),
                  }),
            ),
            Effect.forkIn(scope),
          ),
        { discard: true },
      );

    const closeSlot = (threadId: ThreadId, slot: Slot, expected: boolean) =>
      Effect.gen(function* () {
        if (slot.closing) return;
        slot.closing = true;
        if (slots.get(threadId) === slot) slots.delete(threadId);
        if (slot.scope) yield* Scope.close(slot.scope, Exit.void);
        if (slot.connection) {
          yield* PubSub.publish(lifecycle, { _tag: "disconnected", threadId, expected });
        }
      });

    /** Reconnects a busy thread after an unexpected disconnect, never waking it. */
    const reconnectWhileBusy = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const busy = () => (activity.get(threadId)?.busy.size ?? 0) > 0;
        if (!busy()) return;
        yield* acquire(threadId, { wake: false, operation: "reconnect" }).pipe(
          Effect.retry({
            while: (error) =>
              busy() && (error.reason === "unreachable" || error.reason === "directory"),
            schedule: Schedule.exponential("250 millis").pipe(
              Schedule.modifyDelay(({ duration }) =>
                Effect.succeed(Duration.min(duration, reconnectMaxDelay)),
              ),
            ),
          }),
          Effect.tap(() => Effect.logInfo("runner reconnected", { threadId })),
          Effect.catch((error) =>
            Effect.logWarning("runner reconnect stopped", {
              threadId,
              reason: error.reason,
              detail: error.detail,
            }),
          ),
        );
      });

    const connectAttempt = (threadId: ThreadId, slot: Slot, callOptions: RunnerCallOptions) =>
      Effect.gen(function* () {
        const { runner } = yield* resolveRunning(threadId, callOptions);
        const scope = yield* Scope.make();
        slot.scope = scope;
        const connection = yield* open(threadId, runner, callOptions.operation, scope).pipe(
          Effect.onError(() => Scope.close(scope, Exit.void)),
        );
        slot.connection = connection;
        const now = yield* Clock.currentTimeMillis;
        activityOf(threadId, now).lastActivityAt = now;
        yield* Effect.logInfo("runner connected", {
          threadId,
          runnerId: connection.hello.runnerId,
          bootId: connection.hello.bootId,
          protocolVersion: connection.hello.protocolVersion,
          headSequence: connection.hello.headSequence,
          ackedSequence: connection.hello.ackedSequence,
        });
        yield* PubSub.publish(lifecycle, { _tag: "connected", connection });
        yield* runHandlers(connection, scope);
        // Watch for the socket closing; unexpected closes of busy threads reconnect.
        yield* connection.closed.pipe(
          Effect.andThen(
            Effect.suspend(() => {
              const expected = slot.closing;
              return closeSlot(threadId, slot, expected).pipe(
                Effect.andThen(
                  expected
                    ? Effect.void
                    : Effect.logWarning("runner connection lost", { threadId }).pipe(
                        Effect.andThen(reconnectWhileBusy(threadId)),
                      ),
                ),
              );
            }),
          ),
          Effect.forkIn(poolScope),
        );
        return connection;
      });

    const acquire = (
      threadId: ThreadId,
      callOptions: RunnerCallOptions,
    ): Effect.Effect<RunnerConnection, ThreadMachineUnavailableError> =>
      Effect.suspend(() => {
        const existing = slots.get(threadId);
        if (existing && !existing.closing) {
          if (existing.connection) return Effect.succeed(existing.connection);
          const waitExisting = Deferred.await(existing.attempt);
          // A read-only attempt in flight cannot satisfy a caller that must wake.
          return callOptions.wake && !existing.wake
            ? waitExisting.pipe(
                Effect.catchIf(
                  (error) => error.reason === "asleep",
                  () => acquire(threadId, callOptions),
                ),
              )
            : waitExisting;
        }
        return Effect.gen(function* () {
          const attempt = yield* Deferred.make<RunnerConnection, ThreadMachineUnavailableError>();
          const slot: Slot = {
            attempt,
            wake: callOptions.wake,
            connection: null,
            scope: null,
            closing: false,
          };
          slots.set(threadId, slot);
          yield* connectAttempt(threadId, slot, callOptions).pipe(
            Effect.exit,
            Effect.flatMap((exit) => {
              if (Exit.isFailure(exit) && slots.get(threadId) === slot) slots.delete(threadId);
              return Deferred.done(attempt, exit);
            }),
            // The attempt outlives any single caller being interrupted.
            Effect.forkIn(poolScope),
          );
          return yield* Deferred.await(attempt);
        });
      });

    const track = <A, E, R>(threadId: ThreadId, effect: Effect.Effect<A, E, R>) =>
      Effect.acquireUseRelease(
        Clock.currentTimeMillis.pipe(
          Effect.map((now) => {
            const entry = activityOf(threadId, now);
            entry.inFlight += 1;
            entry.lastActivityAt = now;
          }),
        ),
        () => effect,
        () =>
          Clock.currentTimeMillis.pipe(
            Effect.map((now) => {
              const entry = activityOf(threadId, now);
              entry.inFlight = Math.max(0, entry.inFlight - 1);
              entry.lastActivityAt = now;
            }),
          ),
      );

    const use: RunnerConnectionPoolShape["use"] = (threadId, callOptions, f) =>
      track(threadId, acquire(threadId, callOptions).pipe(Effect.flatMap(f)));

    const stream: RunnerConnectionPoolShape["stream"] = (threadId, callOptions, f) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const connection = yield* acquire(threadId, callOptions);
          const now = yield* Clock.currentTimeMillis;
          const entry = activityOf(threadId, now);
          entry.inFlight += 1;
          entry.lastActivityAt = now;
          return f(connection).pipe(
            Stream.ensuring(
              Clock.currentTimeMillis.pipe(
                Effect.map((end) => {
                  entry.inFlight = Math.max(0, entry.inFlight - 1);
                  entry.lastActivityAt = end;
                }),
              ),
            ),
          );
        }),
      );

    // Idle connections close and tell the platform the machine may sleep.
    yield* Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      for (const [threadId, slot] of slots) {
        if (!slot.connection || slot.closing) continue;
        const entry = activityOf(threadId, now);
        if (entry.inFlight > 0 || entry.busy.size > 0) continue;
        if (now - entry.lastActivityAt < Duration.toMillis(idleTimeout)) continue;
        yield* Effect.logInfo("closing idle runner connection", { threadId });
        yield* closeSlot(threadId, slot, true);
        yield* directory.idle(threadId).pipe(
          Effect.catch((error) =>
            Effect.logWarning("machine directory idle notification failed", {
              threadId,
              detail: error.message,
            }),
          ),
        );
      }
    }).pipe(Effect.delay(idleCheckInterval), Effect.forever, Effect.forkIn(poolScope));

    yield* Effect.addFinalizer(() =>
      Effect.forEach([...slots], ([threadId, slot]) => closeSlot(threadId, slot, true), {
        discard: true,
      }),
    );

    return RunnerConnectionPool.of({
      checkoutRoot,
      checkoutFor,
      use,
      stream,
      current: (threadId) =>
        Effect.sync(() => {
          const slot = slots.get(threadId);
          return slot?.connection && !slot.closing
            ? Option.some(slot.connection)
            : Option.none<RunnerConnection>();
        }),
      connections: Effect.sync(() =>
        [...slots.values()].flatMap((slot) =>
          slot.connection && !slot.closing ? [slot.connection] : [],
        ),
      ),
      machineStatus: (threadId) =>
        directory.status(threadId).pipe(Effect.mapError(fromDirectoryError(threadId, "status"))),
      onConnection: (handler) =>
        Effect.gen(function* () {
          handlers.push(handler);
          for (const slot of slots.values()) {
            if (slot.connection && slot.scope && !slot.closing) {
              yield* handler(slot.connection).pipe(
                Scope.provide(slot.scope),
                Effect.catchCause((cause) =>
                  Cause.hasInterruptsOnly(cause)
                    ? Effect.void
                    : Effect.logWarning("runner connection handler failed", {
                        cause: Cause.pretty(cause),
                      }),
                ),
                Effect.forkIn(slot.scope),
              );
            }
          }
        }),
      lifecycle: Stream.fromPubSub(lifecycle),
      setBusy: (threadId, reason, busy) =>
        Clock.currentTimeMillis.pipe(
          Effect.map((now) => {
            const entry = activityOf(threadId, now);
            if (busy) entry.busy.add(reason);
            else entry.busy.delete(reason);
            entry.lastActivityAt = now;
          }),
        ),
      touch: (threadId) =>
        Clock.currentTimeMillis.pipe(
          Effect.map((now) => {
            activityOf(threadId, now).lastActivityAt = now;
          }),
        ),
      setContextResolver: (resolver) =>
        Effect.sync(() => {
          contextResolver = resolver;
        }),
      release: (threadId) =>
        Effect.gen(function* () {
          const slot = slots.get(threadId);
          if (slot) yield* closeSlot(threadId, slot, true);
          activity.delete(threadId);
          yield* directory.release(threadId).pipe(
            Effect.catch((error) =>
              Effect.logWarning("machine directory release failed", {
                threadId,
                detail: error.message,
              }),
            ),
          );
        }),
    });
  });

export const layer = Layer.effect(
  RunnerConnectionPool,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    return yield* make(config.hub?.checkoutRoot ? { checkoutRoot: config.hub.checkoutRoot } : {});
  }),
);
