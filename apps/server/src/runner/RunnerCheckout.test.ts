// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { afterEach, describe, expect } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { RunnerCheckout, layer as RunnerCheckoutLayer } from "./RunnerCheckout.ts";

const git = (cwd: string, args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", ...args],
    { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
  ).trim();

const tempDirs: Array<string> = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

/** A bare "origin" with `main` and a pushed `feature/existing` branch. */
const makeOrigin = () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "runner-checkout-test-"));
  tempDirs.push(root);
  const source = NodePath.join(root, "source");
  const bare = NodePath.join(root, "origin.git");
  NodeFS.mkdirSync(source);
  git(source, ["init", "--initial-branch=main"]);
  NodeFS.writeFileSync(NodePath.join(source, "README.md"), "hello\n");
  git(source, ["add", "."]);
  git(source, ["commit", "-m", "initial"]);
  git(source, ["checkout", "-b", "feature/existing"]);
  NodeFS.writeFileSync(NodePath.join(source, "feature.txt"), "feature\n");
  git(source, ["add", "."]);
  git(source, ["commit", "-m", "feature"]);
  git(root, ["clone", "--bare", source, bare]);
  return {
    root,
    url: `file://${bare}`,
    mainHead: git(source, ["rev-parse", "main"]),
    featureHead: git(source, ["rev-parse", "feature/existing"]),
  };
};

const TestLayer = RunnerCheckoutLayer.pipe(
  Layer.provide(GitVcsDriver.layer),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-runner-checkout-" })),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);

const threadId = ThreadId.make("thread-checkout");

describe("RunnerCheckout", () => {
  it.effect("clones, creates the thread branch from the base ref, and is idempotent", () =>
    Effect.gen(function* () {
      const origin = makeOrigin();
      const checkout = NodePath.join(origin.root, "t", threadId);
      const runner = yield* RunnerCheckout;
      const input = {
        threadId,
        checkout,
        repository: { url: origin.url, ref: "main" },
        branch: "t3/work",
        baseRef: "main",
      };

      const first = yield* runner.prepare(input);
      expect(first).toEqual({
        checkout,
        isRepository: true,
        branch: "t3/work",
        headCommit: origin.mainHead,
        created: true,
      });

      // Local work in the checkout survives later prepares.
      NodeFS.writeFileSync(NodePath.join(checkout, "work.txt"), "in progress\n");
      const second = yield* runner.prepare(input);
      expect(second).toEqual({ ...first, created: false });
      expect(NodeFS.readFileSync(NodePath.join(checkout, "work.txt"), "utf8")).toBe(
        "in progress\n",
      );
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("continues a branch that was already pushed from an earlier machine", () =>
    Effect.gen(function* () {
      const origin = makeOrigin();
      const checkout = NodePath.join(origin.root, "t", threadId);
      const result = yield* (yield* RunnerCheckout).prepare({
        threadId,
        checkout,
        repository: { url: origin.url, ref: null },
        branch: "feature/existing",
        baseRef: "main",
      });
      expect(result.branch).toBe("feature/existing");
      expect(result.headCommit).toBe(origin.featureHead);
      expect(git(checkout, ["rev-parse", "--abbrev-ref", "@{upstream}"])).toBe(
        "origin/feature/existing",
      );
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("branches from the repository's default branch for the HEAD base ref", () =>
    Effect.gen(function* () {
      const origin = makeOrigin();
      // The origin's default branch is main; the clone checks out a work branch first.
      git(origin.root, ["--git-dir", "origin.git", "symbolic-ref", "HEAD", "refs/heads/main"]);
      const checkout = NodePath.join(origin.root, "t", threadId);
      const runner = yield* RunnerCheckout;
      yield* runner.prepare({
        threadId,
        checkout,
        repository: { url: origin.url, ref: null },
        branch: "feature/existing",
        baseRef: null,
      });

      const fromDefault = yield* runner.prepare({
        threadId,
        checkout,
        repository: { url: origin.url, ref: null },
        branch: "t3/from-default",
        baseRef: "HEAD",
      });
      expect(fromDefault.branch).toBe("t3/from-default");
      expect(fromDefault.headCommit).toBe(origin.mainHead);

      // A checkout without a recorded origin/HEAD learns it from the remote.
      git(checkout, ["remote", "set-head", "origin", "--delete"]);
      git(origin.root, [
        "--git-dir",
        "origin.git",
        "symbolic-ref",
        "HEAD",
        "refs/heads/feature/existing",
      ]);
      const learned = yield* runner.prepare({
        threadId,
        checkout,
        repository: { url: origin.url, ref: null },
        branch: "t3/from-learned-default",
        baseRef: "HEAD",
      });
      expect(learned.headCommit).toBe(origin.featureHead);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("initializes a blank project without a repository", () =>
    Effect.gen(function* () {
      const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "runner-checkout-blank-"));
      tempDirs.push(root);
      const checkout = NodePath.join(root, "t", threadId);
      const result = yield* (yield* RunnerCheckout).prepare({
        threadId,
        checkout,
        repository: null,
        branch: "t3/blank",
        baseRef: null,
      });
      expect(result).toEqual({
        checkout,
        isRepository: true,
        branch: "t3/blank",
        headCommit: null,
        created: true,
      });
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("refuses to clone over a non-empty directory that is not a repository", () =>
    Effect.gen(function* () {
      const origin = makeOrigin();
      const checkout = NodePath.join(origin.root, "t", threadId);
      NodeFS.mkdirSync(checkout, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(checkout, "stray.txt"), "keep me\n");
      const error = yield* (yield* RunnerCheckout)
        .prepare({
          threadId,
          checkout,
          repository: { url: origin.url, ref: null },
          branch: null,
          baseRef: null,
        })
        .pipe(Effect.flip);
      expect(error._tag).toBe("RunnerCheckoutError");
      expect(NodeFS.readFileSync(NodePath.join(checkout, "stray.txt"), "utf8")).toBe("keep me\n");
    }).pipe(Effect.provide(TestLayer)),
  );
});
