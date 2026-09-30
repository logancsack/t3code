/**
 * Terminals in hub mode. Every terminal lives on its thread's machine.
 *
 * - `open`, `attach` and `restart` wake the machine (opening a terminal is an
 *   explicit request for a live shell).
 * - `write`, `resize` and `clear` act on a running terminal and never wake a
 *   machine; on a sleeping one they fail with `TerminalNotRunningError`.
 *   `close` on a sleeping machine is a no-op.
 * - Terminal events and metadata from every connected runner fan out to hub
 *   subscribers. Metadata of a machine that went to sleep is kept (paused
 *   machines keep their shells); a runner's snapshot on reconnect replaces its
 *   thread's entries.
 *
 * @module hub/HubTerminals
 */
import {
  TerminalCwdStatError,
  type TerminalError,
  type TerminalEvent,
  type TerminalMetadataStreamEvent,
  TerminalNotRunningError,
  type TerminalSummary,
  type ThreadId,
  ThreadId as ThreadIdSchema,
} from "@t3tools/contracts";
import { TerminalError as TerminalErrorSchema } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as TerminalManager from "../terminal/Manager.ts";
import { describeCause } from "./hubRouting.ts";
import { RunnerConnectionPool, type RunnerRpcClient } from "./RunnerConnectionPool.ts";

const isTerminalError = Schema.is(TerminalErrorSchema);

export const hubTerminalManagerLayer = Layer.effect(
  TerminalManager.TerminalManager,
  Effect.gen(function* () {
    const pool = yield* RunnerConnectionPool;
    const eventListeners = new Set<(event: TerminalEvent) => Effect.Effect<void>>();
    const metadataListeners = new Set<
      (event: TerminalMetadataStreamEvent) => Effect.Effect<void>
    >();
    const summaries = new Map<ThreadId, Map<string, TerminalSummary>>();

    const emitMetadata = (event: TerminalMetadataStreamEvent) =>
      Effect.forEach([...metadataListeners], (listener) => listener(event), { discard: true });
    const emitEvent = (event: TerminalEvent) =>
      Effect.forEach([...eventListeners], (listener) => listener(event), { discard: true });

    /** Applies one runner metadata event to the thread's entries and forwards the delta. */
    const applyMetadata = (threadId: ThreadId, event: TerminalMetadataStreamEvent) =>
      Effect.gen(function* () {
        const entries = summaries.get(threadId) ?? new Map<string, TerminalSummary>();
        summaries.set(threadId, entries);
        switch (event.type) {
          case "snapshot": {
            const next = new Map(
              event.terminals.map((terminal) => [terminal.terminalId, terminal]),
            );
            for (const terminalId of entries.keys()) {
              if (!next.has(terminalId)) {
                yield* emitMetadata({ type: "remove", threadId, terminalId });
              }
            }
            summaries.set(threadId, next);
            for (const terminal of next.values()) {
              yield* emitMetadata({ type: "upsert", terminal });
            }
            return;
          }
          case "upsert":
            entries.set(event.terminal.terminalId, event.terminal);
            return yield* emitMetadata(event);
          case "remove":
            entries.delete(event.terminalId);
            return yield* emitMetadata(event);
        }
      });

    yield* pool.onConnection((connection) =>
      Effect.gen(function* () {
        const events = yield* connection.client["runner.terminal.events"]({}).pipe(
          Stream.runForEach(emitEvent),
          Effect.forkScoped,
        );
        yield* connection.client["runner.terminal.metadata"]({}).pipe(
          Stream.runForEach((event) => applyMetadata(connection.threadId, event)),
        );
        yield* Fiber.join(events);
      }).pipe(
        Effect.catch((error) =>
          Effect.logDebug("runner terminal streams ended", {
            threadId: connection.threadId,
            detail: describeCause(error),
          }),
        ),
      ),
    );

    const unavailableTerminal = (
      input: {
        readonly threadId: string;
        readonly terminalId?: string | undefined;
        readonly cwd?: string | undefined;
      },
      cause: unknown,
    ): TerminalError =>
      isTerminalError(cause)
        ? cause
        : input.cwd !== undefined
          ? new TerminalCwdStatError({ cwd: input.cwd, cause })
          : new TerminalNotRunningError({
              threadId: input.threadId,
              terminalId: input.terminalId ?? "default",
            });

    const onRunner = <A, E>(
      input: {
        readonly threadId: string;
        readonly terminalId?: string | undefined;
        readonly cwd?: string | undefined;
      },
      wake: boolean,
      operation: string,
      f: (client: RunnerRpcClient) => Effect.Effect<A, E>,
    ): Effect.Effect<A, TerminalError> =>
      pool
        .use(
          ThreadIdSchema.make(input.threadId),
          { wake, operation: `terminal.${operation}` },
          (c) => f(c.client),
        )
        .pipe(Effect.mapError((error) => unavailableTerminal(input, error)));

    return TerminalManager.TerminalManager.of({
      open: (input) =>
        onRunner(input, true, "open", (client) => client["runner.terminal.open"](input)),
      attachStream: (input, listener) =>
        Effect.gen(function* () {
          // Resolves on the first event (the snapshot) or the first failure, so
          // waking and attach failures surface to the caller.
          const ready = yield* Deferred.make<void, TerminalError>();
          const fiber = yield* pool
            .stream(
              ThreadIdSchema.make(input.threadId),
              { wake: true, operation: "terminal.attach" },
              (connection) => connection.client["runner.terminal.attach"](input),
            )
            .pipe(
              Stream.runForEach((event) =>
                listener(event).pipe(Effect.andThen(Deferred.succeed(ready, undefined))),
              ),
              Effect.matchEffect({
                onFailure: (error) =>
                  Deferred.fail(ready, unavailableTerminal(input, error)).pipe(
                    Effect.andThen(
                      Effect.logDebug("terminal attach stream ended", {
                        threadId: input.threadId,
                        terminalId: input.terminalId,
                        detail: describeCause(error),
                      }),
                    ),
                  ),
                onSuccess: () => Deferred.succeed(ready, undefined),
              }),
              Effect.forkDetach,
            );
          yield* Deferred.await(ready);
          return () => {
            fiber.interruptUnsafe();
          };
        }),
      write: (input) =>
        onRunner(input, false, "write", (client) => client["runner.terminal.write"](input)),
      resize: (input) =>
        onRunner(input, false, "resize", (client) => client["runner.terminal.resize"](input)),
      clear: (input) =>
        onRunner(input, false, "clear", (client) => client["runner.terminal.clear"](input)),
      restart: (input) =>
        onRunner(input, true, "restart", (client) => client["runner.terminal.restart"](input)),
      close: (input) =>
        pool
          .current(ThreadIdSchema.make(input.threadId))
          .pipe(
            Effect.flatMap((connection) =>
              Option.isNone(connection)
                ? Effect.void
                : connection.value.client["runner.terminal.close"](input).pipe(
                    Effect.mapError((error) => unavailableTerminal(input, error)),
                  ),
            ),
          ),
      subscribe: (listener) =>
        Effect.sync(() => {
          eventListeners.add(listener);
          return () => {
            eventListeners.delete(listener);
          };
        }),
      subscribeMetadata: (listener) =>
        Effect.gen(function* () {
          metadataListeners.add(listener);
          yield* listener({
            type: "snapshot",
            terminals: [...summaries.values()].flatMap((entries) => [...entries.values()]),
          });
          return () => {
            metadataListeners.delete(listener);
          };
        }),
    });
  }),
);
