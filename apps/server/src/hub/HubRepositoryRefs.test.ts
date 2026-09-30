import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  type OrchestrationThreadShell,
  ProjectId,
  type RepositoryIdentity,
  ThreadId,
} from "@t3tools/contracts";
import { projectVirtualRoot, threadCheckoutPath } from "@t3tools/contracts/runner";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { describe, expect } from "vite-plus/test";

import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { HubThreadMachineStateSqliteLive } from "../persistence/Layers/HubThreadMachineState.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { RepositoryIdentityResolver } from "../project/RepositoryIdentityResolver.ts";
import { toListRefsResult } from "./HubRepositoryRefs.ts";
import { hubGitWorkflowServiceLayer, hubVcsStatusCacheLayer } from "./HubVcs.ts";
import { MachineDirectory, makeFakeMachineDirectory } from "./MachineDirectory.ts";
import { make as makePool, RunnerConnectionPool } from "./RunnerConnectionPool.ts";

const REPO = "https://github.com/acme/widgets";
const repoProject = ProjectId.make("project-repo");
const blankProject = ProjectId.make("project-blank");
const lockedProject = ProjectId.make("project-locked");
const gitlabProject = ProjectId.make("project-gitlab");
const sleepingThread = ThreadId.make("thread-sleeping");

const listing = {
  defaultBranch: "main",
  refs: [
    { name: "main", sha: "a1" },
    { name: "develop", sha: "b2" },
    { name: "feature/login", sha: "c3" },
  ],
  truncated: false,
};

const identity = (url: string): RepositoryIdentity => ({
  canonicalKey: url,
  locator: { source: "git-remote", remoteName: "origin", remoteUrl: url },
});

const identities: Record<string, RepositoryIdentity> = {
  [projectVirtualRoot(repoProject)]: identity(REPO),
  [projectVirtualRoot(lockedProject)]: identity("https://github.com/acme/locked"),
  [projectVirtualRoot(gitlabProject)]: identity("https://gitlab.com/acme/widgets"),
  [threadCheckoutPath(sleepingThread)]: identity(REPO),
};

const setup = Effect.gen(function* () {
  const fake = yield* makeFakeMachineDirectory({
    initial: [[sleepingThread, { state: "paused" }]],
    repositories: {
      [REPO]: listing,
      "https://github.com/acme/locked": { status: 403, code: "REPOSITORY_ACCESS_REQUIRED" },
      "https://gitlab.com/acme/widgets": { status: 422, code: "REPOSITORY_UNSUPPORTED" },
    },
  });
  const context = yield* Layer.build(
    hubGitWorkflowServiceLayer.pipe(
      Layer.provideMerge(hubVcsStatusCacheLayer),
      Layer.provideMerge(
        Layer.effect(
          RunnerConnectionPool,
          makePool({ wakePollInterval: "5 millis", idleCheckInterval: "1 hour" }),
        ),
      ),
      Layer.provideMerge(Layer.succeed(MachineDirectory, fake.directory)),
      Layer.provide(
        Layer.succeed(RepositoryIdentityResolver, {
          resolve: (cwd: string) => Effect.succeed(identities[cwd] ?? null),
        }),
      ),
      Layer.provide(
        Layer.succeed(
          ProjectionSnapshotQuery,
          ProjectionSnapshotQuery.of({
            getThreadShellById: (threadId: ThreadId) =>
              Effect.succeed(
                threadId === sleepingThread
                  ? Option.some({
                      id: threadId,
                      branch: "t3/unpushed",
                    } as unknown as OrchestrationThreadShell)
                  : Option.none(),
              ),
          } as unknown as ProjectionSnapshotQuery["Service"]),
        ),
      ),
    ),
  );
  const workflow = yield* GitWorkflowService.GitWorkflowService.pipe(Effect.provide(context));
  return { workflow, fake };
});

const TestLayer = HubThreadMachineStateSqliteLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(NodeServices.layer),
);

describe("hub repository refs", () => {
  it("maps a platform listing to listRefs results", () => {
    const all = toListRefsResult(listing, { cwd: "/workspace/p/x" }, null);
    expect(all.refs.map((ref) => [ref.name, ref.isDefault, ref.current])).toEqual([
      ["main", true, false],
      ["develop", false, false],
      ["feature/login", false, false],
    ]);
    expect(all).toMatchObject({ isRepo: true, hasPrimaryRemote: true, totalCount: 3 });

    const current = toListRefsResult(listing, { cwd: "/workspace/t/x" }, "t3/unpushed");
    expect(current.refs.slice(0, 2).map((ref) => [ref.name, ref.current])).toEqual([
      ["t3/unpushed", true],
      ["main", false],
    ]);

    const page = toListRefsResult(
      listing,
      { cwd: "/workspace/p/x", query: "E", limit: 1, cursor: 1 },
      null,
    );
    expect(page.refs.map((ref) => ref.name)).toEqual(["feature/login"]);
    expect(page).toMatchObject({ totalCount: 2, nextCursor: null });

    const remote = toListRefsResult(listing, { cwd: "/workspace/p/x", refKind: "remote" }, "x");
    expect(remote.refs[0]).toMatchObject({
      name: "origin/main",
      isRemote: true,
      remoteName: "origin",
      isDefault: true,
    });
  });

  it.effect("lists project branches from the platform, cached, without any machine", () =>
    Effect.gen(function* () {
      const { workflow, fake } = yield* setup;
      const cwd = projectVirtualRoot(repoProject);
      const first = yield* workflow.listRefs({ cwd });
      expect(first.refs.find((ref) => ref.isDefault)?.name).toBe("main");
      yield* workflow.listRefs({ cwd, query: "dev" });
      yield* workflow.listRefs({ cwd, refresh: true });
      expect(yield* fake.platformCalls).toEqual([
        `repositoryRefs ${REPO}`,
        `repositoryRefs ${REPO}`,
      ]);
      expect(yield* fake.calls).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect("answers blank, unsupported and unauthorized repositories", () =>
    Effect.gen(function* () {
      const { workflow } = yield* setup;
      expect(yield* workflow.listRefs({ cwd: projectVirtualRoot(blankProject) })).toEqual({
        refs: [],
        isRepo: false,
        hasPrimaryRemote: false,
        nextCursor: null,
        totalCount: 0,
      });
      expect(
        (yield* workflow.listRefs({ cwd: projectVirtualRoot(gitlabProject) })).totalCount,
      ).toBe(0);
      const locked = yield* workflow
        .listRefs({ cwd: projectVirtualRoot(lockedProject) })
        .pipe(Effect.flip);
      expect(locked._tag).toBe("GitCommandError");
      expect(locked.message).toContain("Aldo GitHub App");
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect("lists a sleeping thread's branches without waking its machine", () =>
    Effect.gen(function* () {
      const { workflow, fake } = yield* setup;
      const result = yield* workflow.listRefs({ cwd: threadCheckoutPath(sleepingThread) });
      expect(result.refs[0]).toMatchObject({ name: "t3/unpushed", current: true });
      expect(result.refs.some((ref) => ref.name === "main" && ref.isDefault)).toBe(true);
      expect((yield* fake.calls).map((call) => call.method)).toEqual(["status"]);
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );
});
