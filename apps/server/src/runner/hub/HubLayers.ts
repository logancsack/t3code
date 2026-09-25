/**
 * HubLayers - services a checkout-less hub substitutes for host-bound ones.
 *
 * Each export replaces one service whose local implementation would stat,
 * read, or run git against a thread checkout that only exists on the runner:
 *
 *   - delegated: CheckpointStore, CheckoutGitProbe, WorkspacePaths root
 *     validation (runner RPCs, same cwd strings).
 *   - stubbed:   RepositoryIdentityResolver (null identity),
 *     WorkspaceEntries (empty index, refresh is a no-op), VcsStatusBroadcaster
 *     (fails; the runner should push status to a hub cache in production).
 *
 * @module runner/hub/HubLayers
 */
import { GitManagerError, VcsRepositoryDetectionError, type VcsError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { CheckpointStore } from "../../checkpointing/CheckpointStore.ts";
import { CheckoutGitProbe } from "../../git/CheckoutGitProbe.ts";
import { RepositoryIdentityResolver } from "../../project/RepositoryIdentityResolver.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import { WorkspaceEntries } from "../../workspace/WorkspaceEntries.ts";
import * as WorkspacePaths from "../../workspace/WorkspacePaths.ts";
import { RunnerClient } from "./RunnerClient.ts";

const describe = (cause: unknown): string =>
  cause && typeof cause === "object" && "message" in cause
    ? String((cause as { message: unknown }).message)
    : String(cause);

const VCS_ERROR_TAGS = new Set([
  "VcsProcessSpawnError",
  "VcsProcessExitError",
  "VcsProcessTimeoutError",
  "VcsProcessStdinWriteError",
  "VcsProcessOutputReadError",
  "VcsProcessOutputLimitError",
  "VcsProcessMissingExitCodeError",
  "VcsRepositoryDetectionError",
  "VcsUnsupportedOperationError",
]);

const toVcsError =
  (operation: string, cwd: string) =>
  (error: { readonly _tag: string }): VcsError =>
    VCS_ERROR_TAGS.has(error._tag)
      ? (error as VcsError)
      : new VcsRepositoryDetectionError({
          operation,
          cwd,
          detail: `runner call failed: ${describe(error)}`,
        });

export const remoteCheckpointStoreLayer = Layer.effect(
  CheckpointStore,
  Effect.gen(function* () {
    const runner = yield* RunnerClient;
    return CheckpointStore.of({
      isGitRepository: (cwd) =>
        runner
          .use((client) => client["runner.checkpoint.isGitRepository"]({ cwd }))
          .pipe(Effect.mapError(toVcsError("CheckpointStore.isGitRepository", cwd))),
      captureCheckpoint: (input) =>
        runner
          .use((client) =>
            client["runner.checkpoint.capture"]({
              cwd: input.cwd,
              checkpointRef: input.checkpointRef,
            }),
          )
          .pipe(Effect.mapError(toVcsError("CheckpointStore.captureCheckpoint", input.cwd))),
      hasCheckpointRef: (input) =>
        runner
          .use((client) =>
            client["runner.checkpoint.hasRef"]({
              cwd: input.cwd,
              checkpointRef: input.checkpointRef,
            }),
          )
          .pipe(Effect.mapError(toVcsError("CheckpointStore.hasCheckpointRef", input.cwd))),
      restoreCheckpoint: (input) =>
        runner
          .use((client) =>
            client["runner.checkpoint.restore"]({
              cwd: input.cwd,
              checkpointRef: input.checkpointRef,
              ...(input.fallbackToHead !== undefined
                ? { fallbackToHead: input.fallbackToHead }
                : {}),
            }),
          )
          .pipe(Effect.mapError(toVcsError("CheckpointStore.restoreCheckpoint", input.cwd))),
      diffCheckpoints: (input) =>
        runner
          .use((client) =>
            client["runner.checkpoint.diff"]({
              cwd: input.cwd,
              fromCheckpointRef: input.fromCheckpointRef,
              toCheckpointRef: input.toCheckpointRef,
              ...(input.fallbackFromToHead !== undefined
                ? { fallbackFromToHead: input.fallbackFromToHead }
                : {}),
              ignoreWhitespace: input.ignoreWhitespace,
            }),
          )
          .pipe(Effect.mapError(toVcsError("CheckpointStore.diffCheckpoints", input.cwd))),
      deleteCheckpointRefs: (input) =>
        runner
          .use((client) =>
            client["runner.checkpoint.deleteRefs"]({
              cwd: input.cwd,
              checkpointRefs: input.checkpointRefs,
            }),
          )
          .pipe(Effect.mapError(toVcsError("CheckpointStore.deleteCheckpointRefs", input.cwd))),
    });
  }),
);

export const remoteCheckoutGitProbeLayer = Layer.effect(
  CheckoutGitProbe,
  Effect.gen(function* () {
    const runner = yield* RunnerClient;
    return (cwd: string) =>
      runner
        .use((client) => client["runner.checkpoint.isGitRepository"]({ cwd }))
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("runner git probe failed; treating checkout as non-git", {
              cwd,
              detail: describe(error),
            }).pipe(Effect.as(false)),
          ),
        );
  }),
);

