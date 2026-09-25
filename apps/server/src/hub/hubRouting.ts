/**
 * Routing helpers shared by the hub's checkout services.
 *
 * Every checkout-keyed call names a `cwd`; in hub mode a thread's checkout is
 * `<checkout root>/<threadId>`, so the cwd alone names the thread and its
 * machine. A cwd that is not a thread checkout fails with a typed error; the
 * hub never falls back to its own filesystem.
 *
 * Each hub service must fail with its own service's error type, so transport
 * failures and sleeping machines are wrapped into that type with the
 * original `ThreadMachineUnavailableError` (or RPC error) as the cause.
 *
 * @module hub/hubRouting
 */
import {
  GitCommandError,
  GitManagerError,
  GitManagerServiceError,
  type ThreadId,
  VcsError,
  VcsRepositoryDetectionError,
} from "@t3tools/contracts";
import { parseThreadCheckoutPath, ThreadMachineUnavailableError } from "@t3tools/contracts/runner";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type {
  RunnerCallOptions,
  RunnerConnection,
  RunnerConnectionPoolShape,
  RunnerRpcClient,
} from "./RunnerConnectionPool.ts";

export const describeCause = (cause: unknown): string =>
  cause && typeof cause === "object" && "message" in cause
    ? String((cause as { readonly message: unknown }).message)
    : String(cause);

export const notAThreadCheckout = (cwd: string, operation: string) =>
  new ThreadMachineUnavailableError({
    threadId: null,
    reason: "not-a-thread-checkout",
    operation,
    detail: `${cwd} is not a thread checkout, and a hub never reads its own filesystem.`,
  });

/** The thread that owns `cwd`, or a typed failure. */
export const threadOfCwd = (
  pool: RunnerConnectionPoolShape,
  cwd: string,
  operation: string,
): Effect.Effect<ThreadId, ThreadMachineUnavailableError> => {
  const threadId = parseThreadCheckoutPath(cwd, pool.checkoutRoot);
  return threadId === null
    ? Effect.fail(notAThreadCheckout(cwd, operation))
    : Effect.succeed(threadId);
};

/** Runs `f` on the runner that owns `cwd`. */
export const onCwdRunner = <A, E>(
  pool: RunnerConnectionPoolShape,
  cwd: string,
  options: RunnerCallOptions,
  f: (client: RunnerRpcClient, connection: RunnerConnection) => Effect.Effect<A, E>,
): Effect.Effect<A, E | ThreadMachineUnavailableError> =>
  threadOfCwd(pool, cwd, options.operation).pipe(
    Effect.flatMap((threadId) =>
      pool.use(threadId, options, (connection) => f(connection.client, connection)),
    ),
  );

/** Streams from the runner that owns `cwd`. */
export const streamOnCwdRunner = <A, E>(
  pool: RunnerConnectionPoolShape,
  cwd: string,
  options: RunnerCallOptions,
  f: (client: RunnerRpcClient) => Stream.Stream<A, E>,
): Stream.Stream<A, E | ThreadMachineUnavailableError> =>
  Stream.unwrap(
    threadOfCwd(pool, cwd, options.operation).pipe(
      Effect.map((threadId) =>
        pool.stream(threadId, options, (connection) => f(connection.client)),
      ),
    ),
  );

const isVcsError = Schema.is(VcsError);
const isGitCommandError = Schema.is(GitCommandError);
const isGitManagerServiceError = Schema.is(GitManagerServiceError);

export const toVcsError =
  (operation: string, cwd: string) =>
  (error: unknown): VcsError =>
    isVcsError(error)
      ? error
      : new VcsRepositoryDetectionError({
          operation,
          cwd,
          detail: describeCause(error),
          cause: error,
        });

export const toGitCommandError =
  (operation: string, cwd: string) =>
  (error: unknown): GitCommandError =>
    isGitCommandError(error)
      ? error
      : new GitCommandError({
          operation,
          command: "runner",
          cwd,
          detail: describeCause(error),
          cause: error,
        });

export const toGitManagerServiceError =
  (operation: string, cwd: string) =>
  (error: unknown): GitManagerServiceError =>
    isGitManagerServiceError(error)
      ? error
      : new GitManagerError({ operation, cwd, detail: describeCause(error), cause: error });
