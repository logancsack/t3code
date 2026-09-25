/**
 * Workspace files and checkpoints in hub mode.
 *
 * - `WorkspacePaths` normalizes paths purely; a hub never stats a workspace.
 * - `WorkspaceEntries` / `WorkspaceFileSystem` route to the thread's runner.
 *   Writes wake the machine; listing, search and reads are read-only and use a
 *   running machine only (a sleeping one yields the service's error type with
 *   a `ThreadMachineUnavailableError { reason: "asleep" }` cause). Filesystem
 *   browsing for the project picker has no hub implementation.
 * - `CheckpointStore` captures and restores on the runner and keeps the patch
 *   between checkpoints in `CheckpointTurnDiffStore`. Diffs are served from
 *   that store without waking; only a diff that was never captured wakes the
 *   machine, and the result is stored.
 * - `CheckoutGitProbe`: every thread checkout is a git repository by
 *   construction (`runner.checkout.prepare` clones or initializes it), so the
 *   probe answers from the path alone.
 *
 * @module hub/HubWorkspace
 */
import { type CheckpointRef, ThreadId, type VcsError } from "@t3tools/contracts";
import { HubModeUnsupportedError, parseThreadCheckoutPath } from "@t3tools/contracts/runner";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { CheckpointStore } from "../checkpointing/CheckpointStore.ts";
import { CHECKPOINT_REFS_PREFIX, checkpointRefForThreadTurn } from "../checkpointing/Utils.ts";
import { CheckoutGitProbe } from "../git/CheckoutGitProbe.ts";
import { CheckpointTurnDiffStore } from "../persistence/Services/HubThreadMachineState.ts";
import { fromRunnerRemoteError } from "../runner/remoteErrors.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { describeCause, onCwdRunner, threadOfCwd, toVcsError } from "./hubRouting.ts";
import { RunnerConnectionPool } from "./RunnerConnectionPool.ts";

export const hubWorkspacePathsLayer = Layer.effect(
  WorkspacePaths.WorkspacePaths,
  Effect.gen(function* () {
    // Relative-path resolution is pure; only root validation touches disk.
    const local = yield* WorkspacePaths.make;
    const path = yield* Path.Path;
    return WorkspacePaths.WorkspacePaths.of({
      normalizeWorkspaceRoot: (workspaceRoot) => Effect.succeed(path.resolve(workspaceRoot.trim())),
      resolveRelativePathWithinRoot: local.resolveRelativePathWithinRoot,
    });
  }),
);

const WorkspaceFileErrorSchema = WorkspaceFileSystem.WorkspaceFileSystemError;

export const hubWorkspaceEntriesLayer = Layer.effect(
  WorkspaceEntries.WorkspaceEntries,
  Effect.gen(function* () {
    const pool = yield* RunnerConnectionPool;
    const toEntriesError =
      (cwd: string) =>
      (error: unknown): WorkspaceEntries.WorkspaceEntriesError => {
        const fallback = (cause: unknown) =>
          new WorkspacePaths.WorkspaceRootStatFailedError({
            workspaceRoot: cwd,
            normalizedWorkspaceRoot: cwd,
            phase: "validate-existing",
            cause,
          });
        if (
          error &&
          typeof error === "object" &&
          (error as { _tag?: unknown })._tag === "RunnerRemoteError"
        ) {
          return fromRunnerRemoteError(
            WorkspaceEntries.WorkspaceEntriesError,
            fallback,
          )(error as never);
        }
        return fallback(error);
      };
    const read = (operation: string) => ({ wake: false, operation: `workspace.${operation}` });
    return WorkspaceEntries.WorkspaceEntries.of({
      browse: (input) =>
        Effect.fail(
          new WorkspaceEntries.WorkspaceEntriesReadDirectoryError({
            ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
            partialPath: input.partialPath,
            parentPath: input.partialPath,
            cause: new HubModeUnsupportedError({
              operation: "filesystem.browse",
              detail: "A hub has no filesystem to browse; projects come from repositories.",
            }),
          }),
        ),
      list: (input) =>
        onCwdRunner(pool, input.cwd, read("listEntries"), (client) =>
          client["runner.workspace.listEntries"](input),
        ).pipe(Effect.mapError(toEntriesError(input.cwd))),
      search: (input) =>
        onCwdRunner(pool, input.cwd, read("searchEntries"), (client) =>
          client["runner.workspace.searchEntries"](input),
        ).pipe(Effect.mapError(toEntriesError(input.cwd))),
      searchContents: (input) =>
        onCwdRunner(pool, input.cwd, read("searchContents"), (client) =>
          client["runner.workspace.searchContents"](input),
        ).pipe(Effect.mapError(toEntriesError(input.cwd))),
      // Refreshing the runner's index is only useful while it is connected.
      refresh: (cwd) =>
        threadOfCwd(pool, cwd, "workspace.refreshIndex").pipe(
          Effect.flatMap((threadId) => pool.current(threadId)),
          Effect.flatMap((connection) =>
            Option.isNone(connection)
              ? Effect.void
              : connection.value.client["runner.workspace.refreshIndex"]({ cwd }),
          ),
          Effect.ignore,
        ),
    });
  }),
);