export const remoteWorkspacePathsLayer = Layer.effect(
  WorkspacePaths.WorkspacePaths,
  Effect.gen(function* () {
    const runner = yield* RunnerClient;
    // Relative-path resolution is pure; only root validation touches disk.
    const local = yield* WorkspacePaths.make;
    return WorkspacePaths.WorkspacePaths.of({
      resolveRelativePathWithinRoot: local.resolveRelativePathWithinRoot,
      normalizeWorkspaceRoot: (workspaceRoot, options) =>
        runner
          .use((client) =>
            client["runner.workspace.normalizeRoot"]({
              workspaceRoot,
              ...(options?.createIfMissing !== undefined
                ? { createIfMissing: options.createIfMissing }
                : {}),
            }),
          )
          .pipe(
            Effect.mapError((error) => {
              if (error._tag === "RunnerWorkspaceError") {
                switch (error.reason) {
                  case "not-exists":
                    return new WorkspacePaths.WorkspaceRootNotExistsError({
                      workspaceRoot,
                      normalizedWorkspaceRoot: workspaceRoot,
                    });
                  case "not-directory":
                    return new WorkspacePaths.WorkspaceRootNotDirectoryError({
                      workspaceRoot,
                      normalizedWorkspaceRoot: workspaceRoot,
                    });
                  case "create-failed":
                    return new WorkspacePaths.WorkspaceRootCreateFailedError({
                      workspaceRoot,
                      normalizedWorkspaceRoot: workspaceRoot,
                      cause: error,
                    });
                  default:
                    break;
                }
              }
              return new WorkspacePaths.WorkspaceRootStatFailedError({
                workspaceRoot,
                normalizedWorkspaceRoot: workspaceRoot,
                phase: "validate-existing",
                cause: error,
              });
            }),
          ),
    });
  }),
);

export const hubWorkspaceEntriesLayer = Layer.succeed(
  WorkspaceEntries,
  WorkspaceEntries.of({
    browse: (input) => Effect.succeed({ parentPath: input.partialPath, entries: [] }),
    list: () => Effect.succeed({ entries: [], truncated: false }),
    search: () => Effect.succeed({ entries: [], truncated: false }),
    searchContents: () => Effect.succeed({ matches: [], truncated: false }),
    refresh: () => Effect.void,
  }),
);

export const hubRepositoryIdentityResolverLayer = Layer.succeed(
  RepositoryIdentityResolver,
  RepositoryIdentityResolver.of({ resolve: () => Effect.succeed(null) }),
);

const vcsStatusUnavailable = (operation: string, cwd: string) =>
  new GitManagerError({
    operation,
    cwd,
    detail: "VCS status lives on the thread's runner and is not delegated in prototype 2.",
  });

export const hubVcsStatusBroadcasterLayer = Layer.succeed(
  VcsStatusBroadcaster,
  VcsStatusBroadcaster.of({
    getStatus: (input) => Effect.fail(vcsStatusUnavailable("getStatus", input.cwd)),
    refreshLocalStatus: (cwd) => Effect.fail(vcsStatusUnavailable("refreshLocalStatus", cwd)),
    refreshStatus: (cwd) => Effect.fail(vcsStatusUnavailable("refreshStatus", cwd)),
    streamStatus: (input) => Stream.fail(vcsStatusUnavailable("streamStatus", input.cwd)),
  }),
);
