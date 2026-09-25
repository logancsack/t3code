/**
 * Git, VCS status and review in hub mode.
 *
 * Status is served from a hub cache that runners keep current: while a
 * thread's machine is connected, the hub subscribes to its runner's status
 * stream and stores every update (memory plus `ThreadVcsStatusStore`), so
 * sidebar rows, branch drift and auto-settlement read status without waking
 * machines. Refreshes use the runner only when it is already connected.
 *
 * Git actions (pull, commit/push/PR stacked actions, refs, worktrees, init,
 * PR thread preparation) run on the thread's runner and wake its machine.
 * Read-only git and review calls never wake a machine; on a sleeping machine
 * they fail with the service's error type caused by a `ThreadMachineUnavailableError`
 * whose reason is `asleep`.
 *
 * @module hub/HubVcs
 */
import {
  GitManagerError,
  type GitManagerServiceError,
  type GitRunStackedActionResult,
  type ThreadId,
  type VcsStatusLocalResult,
  type VcsStatusRemoteResult,
  type VcsStatusResult,
  type VcsStatusStreamEvent,
} from "@t3tools/contracts";
import { ThreadMachineUnavailableError } from "@t3tools/contracts/runner";
import { mergeGitStatusParts } from "@t3tools/shared/git";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as GitManager from "../git/GitManager.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import { ThreadVcsStatusStore } from "../persistence/Services/HubThreadMachineState.ts";
import * as ReviewService from "../review/ReviewService.ts";
import * as VcsProvisioningService from "../vcs/VcsProvisioningService.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import {
  describeCause,
  onCwdRunner,
  streamOnCwdRunner,
  threadOfCwd,
  toGitCommandError,
  toGitManagerServiceError,
  toVcsError,
} from "./hubRouting.ts";
import { RunnerConnectionPool } from "./RunnerConnectionPool.ts";

const isThreadMachineUnavailable: (error: unknown) => error is ThreadMachineUnavailableError =
  Schema.is(ThreadMachineUnavailableError);

interface CachedStatus {
  readonly local: VcsStatusLocalResult;
  readonly remote: VcsStatusRemoteResult | null;
}

interface CachedStatusEvent {
  readonly threadId: ThreadId;
  readonly event: VcsStatusStreamEvent;
}

export interface HubVcsStatusCacheShape {
  readonly get: (threadId: ThreadId) => Effect.Effect<Option.Option<CachedStatus>>;
  readonly apply: (threadId: ThreadId, event: VcsStatusStreamEvent) => Effect.Effect<void>;
  /** Cached status first (when known), then live updates for the thread. */
  readonly stream: (threadId: ThreadId) => Stream.Stream<VcsStatusStreamEvent>;
  /** The PR of any thread whose checkout is on `branch`. */
  readonly pullRequestForBranch: (
    branch: string,
  ) => Effect.Effect<VcsStatusRemoteResult["pr"] | null>;
  readonly remove: (threadId: ThreadId) => Effect.Effect<void>;
}

export class HubVcsStatusCache extends Context.Service<HubVcsStatusCache, HubVcsStatusCacheShape>()(
  "t3/hub/HubVcs/HubVcsStatusCache",
) {}