export const hubWorkspaceFileSystemLayer = Layer.effect(
  WorkspaceFileSystem.WorkspaceFileSystem,
  Effect.gen(function* () {
    const pool = yield* RunnerConnectionPool;
    const path = yield* Path.Path;
    const toFileError =
      (
        input: { readonly cwd: string; readonly relativePath: string },
        operation: "open" | "write-file",
      ) =>
      (error: unknown) => {
        const fallback = (cause: unknown) =>
          new WorkspaceFileSystem.WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: path.join(input.cwd, input.relativePath),
            operationPath: input.cwd,
            operation,
            cause,
          });
        if (
          error &&
          typeof error === "object" &&
          (error as { _tag?: unknown })._tag === "RunnerRemoteError"
        ) {
          const decoded = fromRunnerRemoteError(WorkspaceFileErrorSchema, (remote) =>
            remote.errorTag === "WorkspacePathOutsideRootError"
              ? new WorkspacePaths.WorkspacePathOutsideRootError({
                  workspaceRoot: input.cwd,
                  relativePath: input.relativePath,
                })
              : fallback(remote),
          )(error as never);
          return decoded;
        }
        return fallback(error);
      };
    return WorkspaceFileSystem.WorkspaceFileSystem.of({
      readFile: (input) =>
        onCwdRunner(pool, input.cwd, { wake: false, operation: "workspace.readFile" }, (client) =>
          client["runner.workspace.readFile"](input),
        ).pipe(Effect.mapError(toFileError(input, "open"))),
      writeFile: (input) =>
        onCwdRunner(pool, input.cwd, { wake: true, operation: "workspace.writeFile" }, (client) =>
          client["runner.workspace.writeFile"](input),
        ).pipe(Effect.mapError(toFileError(input, "write-file"))),
    });
  }),
);

/** `refs/t3/checkpoints/<base64url thread>/turn/<n>` → thread and turn count. */
export const parseCheckpointRef = (
  ref: CheckpointRef,
): { readonly threadId: ThreadId; readonly turnCount: number } | null => {
  const prefix = `${CHECKPOINT_REFS_PREFIX}/`;
  if (!ref.startsWith(prefix)) return null;
  const match = /^([^/]+)\/turn\/(\d+)$/.exec(ref.slice(prefix.length));
  if (!match) return null;
  const decoded = Encoding.decodeBase64UrlString(match[1]!);
  if (decoded._tag !== "Success" || decoded.success.length === 0) return null;
  return { threadId: ThreadId.make(decoded.success), turnCount: Number(match[2]) };
};

/** Diffs worth having before the machine sleeps: the turn and the whole thread, both whitespace modes. */
const precomputedDiffs = (turnCount: number) =>
  [turnCount - 1, 0]
    .filter((from, index, all) => from >= 0 && from < turnCount && all.indexOf(from) === index)
    .flatMap((fromTurnCount) =>
      [true, false].map((ignoreWhitespace) => ({ fromTurnCount, ignoreWhitespace })),
    );

