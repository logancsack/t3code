/**
 * Branch lists without a machine.
 *
 * A hub project's root (`/workspace/p/<projectId>`) has no checkout, so
 * `vcs.listRefs` on it (drafts, the base-branch picker) is answered from the
 * platform: `GET {T3CODE_HUB_MACHINES_URL}/repositories/refs?url=<repository>`
 * for the project's recorded repository, mapped to the ordinary listRefs
 * result (the default branch marked `isDefault`). A blank project has no
 * repository and lists nothing. A sleeping thread's checkout gets the same
 * listing with the thread's branch marked current, so listing never wakes a
 * machine.
 *
 * Listings are cached per repository for `CACHE_TTL_MS` (the platform caches
 * for 60 s too); `refresh: true` bypasses the cache.
 *
 * @module hub/HubRepositoryRefs
 */
import {
  GitCommandError,
  type VcsListRefsInput,
  type VcsListRefsResult,
  type VcsRef,
} from "@t3tools/contracts";
import type { RepositoryRefsResponse } from "@t3tools/contracts/runner";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import { RepositoryIdentityResolver } from "../project/RepositoryIdentityResolver.ts";
import { MachineDirectory, type MachineDirectoryError } from "./MachineDirectory.ts";

const CACHE_TTL_MS = 30_000;
const DEFAULT_LIMIT = 100;
const REMOTE_NAME = "origin";

/** User-facing detail for the platform's repository-refs error codes. */
const PLATFORM_ERROR_DETAILS: Record<string, string> = {
  REPOSITORY_ACCESS_REQUIRED:
    "Connect this repository to the Aldo GitHub App to list its branches.",
  REPOSITORY_NOT_FOUND: "The repository was not found, or the Aldo GitHub App cannot see it.",
  NOT_HUB_HOSTED: "This workspace does not run threads on thread machines.",
  REPOSITORY_REFS_UNAVAILABLE: "Branches are temporarily unavailable. Try again shortly.",
};

const emptyResult = (isRepo: boolean): VcsListRefsResult => ({
  refs: [],
  isRepo,
  hasPrimaryRemote: isRepo,
  nextCursor: null,
  totalCount: 0,
});

/**
 * Maps a platform listing to a listRefs result: branch names as local refs
 * (or `origin/<name>` remote refs for `refKind: "remote"`), `current` first,
 * then the default branch, filtered by `query` and paginated like a checkout.
 */
export const toListRefsResult = (
  response: RepositoryRefsResponse,
  input: VcsListRefsInput,
  current: string | null,
): VcsListRefsResult => {
  const remote = input.refKind === "remote";
  const names = response.refs.map((ref) => ref.name);
  if (!remote && current !== null && !names.includes(current)) names.unshift(current);
  const refs: Array<VcsRef> = names.map((name) =>
    remote
      ? {
          name: `${REMOTE_NAME}/${name}`,
          isRemote: true,
          remoteName: REMOTE_NAME,
          current: false,
          isDefault: name === response.defaultBranch,
          worktreePath: null,
        }
      : {
          name,
          current: name === current,
          isDefault: name === response.defaultBranch,
          worktreePath: null,
        },
  );
  const priority = (ref: VcsRef) => (ref.current ? 0 : ref.isDefault ? 1 : 2);
  const query = input.query?.toLowerCase();
  const matching = refs
    .toSorted((left, right) => priority(left) - priority(right))
    .filter((ref) => query === undefined || ref.name.toLowerCase().includes(query));
  const cursor = input.cursor ?? 0;
  const page = matching.slice(cursor, cursor + (input.limit ?? DEFAULT_LIMIT));
  return {
    refs: page,
    isRepo: true,
    hasPrimaryRemote: true,
    nextCursor: cursor + page.length < matching.length ? cursor + page.length : null,
    totalCount: matching.length,
  };
};

export const makeRepositoryRefsLister = Effect.gen(function* () {
  const directory = yield* MachineDirectory;
  const repositoryIdentity = yield* RepositoryIdentityResolver;
  const cache = new Map<
    string,
    { readonly at: number; readonly response: RepositoryRefsResponse }
  >();

  const toGitCommandError = (cwd: string) => (error: MachineDirectoryError) =>
    new GitCommandError({
      operation: "listRefs",
      command: "repositories/refs",
      cwd,
      detail:
        (error.code !== undefined ? PLATFORM_ERROR_DETAILS[error.code] : undefined) ??
        `Branches could not be listed: ${error.message}`,
      cause: error,
    });

  const fetchRefs = (url: string, refresh: boolean, cwd: string) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const cached = cache.get(url);
      if (!refresh && cached && now - cached.at < CACHE_TTL_MS) return cached.response;
      const response = yield* directory
        .repositoryRefs(url)
        .pipe(Effect.mapError(toGitCommandError(cwd)));
      cache.set(url, { at: now, response });
      return response;
    });

  /**
   * Branches of the repository recorded for `input.cwd` (a project root, or a
   * thread checkout through its project), with `current` marked. Never wakes a
   * machine. Repositories the platform cannot list (not GitHub) list nothing.
   */
  return (input: VcsListRefsInput, current: string | null) =>
    Effect.gen(function* () {
      const identity = yield* repositoryIdentity.resolve(input.cwd);
      if (identity === null) {
        return current === null
          ? emptyResult(false)
          : toListRefsResult({ defaultBranch: null, refs: [] }, input, current);
      }
      return yield* fetchRefs(identity.locator.remoteUrl, input.refresh === true, input.cwd).pipe(
        Effect.catchIf(
          (error) =>
            (error.cause as MachineDirectoryError | undefined)?.code === "REPOSITORY_UNSUPPORTED",
          () => Effect.succeed({ defaultBranch: null, refs: [] } as RepositoryRefsResponse),
        ),
        Effect.map((response) => toListRefsResult(response, input, current)),
      );
    });
});