export const makeHubVcsStatusCache = Effect.gen(function* () {
  const pool = yield* RunnerConnectionPool;
  const store = yield* ThreadVcsStatusStore;
  const cache = new Map<ThreadId, CachedStatus>();
  const changes = yield* PubSub.unbounded<CachedStatusEvent>();

  const seed = yield* Effect.cached(
    store.list().pipe(
      Effect.map((rows) => {
        for (const row of rows) {
          if (!cache.has(row.threadId)) {
            cache.set(row.threadId, { local: row.local, remote: row.remote });
          }
        }
      }),
      Effect.catch((error) =>
        Effect.logWarning("hub git status cache could not load persisted status", {
          detail: error.message,
        }),
      ),
    ),
  );

  const apply: HubVcsStatusCacheShape["apply"] = (threadId, event) =>
    Effect.gen(function* () {
      yield* seed;
      const current = cache.get(threadId);
      let next: CachedStatus | undefined;
      switch (event._tag) {
        case "snapshot":
          next = { local: event.local, remote: event.remote };
          break;
        case "localUpdated":
          next = { local: event.local, remote: current?.remote ?? null };
          break;
        case "remoteUpdated":
          next = current ? { local: current.local, remote: event.remote } : undefined;
          break;
      }
      if (next) {
        cache.set(threadId, next);
        yield* store
          .put({
            threadId,
            local: next.local,
            remote: next.remote,
            updatedAt: DateTime.formatIso(yield* DateTime.now),
          })
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("hub git status cache write failed", {
                threadId,
                detail: error.message,
              }),
            ),
          );
      }
      yield* PubSub.publish(changes, { threadId, event });
    });

  // While a machine is connected its runner pushes status into the cache.
  yield* pool.onConnection((connection) =>
    connection.client["runner.vcs.streamStatus"]({
      cwd: pool.checkoutFor(connection.threadId),
    }).pipe(
      Stream.runForEach((event) => apply(connection.threadId, event)),
      Effect.catch((error) =>
        Effect.logDebug("runner git status stream ended", {
          threadId: connection.threadId,
          detail: describeCause(error),
        }),
      ),
    ),
  );

  return HubVcsStatusCache.of({
    get: (threadId) => seed.pipe(Effect.map(() => Option.fromNullishOr(cache.get(threadId)))),
    apply,
    stream: (threadId) =>
      Stream.unwrap(
        Effect.gen(function* () {
          yield* seed;
          // Subscribe before reading the cache so no update falls in between.
          const subscription = yield* PubSub.subscribe(changes);
          const cached = cache.get(threadId);
          const initial: ReadonlyArray<VcsStatusStreamEvent> = cached
            ? [{ _tag: "snapshot", local: cached.local, remote: cached.remote }]
            : [];
          return Stream.concat(
            Stream.fromIterable(initial),
            Stream.fromSubscription(subscription).pipe(
              Stream.filter((change) => change.threadId === threadId),
              Stream.map((change) => change.event),
            ),
          );
        }),
      ),
    pullRequestForBranch: (branch) =>
      seed.pipe(
        Effect.map(
          () =>
            [...cache.values()].find(
              (status) => status.local.refName === branch && status.remote?.pr,
            )?.remote?.pr ?? null,
        ),
      ),
    remove: (threadId) =>
      Effect.gen(function* () {
        cache.delete(threadId);
        yield* store.remove(threadId).pipe(Effect.ignore);
      }),
  });
});

export const hubVcsStatusCacheLayer = Layer.effect(HubVcsStatusCache, makeHubVcsStatusCache);

const asleepStatusError = (operation: string, cwd: string, cause: ThreadMachineUnavailableError) =>
  new GitManagerError({
    operation,
    cwd,
    detail: `No cached git status and ${cause.message}`,
    cause,
  });