export const hubCheckpointStoreLayer = Layer.effect(
  CheckpointStore,
  Effect.gen(function* () {
    const pool = yield* RunnerConnectionPool;
    const diffs = yield* CheckpointTurnDiffStore;
    const wake = (operation: string) => ({ wake: true, operation: `checkpoint.${operation}` });

    const ignoreStoreFailure = <A>(effect: Effect.Effect<A, { readonly message: string }>) =>
      effect.pipe(
        Effect.asVoid,
        Effect.catch((error) =>
          Effect.logWarning("checkpoint diff store failed", { detail: error.message }),
        ),
      );
    const invalidateFrom = (threadId: ThreadId, turnCount: number) =>
      ignoreStoreFailure(diffs.invalidateFromTurn({ threadId, turnCount }));

    const diffOnRunner = (
      input: {
        readonly cwd: string;
        readonly fromCheckpointRef: CheckpointRef;
        readonly toCheckpointRef: CheckpointRef;
        readonly fallbackFromToHead?: boolean;
        readonly ignoreWhitespace: boolean;
      },
      wakeMachine: boolean,
    ) =>
      onCwdRunner(pool, input.cwd, { wake: wakeMachine, operation: "checkpoint.diff" }, (client) =>
        client["runner.checkpoint.diff"]({
          cwd: input.cwd,
          fromCheckpointRef: input.fromCheckpointRef,
          toCheckpointRef: input.toCheckpointRef,
          ignoreWhitespace: input.ignoreWhitespace,
          ...(input.fallbackFromToHead !== undefined
            ? { fallbackFromToHead: input.fallbackFromToHead }
            : {}),
        }),
      );

    const storeDiff = (
      key: {
        readonly threadId: ThreadId;
        readonly fromTurnCount: number;
        readonly toTurnCount: number;
        readonly ignoreWhitespace: boolean;
      },
      diff: string,
    ) =>
      DateTime.now.pipe(
        Effect.flatMap((now) =>
          ignoreStoreFailure(diffs.put({ ...key, diff, createdAt: DateTime.formatIso(now) })),
        ),
      );

    /** While the machine is still connected, capture the diffs clients ask for most. */
    const precompute = (cwd: string, threadId: ThreadId, turnCount: number) =>
      Effect.forEach(
        precomputedDiffs(turnCount),
        ({ fromTurnCount, ignoreWhitespace }) =>
          Effect.gen(function* () {
            const key = { threadId, fromTurnCount, toTurnCount: turnCount, ignoreWhitespace };
            const cached = yield* diffs.get(key).pipe(Effect.orElseSucceed(() => Option.none()));
            if (Option.isSome(cached)) return;
            const diff = yield* diffOnRunner(
              {
                cwd,
                fromCheckpointRef: checkpointRefForThreadTurn(threadId, fromTurnCount),
                toCheckpointRef: checkpointRefForThreadTurn(threadId, turnCount),
                ignoreWhitespace,
              },
              false,
            );
            yield* storeDiff(key, diff);
          }).pipe(
            Effect.catch((error) =>
              Effect.logDebug("checkpoint diff precompute skipped", {
                threadId,
                turnCount,
                detail: describeCause(error),
              }),
            ),
          ),
        { discard: true },
      );

    return CheckpointStore.of({
      isGitRepository: (cwd) =>
        Effect.succeed(parseThreadCheckoutPath(cwd, pool.checkoutRoot) !== null),
      captureCheckpoint: (input) =>
        Effect.gen(function* () {
          yield* onCwdRunner(pool, input.cwd, wake("capture"), (client) =>
            client["runner.checkpoint.capture"](input),
          );
          const parsed = parseCheckpointRef(input.checkpointRef);
          if (!parsed) return;
          // A recaptured checkpoint invalidates every diff that read the old one.
          yield* invalidateFrom(parsed.threadId, parsed.turnCount);
          yield* precompute(input.cwd, parsed.threadId, parsed.turnCount).pipe(Effect.forkDetach);
        }).pipe(Effect.mapError(toVcsError("captureCheckpoint", input.cwd))),
      hasCheckpointRef: (input) =>
        onCwdRunner(pool, input.cwd, wake("hasRef"), (client) =>
          client["runner.checkpoint.hasRef"](input),
        ).pipe(Effect.mapError(toVcsError("hasCheckpointRef", input.cwd))),
      restoreCheckpoint: (input) =>
        Effect.gen(function* () {
          const restored = yield* onCwdRunner(pool, input.cwd, wake("restore"), (client) =>
            client["runner.checkpoint.restore"]({
              cwd: input.cwd,
              checkpointRef: input.checkpointRef,
              ...(input.fallbackToHead !== undefined
                ? { fallbackToHead: input.fallbackToHead }
                : {}),
            }),
          );
          const parsed = parseCheckpointRef(input.checkpointRef);
          if (restored && parsed) yield* invalidateFrom(parsed.threadId, parsed.turnCount + 1);
          return restored;
        }).pipe(Effect.mapError(toVcsError("restoreCheckpoint", input.cwd))),
      diffCheckpoints: (input): Effect.Effect<string, VcsError> =>
        Effect.gen(function* () {
          const from = parseCheckpointRef(input.fromCheckpointRef);
          const to = parseCheckpointRef(input.toCheckpointRef);
          const key =
            from && to && from.threadId === to.threadId && input.fallbackFromToHead !== true
              ? {
                  threadId: to.threadId,
                  fromTurnCount: from.turnCount,
                  toTurnCount: to.turnCount,
                  ignoreWhitespace: input.ignoreWhitespace,
                }
              : null;
          if (key) {
            const cached = yield* diffs.get(key).pipe(Effect.orElseSucceed(() => Option.none()));
            if (Option.isSome(cached)) return cached.value;
          }
          // Never captured (or not cacheable): the runner computes it, waking the machine.
          const diff: string = yield* diffOnRunner(input, true);
          if (key) yield* storeDiff(key, diff);
          return diff;
        }).pipe(Effect.mapError(toVcsError("diffCheckpoints", input.cwd))),
      deleteCheckpointRefs: (input) =>
        Effect.gen(function* () {
          yield* onCwdRunner(pool, input.cwd, wake("deleteRefs"), (client) =>
            client["runner.checkpoint.deleteRefs"](input),
          );
          const parsed = input.checkpointRefs.flatMap((ref) => {
            const value = parseCheckpointRef(ref);
            return value ? [value] : [];
          });
          const earliest = parsed.reduce<number | null>(
            (min, value) => (min === null ? value.turnCount : Math.min(min, value.turnCount)),
            null,
          );
          if (earliest !== null && parsed[0]) yield* invalidateFrom(parsed[0].threadId, earliest);
        }).pipe(Effect.mapError(toVcsError("deleteCheckpointRefs", input.cwd))),
    });
  }),
);

/** Thread checkouts are git repositories by construction; no machine is asked. */
export const hubCheckoutGitProbeLayer = Layer.effect(
  CheckoutGitProbe,
  Effect.gen(function* () {
    const pool = yield* RunnerConnectionPool;
    return (cwd: string) =>
      Effect.succeed(parseThreadCheckoutPath(cwd, pool.checkoutRoot) !== null);
  }),
);
