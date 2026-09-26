/**
 * RunnerCheckout - prepares a thread's checkout on its machine.
 *
 * `prepare` is idempotent and cheap when nothing changed, so the hub calls it
 * at bootstrap and before every turn:
 *
 * 1. Missing checkout: clone the project's repository with the machine's own
 *    git configuration and credential helper, or `git init` a blank project.
 * 2. Existing checkout: left as is (local work is never discarded).
 * 3. When `branch` is not checked out: switch to it if it exists locally;
 *    otherwise create it from `origin/<branch>` (a branch pushed from an
 *    earlier machine), else from `baseRef` (remote-tracking first), else HEAD.
 *    A `baseRef` of `HEAD` (`DEFAULT_BRANCH_BASE_REF`) means the repository's
 *    default branch: `origin/HEAD`, which `git remote set-head --auto` fills
 *    in when a clone did not record it.
 *
 * Network access happens only when the checkout is cloned or a branch has to
 * be created, so steady-state calls run two or three local git commands.
 *
 * @module runner/RunnerCheckout
 */
import {
  DEFAULT_BRANCH_BASE_REF,
  RunnerCheckoutError,
  type RunnerPrepareCheckoutInput,
  type RunnerPrepareCheckoutResult,
} from "@t3tools/contracts/runner";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

const CLONE_TIMEOUT_MS = 15 * 60_000;
const FETCH_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_BLANK_BRANCH = "main";

export interface RunnerCheckoutShape {
  readonly prepare: (
    input: RunnerPrepareCheckoutInput,
  ) => Effect.Effect<RunnerPrepareCheckoutResult, RunnerCheckoutError>;
}

export class RunnerCheckout extends Context.Service<RunnerCheckout, RunnerCheckoutShape>()(
  "t3/runner/RunnerCheckout",
) {}

export const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const prepare = Effect.fn("RunnerCheckout.prepare")(function* (
    input: RunnerPrepareCheckoutInput,
  ) {
    const checkout = input.checkout;
    const fail = (operation: string) => (cause: unknown) =>
      new RunnerCheckoutError({
        operation,
        checkout,
        detail:
          cause && typeof cause === "object" && "message" in cause
            ? String((cause as { readonly message: unknown }).message)
            : String(cause),
      });
    const run = (operation: string, cwd: string, args: ReadonlyArray<string>, timeoutMs?: number) =>
      git
        .execute({
          operation: `RunnerCheckout.${operation}`,
          cwd,
          args,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        })
        .pipe(
          Effect.map((result) => result.stdout.trim()),
          Effect.mapError(fail(operation)),
        );
    const probe = (cwd: string, args: ReadonlyArray<string>) =>
      git.execute({ operation: "RunnerCheckout.probe", cwd, args, allowNonZeroExit: true }).pipe(
        Effect.map((result) => (result.exitCode === 0 ? result.stdout.trim() : null)),
        Effect.orElseSucceed(() => null),
      );

    const exists = yield* fileSystem.exists(checkout).pipe(Effect.mapError(fail("stat")));
    const isRepository = exists
      ? yield* fileSystem.exists(path.join(checkout, ".git")).pipe(Effect.mapError(fail("stat")))
      : false;

    let created = false;
    if (!isRepository) {
      const entries = exists
        ? yield* fileSystem.readDirectory(checkout).pipe(Effect.mapError(fail("readDirectory")))
        : [];
      if (input.repository !== null) {
        if (entries.length > 0) {
          return yield* new RunnerCheckoutError({
            operation: "clone",
            checkout,
            detail: "The checkout directory exists, is not empty, and is not a git repository.",
          });
        }
        const parent = path.dirname(checkout);
        yield* fileSystem
          .makeDirectory(parent, { recursive: true })
          .pipe(Effect.mapError(fail("makeDirectory")));
        if (exists) {
          yield* fileSystem.remove(checkout).pipe(Effect.mapError(fail("removeEmptyCheckout")));
        }
        yield* run(
          "clone",
          parent,
          ["clone", "--origin", "origin", input.repository.url, checkout],
          CLONE_TIMEOUT_MS,
        );
      } else {
        yield* fileSystem
          .makeDirectory(checkout, { recursive: true })
          .pipe(Effect.mapError(fail("makeDirectory")));
        yield* run("init", checkout, [
          "init",
          `--initial-branch=${input.branch ?? DEFAULT_BLANK_BRANCH}`,
        ]);
      }
      created = true;
    }

    const currentBranch = () => probe(checkout, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const hasOrigin = (yield* probe(checkout, ["remote", "get-url", "origin"])) !== null;
    const refExists = (ref: string) =>
      probe(checkout, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).pipe(
        Effect.map((sha) => sha !== null),
      );

    /** `origin`'s default branch as a remote-tracking ref, recording it when missing. */
    const defaultBranchRefs = (withOrigin: boolean) =>
      Effect.gen(function* () {
        if (!withOrigin) return [];
        const readDefault = probe(checkout, [
          "symbolic-ref",
          "--quiet",
          "refs/remotes/origin/HEAD",
        ]);
        const recorded =
          (yield* readDefault) ??
          (yield* probe(checkout, ["remote", "set-head", "origin", "--auto"]).pipe(
            Effect.andThen(readDefault),
          ));
        return recorded === null ? [] : [recorded];
      });

    if (input.branch !== null && (yield* currentBranch()) !== input.branch) {
      const branch = input.branch;
      if (yield* refExists(`refs/heads/${branch}`)) {
        yield* run("switchBranch", checkout, ["checkout", branch]);
      } else {
        if (hasOrigin && !created) {
          yield* run("fetch", checkout, ["fetch", "--prune", "origin"], FETCH_TIMEOUT_MS);
        }
        const baseCandidates =
          input.baseRef === null
            ? []
            : input.baseRef === DEFAULT_BRANCH_BASE_REF
              ? yield* defaultBranchRefs(hasOrigin)
              : [...(hasOrigin ? [`refs/remotes/origin/${input.baseRef}`] : []), input.baseRef];
        const candidates = [
          ...(hasOrigin ? [`refs/remotes/origin/${branch}`] : []),
          ...baseCandidates,
          "HEAD",
        ];
        let startPoint: string | null = null;
        for (const candidate of candidates) {
          if (yield* refExists(candidate)) {
            startPoint = candidate;
            break;
          }
        }
        yield* startPoint === null
          ? // An empty repository has no commit to branch from; point HEAD at the branch.
            run("createUnbornBranch", checkout, ["symbolic-ref", "HEAD", `refs/heads/${branch}`])
          : run("createBranch", checkout, ["checkout", "-b", branch, startPoint]);
      }
    }

    return {
      checkout,
      isRepository: true,
      branch: yield* currentBranch(),
      headCommit: yield* probe(checkout, ["rev-parse", "--verify", "--quiet", "HEAD"]),
      created,
    } satisfies RunnerPrepareCheckoutResult;
  });

  return RunnerCheckout.of({ prepare });
});

export const layer = Layer.effect(RunnerCheckout, make);