/** `VcsStatusBroadcaster` over the hub cache; refreshes use a connected runner only. */
export const hubVcsStatusBroadcasterLayer = Layer.effect(
  VcsStatusBroadcaster.VcsStatusBroadcaster,
  Effect.gen(function* () {
    const pool = yield* RunnerConnectionPool;
    const cache = yield* HubVcsStatusCache;

    const cachedOr = <A, E>(
      operation: string,
      cwd: string,
      select: (cached: CachedStatus) => A,
      live: Effect.Effect<A, E>,
    ): Effect.Effect<A, GitManagerServiceError> =>
      threadOfCwd(pool, cwd, operation).pipe(
        Effect.flatMap((threadId) =>
          live.pipe(
            Effect.catch(
              (error): Effect.Effect<A, E | GitManagerError> =>
                isThreadMachineUnavailable(error)
                  ? cache
                      .get(threadId)
                      .pipe(
                        Effect.flatMap((cached) =>
                          Option.isSome(cached)
                            ? Effect.succeed(select(cached.value))
                            : Effect.fail(asleepStatusError(operation, cwd, error)),
                        ),
                      )
                  : Effect.fail(error),
            ),
          ),
        ),
        Effect.mapError(toGitManagerServiceError(operation, cwd)),
      );

    const mergedStatus = (cached: CachedStatus): VcsStatusResult =>
      mergeGitStatusParts(cached.local, cached.remote);

    return VcsStatusBroadcaster.VcsStatusBroadcaster.of({
      getStatus: (input) =>
        cachedOr(
          "getStatus",
          input.cwd,
          mergedStatus,
          threadOfCwd(pool, input.cwd, "getStatus").pipe(
            Effect.flatMap((threadId) => cache.get(threadId)),
            Effect.flatMap((cached) =>
              Option.isSome(cached)
                ? Effect.succeed(mergedStatus(cached.value))
                : onCwdRunner(pool, input.cwd, { wake: false, operation: "getStatus" }, (client) =>
                    client["runner.vcs.status"](input),
                  ),
            ),
          ),
        ),
      refreshStatus: (cwd) =>
        cachedOr(
          "refreshStatus",
          cwd,
          mergedStatus,
          onCwdRunner(pool, cwd, { wake: false, operation: "refreshStatus" }, (client) =>
            client["runner.vcs.refreshStatus"]({ cwd }),
          ),
        ),
      refreshLocalStatus: (cwd) =>
        cachedOr(
          "refreshLocalStatus",
          cwd,
          (cached) => cached.local,
          onCwdRunner(pool, cwd, { wake: false, operation: "refreshLocalStatus" }, (client) =>
            client["runner.vcs.refreshLocalStatus"]({ cwd }),
          ),
        ),
      streamStatus: (input) =>
        Stream.unwrap(
          threadOfCwd(pool, input.cwd, "streamStatus").pipe(
            Effect.map((threadId) => cache.stream(threadId)),
            Effect.mapError(toGitManagerServiceError("streamStatus", input.cwd)),
          ),
        ),
    });
  }),
);

/** Git workflow on the thread's runner. Actions wake the machine; reads do not. */
export const hubGitWorkflowServiceLayer = Layer.effect(
  GitWorkflowService.GitWorkflowService,
  Effect.gen(function* () {
    const pool = yield* RunnerConnectionPool;
    const cache = yield* HubVcsStatusCache;
    const wake = (operation: string) => ({ wake: true, operation: `git.${operation}` });
    const read = (operation: string) => ({ wake: false, operation: `git.${operation}` });
    const cachedFallback = <A, E>(
      operation: string,
      cwd: string,
      select: (cached: CachedStatus) => A,
      live: Effect.Effect<A, E>,
    ) =>
      live.pipe(
        Effect.catch(
          (error): Effect.Effect<A, E | GitManagerError | ThreadMachineUnavailableError> =>
            isThreadMachineUnavailable(error)
              ? threadOfCwd(pool, cwd, operation).pipe(
                  Effect.flatMap((threadId) => cache.get(threadId)),
                  Effect.flatMap((cached) =>
                    Option.isSome(cached)
                      ? Effect.succeed(select(cached.value))
                      : Effect.fail(asleepStatusError(operation, cwd, error)),
                  ),
                )
              : Effect.fail(error),
        ),
        Effect.mapError(toGitManagerServiceError(operation, cwd)),
      );
    const forwardInvalidate = (cwd: string, operation: string) =>
      threadOfCwd(pool, cwd, operation).pipe(
        Effect.flatMap((threadId) => pool.current(threadId)),
        Effect.flatMap((connection) =>
          Option.isNone(connection)
            ? Effect.void
            : connection.value.client["runner.vcs.refreshStatus"]({ cwd }).pipe(Effect.asVoid),
        ),
        Effect.ignore,
      );

    return GitWorkflowService.GitWorkflowService.of({
      status: (input) =>
        cachedFallback(
          "status",
          input.cwd,
          (cached) => mergeGitStatusParts(cached.local, cached.remote),
          onCwdRunner(pool, input.cwd, read("status"), (client) =>
            client["runner.vcs.status"](input),
          ),
        ),
      localStatus: (input) =>
        cachedFallback(
          "localStatus",
          input.cwd,
          (cached) => cached.local,
          onCwdRunner(pool, input.cwd, read("localStatus"), (client) =>
            client["runner.vcs.localStatus"](input),
          ),
        ),
      remoteStatus: (input) =>
        cachedFallback(
          "remoteStatus",
          input.cwd,
          (cached) => cached.remote,
          onCwdRunner(pool, input.cwd, read("remoteStatus"), (client) =>
            client["runner.vcs.remoteStatus"](input),
          ),
        ),
      invalidateLocalStatus: (cwd) => forwardInvalidate(cwd, "invalidateLocalStatus"),
      invalidateRemoteStatus: (cwd) => forwardInvalidate(cwd, "invalidateRemoteStatus"),
      invalidateStatus: (cwd) => forwardInvalidate(cwd, "invalidateStatus"),
      pullCurrentBranch: (cwd) =>
        onCwdRunner(pool, cwd, wake("pull"), (client) => client["runner.git.pull"]({ cwd })).pipe(
          Effect.mapError(toGitCommandError("pullCurrentBranch", cwd)),
        ),
      runStackedAction: (input, options) =>
        streamOnCwdRunner(pool, input.cwd, wake("runStackedAction"), (client) =>
          client["runner.git.runStackedAction"](input),
        ).pipe(
          Stream.runFoldEffect(
            (): GitRunStackedActionResult | null => null,
            (result, event) =>
              event._tag === "progress"
                ? (options?.progressReporter?.publish(event.event) ?? Effect.void).pipe(
                    Effect.as(result),
                  )
                : Effect.succeed(event.result),
          ),
          Effect.flatMap((result) =>
            result === null
              ? Effect.fail(
                  new GitManagerError({
                    operation: "runStackedAction",
                    cwd: input.cwd,
                    detail: "The runner ended the action without a result.",
                  }),
                )
              : Effect.succeed(result),
          ),
          Effect.mapError(toGitManagerServiceError("runStackedAction", input.cwd)),
        ),
      resolvePullRequest: (input) =>
        onCwdRunner(pool, input.cwd, wake("resolvePullRequest"), (client) =>
          client["runner.git.resolvePullRequest"](input),
        ).pipe(Effect.mapError(toGitManagerServiceError("resolvePullRequest", input.cwd))),
      preparePullRequestThread: (input) =>
        onCwdRunner(pool, input.cwd, wake("preparePullRequestThread"), (client) =>
          client["runner.git.preparePullRequestThread"](input),
        ).pipe(Effect.mapError(toGitManagerServiceError("preparePullRequestThread", input.cwd))),
      listRefs: (input) =>
        onCwdRunner(pool, input.cwd, read("listRefs"), (client) =>
          client["runner.git.listRefs"](input),
        ).pipe(Effect.mapError(toGitCommandError("listRefs", input.cwd))),
      createWorktree: (input) =>
        onCwdRunner(pool, input.cwd, wake("createWorktree"), (client) =>
          client["runner.git.createWorktree"](input),
        ).pipe(Effect.mapError(toGitCommandError("createWorktree", input.cwd))),
      fetchRemote: (input) =>
        onCwdRunner(pool, input.cwd, wake("fetchRemote"), (client) =>
          client["runner.git.fetchRemote"](input),
        ).pipe(Effect.mapError(toGitCommandError("fetchRemote", input.cwd))),
      remoteExists: (input) =>
        onCwdRunner(pool, input.cwd, wake("remoteExists"), (client) =>
          client["runner.git.remoteExists"](input),
        ).pipe(Effect.mapError(toGitCommandError("remoteExists", input.cwd))),
      resolveRemoteTrackingCommit: (input) =>
        onCwdRunner(pool, input.cwd, wake("resolveRemoteTrackingCommit"), (client) =>
          client["runner.git.resolveRemoteTrackingCommit"](input),
        ).pipe(Effect.mapError(toGitCommandError("resolveRemoteTrackingCommit", input.cwd))),
      removeWorktree: (input) =>
        onCwdRunner(pool, input.cwd, wake("removeWorktree"), (client) =>
          client["runner.git.removeWorktree"](input),
        ).pipe(Effect.mapError(toGitCommandError("removeWorktree", input.cwd))),
      pruneWorktrees: (input) =>
        onCwdRunner(pool, input.cwd, wake("pruneWorktrees"), (client) =>
          client["runner.git.pruneWorktrees"](input),
        ).pipe(Effect.mapError(toGitCommandError("pruneWorktrees", input.cwd))),
      createRef: (input) =>
        onCwdRunner(pool, input.cwd, wake("createRef"), (client) =>
          client["runner.git.createRef"](input),
        ).pipe(Effect.mapError(toGitCommandError("createRef", input.cwd))),
      switchRef: (input) =>
        onCwdRunner(pool, input.cwd, wake("switchRef"), (client) =>
          client["runner.git.switchRef"](input),
        ).pipe(Effect.mapError(toGitCommandError("switchRef", input.cwd))),
      renameBranch: (input) =>
        onCwdRunner(pool, input.cwd, wake("renameBranch"), (client) =>
          client["runner.git.renameBranch"](input),
        ).pipe(Effect.mapError(toGitManagerServiceError("renameBranch", input.cwd))),
    });
  }),
);

/**
 * `GitManager` in hub mode serves only the automatic settlement sweep, from
 * the status cache; every other operation goes through `GitWorkflowService`.
 */
export const hubGitManagerLayer = Layer.effect(
  GitManager.GitManager,
  Effect.gen(function* () {
    const workflow = yield* GitWorkflowService.GitWorkflowService;
    const cache = yield* HubVcsStatusCache;
    return GitManager.GitManager.of({
      status: workflow.status,
      localStatus: workflow.localStatus,
      remoteStatus: (input) => workflow.remoteStatus(input),
      branchPullRequest: ({ branch }) =>
        cache
          .pullRequestForBranch(branch)
          .pipe(
            Effect.map((pr) => (pr ? { state: pr.state, updatedAt: pr.updatedAt ?? null } : null)),
          ),
      invalidateLocalStatus: workflow.invalidateLocalStatus,
      invalidateRemoteStatus: workflow.invalidateRemoteStatus,
      invalidateStatus: workflow.invalidateStatus,
      resolvePullRequest: workflow.resolvePullRequest,
      preparePullRequestThread: workflow.preparePullRequestThread,
      runStackedAction: workflow.runStackedAction,
    });
  }),
);

export const hubVcsProvisioningServiceLayer = Layer.effect(
  VcsProvisioningService.VcsProvisioningService,
  Effect.gen(function* () {
    const pool = yield* RunnerConnectionPool;
    return VcsProvisioningService.VcsProvisioningService.of({
      initRepository: (input) =>
        onCwdRunner(pool, input.cwd, { wake: true, operation: "vcs.init" }, (client) =>
          client["runner.vcs.init"](input),
        ).pipe(Effect.mapError(toVcsError("initRepository", input.cwd))),
    });
  }),
);

/** Review diffs are read-only: served by a running machine, never waking one. */
export const hubReviewServiceLayer = Layer.effect(
  ReviewService.ReviewService,
  Effect.gen(function* () {
    const pool = yield* RunnerConnectionPool;
    return ReviewService.ReviewService.of({
      getDiffPreview: (input) =>
        onCwdRunner(
          pool,
          input.cwd,
          { wake: false, operation: "review.getDiffPreview" },
          (client) => client["runner.review.getDiffPreview"](input),
        ).pipe(Effect.mapError(toVcsError("getDiffPreview", input.cwd))),
      getDiffFileContents: (input) =>
        onCwdRunner(
          pool,
          input.cwd,
          { wake: false, operation: "review.getDiffFileContents" },
          (client) => client["runner.review.getDiffFileContents"](input),
        ).pipe(Effect.mapError(toVcsError("getDiffFileContents", input.cwd))),
    });
  }),
);
