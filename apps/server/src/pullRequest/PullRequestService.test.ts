import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as KeyValueStore from "effect/unstable/persistence/KeyValueStore";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import type {
  OrchestrationProjectShell,
  ProjectId,
  PullRequestReviewCapabilities,
  PullRequestReviewerCapabilities,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import { PullRequestOperationError } from "@t3tools/contracts";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as PullRequestFilesViewed from "../persistence/PullRequestFilesViewed.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as SourceControlRateLimit from "../sourceControl/SourceControlRateLimit.ts";
import { ForgejoCli } from "../sourceControl/ForgejoCli.ts";
import * as ForgejoPullRequestProvider from "./ForgejoPullRequestProvider.ts";
import {
  PullRequestProviderError,
  type ProviderChangeRequest,
  type PullRequestProviderApi,
} from "./PullRequestProvider.ts";
import { PullRequestProviderRegistry, fromProviders } from "./PullRequestProviderRegistry.ts";
import * as PullRequestService from "./PullRequestService.ts";
import * as PullRequestReadCache from "./PullRequestReadCache.ts";

function project(input: {
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly repository?: string;
  readonly provider?: string;
  readonly host?: string;
  readonly remoteUrl?: string;
}): OrchestrationProjectShell {
  // The host defaults from the provider, so a fixture only names one when the point of the
  // test is two hosts of the same kind.
  const host = input.host ?? (input.provider === "gitlab" ? "gitlab.com" : "github.com");
  return {
    id: input.id as ProjectId,
    title: input.title,
    workspaceRoot: input.workspaceRoot,
    ...(input.repository
      ? {
          repositoryIdentity: {
            canonicalKey: `${host}/${input.repository}`,
            locator: {
              source: "git-remote" as const,
              remoteName: "origin",
              remoteUrl: input.remoteUrl ?? `https://${host}/${input.repository}.git`,
            },
            provider: input.provider ?? "github",
            displayName: input.repository,
          },
        }
      : {}),
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  };
}

function changeRequest(number: number, updatedAt: string): ProviderChangeRequest {
  return {
    number,
    title: `Change request ${number}`,
    url: `https://host/pull/${number}`,
    author: { login: "octocat", name: null, avatarUrl: null },
    headBranch: `feat/${number}`,
    baseBranch: "main",
    state: "open",
    isDraft: false,
    mergeability: "mergeable",
    additions: 1,
    deletions: 0,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt,
    reviewRequestLogins: [],
    labels: [],
  };
}

function hostedChangeRequest(body: string, additions = 1) {
  return {
    ...changeRequest(1, "2026-07-02T00:00:00Z"),
    body,
    additions,
    changedFiles: 2,
    mergedAt: null,
    closedAt: null,
    reviewers: [],
    checks: [],
    mergeCapabilities: { merge: true, squash: true, rebase: true },
    viewerPermissions: {
      actions: ["merge"] as const,
      comment: true,
      resolve: true,
      verdicts: ["comment", "approve", "request-changes"] as const,
      requestReviewers: true,
    },
  };
}

it.effect("keeps cached previews available and pauses uncached previews until quota resets", () =>
  Effect.gen(function* () {
    let reads = 0;
    const retryAt = Date.parse("2099-08-13T14:00:00Z");
    const service = yield* makeService({
      projects: [project({ id: "p1", title: "web", workspaceRoot: "/w", repository: "acme/web" })],
      providers: [
        fakeProvider("github", {
          getChangeRequestPreview: ({ number }) =>
            Effect.gen(function* () {
              reads++;
              if (reads === 2)
                return yield* new PullRequestProviderError({
                  provider: "github",
                  operation: "getChangeRequestPreview",
                  reason: "rate-limited",
                  detail: "GitHub requests are paused until the rate limit resets.",
                  retryAt,
                });
              return changeRequest(number, "2026-07-02T00:00:00Z");
            }),
        }),
      ],
    });
    const ref = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };
    yield* service.preview(ref);
    const limited = yield* Effect.flip(service.preview({ ...ref, number: 2 }));
    assert.instanceOf(limited, PullRequestOperationError);
    if (limited._tag !== "PullRequestOperationError") return;
    assert.include(limited.detail, "paused");
    assert.strictEqual((yield* service.preview(ref)).number, 1);
    for (const number of [2, 3, 4]) {
      const paused = yield* Effect.flip(service.preview({ ...ref, number }));
      assert.instanceOf(paused, PullRequestOperationError);
      if (paused._tag !== "PullRequestOperationError") return;
      assert.include(paused.detail, "paused");
    }
    assert.strictEqual(reads, 2);
    yield* TestClock.setTime(retryAt);
    assert.strictEqual((yield* service.preview({ ...ref, number: 2 })).number, 2);
    assert.strictEqual(reads, 3);
  }),
);

const requestFailed = new PullRequestProviderError({
  provider: "github",
  operation: "listChangeRequests",
  reason: "failed",
  detail: "HTTP 404",
});

/** Everything a host could offer, so a fixture only narrows what its own test is about. */
const FULL_REVIEW: PullRequestReviewCapabilities = {
  inlineComment: true,
  reply: true,
  resolve: true,
  verdicts: ["comment", "approve", "request-changes"],
};

const FULL_REVIEWERS: PullRequestReviewerCapabilities = { request: true, listCandidates: true };

/** A provider whose every call is supplied by the test; anything unset succeeds emptily. */
function fakeProvider(
  kind: SourceControlProviderKind,
  overrides: Partial<PullRequestProviderApi> = {},
): PullRequestProviderApi {
  return {
    kind,
    capabilities: {
      diff: true,
      comment: true,
      actions: ["merge", "ready", "draft", "close", "reopen"],
      mergeMethods: ["merge"],
      search: true,
      reactions: true,
      review: FULL_REVIEW,
      reviewers: FULL_REVIEWERS,
      edit: { changeRequest: true, comment: true },
    },
    getViewer: () => Effect.succeed("bilal"),
    // A viewer who may do everything the host can, so a test only narrows what it is about.
    getViewerPermissions: () =>
      Effect.succeed({
        actions: ["merge", "ready", "draft", "close", "reopen"],
        comment: true,
        resolve: true,
        verdicts: ["comment", "approve", "request-changes"],
        requestReviewers: true,
      }),
    listChangeRequests: () => Effect.succeed({ items: [], truncated: false, continues: true }),
    getChangeRequest: () => Effect.die("unused"),
    getChangeRequestActivity: () => Effect.die("unused"),
    getDiff: () => Effect.die("unused"),
    runAction: () => Effect.void,
    updateChangeRequest: () => Effect.void,
    comment: () => Effect.void,
    updateComment: () => Effect.void,
    submitReview: () => Effect.void,
    replyToThread: () => Effect.void,
    setThreadResolution: () => Effect.void,
    setReaction: () => Effect.void,
    listReviewerCandidates: () => Effect.succeed({ candidates: [], truncated: false }),
    setReviewerRequest: () => Effect.void,
    ...overrides,
  };
}

function makeService(input: {
  readonly projects: ReadonlyArray<OrchestrationProjectShell>;
  readonly providers: ReadonlyArray<PullRequestProviderApi>;
  readonly resolveHandle?: SourceControlProviderRegistry.SourceControlProviderRegistry["Service"]["resolveHandle"];
}) {
  // Built into the test's own scope rather than provided call by call: the marks store owns a
  // database, and `Effect.provide` would close it the moment the service was handed back.
  return Effect.flatMap(
    Layer.build(
      Layer.mergeAll(
        Layer.succeed(PullRequestProviderRegistry, fromProviders(input.providers)),
        Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
          resolveLink: () => undefined,
          resolveHandle:
            input.resolveHandle ?? (() => Effect.die("Unexpected provider refinement")),
        }),
        Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
          getProjectShells: (projectIds) =>
            Effect.succeed(
              input.projects.filter((project) => projectIds?.includes(project.id) ?? true),
            ),
          getProjectShellById: (projectId) =>
            Effect.succeed(Option.fromNullishOr(input.projects.find((p) => p.id === projectId))),
        }),
        SourceControlRateLimit.layer,
        // The real store over a database of its own, so the environment-kept marks are exercised
        // through the SQL that holds them rather than through a stand-in that agrees with itself.
        PullRequestFilesViewed.layer.pipe(Layer.provide(SqlitePersistenceMemory)),
        Layer.effect(PullRequestReadCache.PullRequestReadCache, PullRequestReadCache.make).pipe(
          Layer.provide(KeyValueStore.layerMemory),
          Layer.provide(NodeServices.layer),
        ),
      ),
    ),
    (context) => Effect.provideContext(PullRequestService.make, context),
  );
}

it.effect("uses a provider's raw cursor advance when it consumed malformed rows", () =>
  Effect.gen(function* () {
    const service = yield* makeService({
      projects: [
        project({
          id: "p1",
          title: "web",
          workspaceRoot: "/a",
          repository: "acme/web",
          provider: "azure-devops",
          host: "dev.azure.com",
        }),
      ],
      providers: [
        fakeProvider("azure-devops", {
          listChangeRequests: () =>
            Effect.succeed({
              items: [changeRequest(7, "2026-07-02T00:00:00Z")],
              truncated: true,
              cursorAdvance: 4,
              continues: true,
            }),
        }),
      ],
    });

    const result = yield* service.list({ state: "open" });

    // Keyed by the selector Azure is actually asked with, which is the repository's own name.
    assert.deepStrictEqual(result.nextCursors, {
      "dev.azure.com dev.azure.com/acme/web": "2026-07-02T00:00:00Z|4|7",
    });
  }),
);

it.effect("keeps a row already sent at the boundary instant from arriving twice", () =>
  Effect.gen(function* () {
    const service = yield* makeService({
      projects: [
        project({ id: "p1", title: "t3code", workspaceRoot: "/a", repository: "pingdotgg/t3code" }),
      ],
      providers: [
        fakeProvider("github", {
          // The boundary instant is asked for inclusively, so the host hands back the rows
          // already sent at it alongside the ones beside them — which a strictly-older read
          // would have lost instead.
          listChangeRequests: () =>
            Effect.succeed({
              items: [
                changeRequest(7, "2026-07-02T00:00:00Z"),
                changeRequest(8, "2026-07-02T00:00:00Z"),
                changeRequest(9, "2026-07-01T00:00:00Z"),
              ],
              truncated: true,
              continues: true,
            }),
        }),
      ],
    });

    const result = yield* service.list({
      state: "open",
      cursors: { "github.com pingdotgg/t3code": "2026-07-02T00:00:00Z|1|7" },
    });

    assert.deepStrictEqual(
      result.entries.map((entry) => entry.number),
      [8, 9],
    );
    assert.deepStrictEqual(result.nextCursors, {
      "github.com pingdotgg/t3code": "2026-07-01T00:00:00Z|3|9",
    });
  }),
);

it.effect("refuses a continuation it did not issue, before asking any host anything", () =>
  Effect.gen(function* () {
    const service = yield* makeService({
      projects: [
        project({ id: "p1", title: "t3code", workspaceRoot: "/a", repository: "pingdotgg/t3code" }),
      ],
      providers: [
        fakeProvider("github", { listChangeRequests: () => Effect.die("should not be read") }),
      ],
    });

    const error = yield* Effect.flip(
      service.list({ state: "open", cursors: { "github.com pingdotgg/t3code": "yesterday" } }),
    );

    assert.strictEqual(error._tag, "PullRequestOperationError");
    assert.strictEqual(
      error.message,
      "Pull request operation list failed: The list could not be carried on from where it left off.",
    );
  }),
);

it.effect("routing verifies the current account on the requested host without caching it", () =>
  Effect.gen(function* () {
    let viewer = "first-account";
    const service = yield* makeService({
      projects: [
        project({
          id: "p1",
          title: "web",
          workspaceRoot: "/a",
          repository: "acme/web",
          host: "github.example.test",
        }),
      ],
      providers: [
        fakeProvider("github", {
          getRoutingIdentity: (input) => {
            assert.deepStrictEqual(input, { cwd: "/a", host: "github.example.test" });
            return Effect.succeed({
              viewer,
              accountId: viewer === "first-account" ? "123" : "456",
            });
          },
        }),
      ],
    });
    const ref = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };
    assert.deepStrictEqual(yield* service.routing(ref), {
      host: "github.example.test",
      provider: "github",
      viewer: "first-account",
      accountId: "123",
      projectTitle: "web",
      workspaceRoot: "/a",
    });
    viewer = "second-account";
    assert.strictEqual((yield* service.routing(ref)).viewer, "second-account");
    viewer = " ";
    const failure = yield* service.routing(ref).pipe(Effect.flip);
    assert.strictEqual(failure._tag, "PullRequestOperationError");
    if (failure._tag === "PullRequestOperationError") {
      assert.strictEqual(failure.operation, "routeIdentity");
    }
  }),
);

it.effect("refuses an action the host never claimed it could run", () =>
  Effect.gen(function* () {
    let ran = false;
    const service = yield* makeService({
      projects: [project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" })],
      providers: [
        fakeProvider("github", {
          capabilities: {
            diff: true,
            comment: true,
            // Bitbucket's shape: it can merge and close, but cannot reopen.
            actions: ["merge", "close"],
            mergeMethods: ["merge"],
            search: true,
            reactions: true,
            review: FULL_REVIEW,
            reviewers: FULL_REVIEWERS,
          },
          runAction: () => {
            ran = true;
            return Effect.void;
          },
        }),
      ],
    });

    const error = yield* Effect.flip(
      service.runAction({
        projectId: "p1" as ProjectId,
        repository: "acme/web",
        number: 1,
        action: "reopen",
      }),
    );

    assert.strictEqual(error._tag, "PullRequestOperationError");
    assert.isFalse(ran);
  }),
);

it.effect("publishes a merge for immediate settlement only after host confirmation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const mergedAt = "2026-09-03T02:00:00.000Z";
      let state: "open" | "merged" = "open";
      let confirmationFails = false;
      const reference = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };
      const service = yield* makeService({
        projects: [
          project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" }),
        ],
        providers: [
          fakeProvider("github", {
            getChangeRequestSummary: () =>
              confirmationFails
                ? Effect.fail(
                    new PullRequestProviderError({
                      provider: "github",
                      operation: "getChangeRequestSummary",
                      reason: "failed",
                      detail: "HTTP 504",
                    }),
                  )
                : Effect.succeed({ ...changeRequest(1, mergedAt), state }),
          }),
        ],
      });
      const merges = yield* service.subscribeMerges;
      const observedMerge = yield* Stream.runHead(merges).pipe(
        Effect.forkChild({ startImmediately: true }),
      );

      // Queueing succeeds while the host still reports an open PR.
      yield* service.runAction({ ...reference, action: "merge" });
      const queuedRefresh = Option.getOrThrow(yield* Stream.runHead(service.subscribeRefreshes));
      confirmationFails = true;
      yield* service.runAction({ ...reference, action: "merge" });
      assert.isAbove(
        Option.getOrThrow(yield* Stream.runHead(service.subscribeRefreshes)),
        queuedRefresh,
      );
      confirmationFails = false;
      state = "merged";
      yield* TestClock.setTime(Date.parse(mergedAt));
      yield* service.runAction({
        ...reference,
        repository: " ACME/WEB ",
        action: "merge",
        mergeMethod: "merge",
      });

      assert.deepStrictEqual(Option.getOrThrow(yield* Fiber.join(observedMerge)), {
        ...reference,
        mergedAt,
      });
    }),
  ),
);

it.effect("refuses an action this viewer may not take, and says what access it takes", () =>
  Effect.gen(function* () {
    let ran: string | null = null;
    const service = yield* makeService({
      projects: [project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" })],
      providers: [
        fakeProvider("github", {
          // The host merges; this account only reads it, and opened the change request — which
          // is every contributor to a repository they do not own.
          getViewerPermissions: () =>
            Effect.succeed({
              actions: ["ready", "draft", "close", "reopen"],
              comment: true,
              resolve: true,
              verdicts: ["comment", "approve", "request-changes"],
              requestReviewers: false,
            }),
          runAction: (input) => {
            ran = input.action;
            return Effect.void;
          },
        }),
      ],
    });
    const reference = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };

    const error = yield* Effect.flip(service.runAction({ ...reference, action: "merge" }));
    assert.strictEqual(error._tag, "PullRequestOperationError");
    assert.include(error.message, "You need write access on this repository to merge.");
    assert.strictEqual(ran, null);

    // What the author keeps whatever their access is still theirs to take.
    yield* service.runAction({ ...reference, action: "close" });
    assert.strictEqual(ran, "close");
  }),
);

it.effect("gates arming a merge for later exactly as it gates merging now", () =>
  Effect.gen(function* () {
    let ranWith: { readonly action: string; readonly mergeMethod?: string } | null = null;
    const service = yield* makeService({
      projects: [project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" })],
      providers: [
        fakeProvider("github", {
          capabilities: {
            diff: true,
            comment: true,
            actions: ["merge", "close", "enable-auto-merge", "disable-auto-merge"],
            mergeMethods: ["merge", "squash"],
            search: true,
            reactions: true,
            review: FULL_REVIEW,
            reviewers: FULL_REVIEWERS,
          },
          // This account may close the change request it opened, and nothing else here.
          getViewerPermissions: () =>
            Effect.succeed({
              actions: ["close"],
              comment: true,
              resolve: true,
              verdicts: ["comment", "approve", "request-changes"],
              requestReviewers: false,
            }),
          runAction: (input) => {
            ranWith = {
              action: input.action,
              ...(input.mergeMethod === undefined ? {} : { mergeMethod: input.mergeMethod }),
            };
            return Effect.void;
          },
        }),
      ],
    });
    const reference = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };

    const refused = yield* Effect.flip(
      service.runAction({ ...reference, action: "enable-auto-merge", mergeMethod: "squash" }),
    );
    assert.strictEqual(refused._tag, "PullRequestOperationError");
    assert.include(refused.message, "merged for you once it is ready");
    assert.strictEqual(ranWith, null);

    // The strategy is checked against the host for an armed merge too: a merge it performs
    // later is still a merge, and one it cannot spell must not be passed on.
    const wrongStrategy = yield* Effect.flip(
      service.runAction({ ...reference, action: "enable-auto-merge", mergeMethod: "rebase" }),
    );
    assert.strictEqual(wrongStrategy._tag, "PullRequestOperationError");
    assert.strictEqual(ranWith, null);
  }),
);

it.effect("refuses an auto-merge the host never claimed, without asking it", () =>
  Effect.gen(function* () {
    let ran = false;
    const service = yield* makeService({
      projects: [project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" })],
      providers: [
        // Bitbucket's shape: it merges, and has nothing that merges later on its own.
        fakeProvider("github", {
          runAction: () => {
            ran = true;
            return Effect.void;
          },
        }),
      ],
    });

    const error = yield* Effect.flip(
      service.runAction({
        projectId: "p1" as ProjectId,
        repository: "acme/web",
        number: 1,
        action: "enable-auto-merge",
      }),
    );

    assert.strictEqual(error._tag, "PullRequestOperationError");
    assert.isFalse(ran);
  }),
);

it.effect("refuses to resolve a conversation this viewer may not, without asking the host", () =>
  Effect.gen(function* () {
    const service = yield* makeService({
      projects: [project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" })],
      providers: [
        fakeProvider("github", {
          getViewerPermissions: () =>
            Effect.succeed({
              actions: ["merge", "ready", "draft", "close", "reopen"],
              comment: true,
              resolve: false,
              verdicts: ["comment", "approve", "request-changes"],
              requestReviewers: true,
            }),
          setThreadResolution: () => Effect.die("must not be called"),
        }),
      ],
    });

    const error = yield* Effect.flip(
      service.setThreadResolution({
        projectId: "p1" as ProjectId,
        repository: "acme/web",
        number: 1,
        threadId: "t1",
        resolved: true,
      }),
    );

    assert.strictEqual(error._tag, "PullRequestOperationError");
    assert.include(error.message, "to resolve a review conversation.");
  }),
);

it.effect("keeps two hosts of one provider kind as two accounts", () =>
  Effect.gen(function* () {
    const viewerFor: Record<string, string> = { "/cloud": "bilal", "/enterprise": "b.hassan" };
    const service = yield* makeService({
      projects: [
        project({ id: "p1", title: "cloud", workspaceRoot: "/cloud", repository: "acme/web" }),
        project({
          id: "p2",
          title: "enterprise",
          workspaceRoot: "/enterprise",
          // The same path on a different host: neither the viewer nor the row may be shared.
          repository: "acme/web",
          host: "github.acme.dev",
        }),
      ],
      providers: [
        fakeProvider("github", {
          getViewer: (input) => Effect.succeed(viewerFor[input.cwd] ?? "unknown"),
          listChangeRequests: () =>
            Effect.succeed({
              items: [changeRequest(1, "2026-07-02T00:00:00Z")],
              truncated: false,
              continues: true,
            }),
        }),
      ],
    });

    const result = yield* service.list({ state: "open" });

    // Both repositories survive de-duplication, each with its own account.
    assert.strictEqual(result.entries.length, 2);
    assert.deepStrictEqual(result.viewers, {
      "github.com": "bilal",
      "github.acme.dev": "b.hassan",
    });
    assert.deepStrictEqual(result.entries.map((entry) => entry.host).toSorted(), [
      "github.acme.dev",
      "github.com",
    ]);
  }),
);

it.effect("stops new reads after a rate limit while leaving manual actions available", () =>
  Effect.gen(function* () {
    let listCalls = 0;
    let actionCalls = 0;
    const service = yield* makeService({
      projects: [
        project({ id: "p1", title: "cloud", workspaceRoot: "/cloud", repository: "acme/web" }),
      ],
      providers: [
        fakeProvider("github", {
          listChangeRequests: () =>
            Effect.sync(() => {
              listCalls += 1;
            }).pipe(
              Effect.andThen(
                Effect.fail(
                  new PullRequestProviderError({
                    provider: "github",
                    operation: "listChangeRequests",
                    reason: "rate-limited",
                    detail: "GitHub API rate limit exceeded.",
                  }),
                ),
              ),
            ),
          runAction: () =>
            Effect.sync(() => {
              actionCalls += 1;
            }),
        }),
      ],
    });

    const first = yield* service.list({ state: "open", involvement: "all" });
    const paused = yield* service.list({ state: "open", involvement: "authored" });
    yield* service.runAction({
      projectId: "p1" as ProjectId,
      repository: "acme/web",
      number: 1,
      action: "close",
    });

    assert.strictEqual(listCalls, 1);
    assert.strictEqual(actionCalls, 1);
    assert.lengthOf(first.errors, 1);
    assert.lengthOf(paused.errors, 1);
  }),
);

it.effect("refuses a repository that does not belong to the requested project", () =>
  Effect.gen(function* () {
    const service = yield* makeService({
      projects: [
        project({ id: "p1", title: "t3code", workspaceRoot: "/a", repository: "pingdotgg/t3code" }),
      ],
      providers: [fakeProvider("github")],
    });

    const error = yield* service
      .diff({ projectId: "p1" as ProjectId, repository: "attacker/repo", number: 1 })
      .pipe(Effect.flip);

    assert.strictEqual(error._tag, "PullRequestOperationError");
  }),
);

it.effect("routes explicit Forgejo HTTP authorities through SSH checkouts after refinement", () =>
  Effect.gen(function* () {
    for (const provider of ["forgejo", "unknown"] as const) {
      const seen: string[] = [];
      const viewers: Array<string | undefined> = [];
      const service = yield* makeService({
        projects: [
          project({
            id: "ssh",
            title: "ssh",
            workspaceRoot: "/ssh",
            repository: "team/repo",
            provider,
            host: "ssh.code.example",
            remoteUrl: "git@ssh.code.example:team/repo.git",
          }),
        ],
        providers: [
          fakeProvider("forgejo", {
            getViewer: (input) => {
              viewers.push(input.host);
              assert.strictEqual(input.host, "code.example:3000");
              return Effect.succeed("bilal");
            },
            listChangeRequests: (input) => {
              assert.strictEqual(input.host, "code.example:3000");
              return Effect.succeed({ items: [], truncated: false, continues: true });
            },
            getChangeRequest: (input) => {
              assert.strictEqual(input.host, "code.example:3000");
              return Effect.succeed({ ...hostedChangeRequest("Forgejo detail"), number: 42 });
            },
            getChangeRequestSummary: (input) =>
              Effect.sync(() => {
                seen.push(input.host);
                return changeRequest(42, "2026-07-02T00:00:00Z");
              }),
          }),
        ],
        resolveHandle: ({ context }) => {
          if (context?.requestedHost === undefined) {
            return Effect.succeed({ context: context!, provider: undefined as never });
          }
          assert.strictEqual(context.requestedHost, "code.example:3000");
          return Effect.succeed({
            context: {
              ...context,
              provider: { kind: "forgejo", name: "Forgejo", baseUrl: "http://code.example:3000" },
            },
            provider: undefined as never,
          });
        },
      });
      yield* service.summary(
        {
          projectId: "ssh" as ProjectId,
          host: "code.example:3000",
          repository: "team/repo",
          number: 42,
        },
        { recoverTransientFailure: false },
      );
      assert.deepStrictEqual(seen, ["code.example:3000"]);
      const listed = yield* service.list({
        projectId: "ssh" as ProjectId,
        host: "code.example:3000",
        state: "open",
      });
      assert.strictEqual(listed.viewers["code.example:3000"], "bilal");
      const preview = yield* service.preview({
        projectId: "ssh" as ProjectId,
        host: "code.example:3000",
        repository: "team/repo",
        number: 42,
      });
      assert.strictEqual(preview.number, 42);
      const detail = yield* service.detail({
        projectId: "ssh" as ProjectId,
        host: "code.example:3000",
        repository: "team/repo",
        number: 42,
      });
      assert.strictEqual(detail.body, "Forgejo detail");
      assert.deepStrictEqual(viewers, ["code.example:3000"]);
    }
  }),
);

it.effect("rejects a different Forgejo HTTP port for an HTTP checkout", () =>
  Effect.gen(function* () {
    const service = yield* makeService({
      projects: [
        project({
          id: "http",
          title: "http",
          workspaceRoot: "/http",
          repository: "team/repo",
          provider: "forgejo",
          host: "code.example",
          remoteUrl: "http://code.example:4000/team/repo.git",
        }),
      ],
      providers: [fakeProvider("forgejo")],
    });
    const failure = yield* service
      .summary(
        {
          projectId: "http" as ProjectId,
          host: "code.example:3000",
          repository: "team/repo",
          number: 42,
        },
        { recoverTransientFailure: false },
      )
      .pipe(Effect.flip);
    assert.strictEqual(failure._tag, "PullRequestUnavailableError");
  }),
);

it.effect("routes Azure reads and writes through the requested organization's checkout", () =>
  Effect.gen(function* () {
    const seen: string[] = [];
    const service = yield* makeService({
      projects: ["org-a", "org-b"].map((organization) =>
        project({
          id: organization,
          title: organization,
          workspaceRoot: `/${organization}`,
          repository: `${organization}/project/_git/web`,
          provider: "azure-devops",
          host: "dev.azure.com",
        }),
      ),
      providers: [
        fakeProvider("azure-devops", {
          getChangeRequestSummary: (input) =>
            Effect.sync(() => {
              seen.push(`read ${input.cwd} ${input.repository}`);
              return changeRequest(7, "2026-07-02T00:00:00Z");
            }),
          runAction: (input) =>
            Effect.sync(() => {
              seen.push(`write ${input.cwd} ${input.repository}`);
            }),
        }),
      ],
    });
    const reference = {
      projectId: "org-a" as ProjectId,
      host: "dev.azure.com",
      repository: "org-b/project/_git/web",
      number: 7,
    };
    yield* service.summary(reference, { recoverTransientFailure: false });
    yield* service.runAction({ ...reference, action: "merge" });
    assert.deepStrictEqual(seen, ["read /org-b web", "write /org-b web", "read /org-b web"]);
  }),
);

for (const checkout of [
  {
    host: "ssh.dev.azure.com",
    repository: "v3/org-b/project/web",
    remoteUrl: "git@ssh.dev.azure.com:v3/org-b/project/web",
  },
  {
    host: "vs-ssh.visualstudio.com",
    repository: "v3/org-b/project/web",
    remoteUrl: "git@vs-ssh.visualstudio.com:v3/org-b/project/web",
  },
  {
    host: "org-b.visualstudio.com",
    repository: "DefaultCollection/project/_git/web",
    remoteUrl: "https://org-b.visualstudio.com/DefaultCollection/project/_git/web",
  },
]) {
  it.effect(`routes Azure URL reads and writes through a ${checkout.host} checkout`, () =>
    Effect.gen(function* () {
      const seen: string[] = [];
      const target = project({
        id: "target",
        title: "target",
        workspaceRoot: "/target",
        provider: "azure-devops",
        ...checkout,
      });
      const service = yield* makeService({
        projects: [
          ...["org-a/project/_git/web", "org-b/other-project/_git/web"].map((repository) =>
            project({
              id: repository,
              title: repository,
              workspaceRoot: `/${repository}`,
              provider: "azure-devops",
              host: "dev.azure.com",
              repository,
            }),
          ),
          target,
        ],
        providers: [
          fakeProvider("azure-devops", {
            getChangeRequestSummary: (input) =>
              Effect.sync(() => {
                seen.push(`read ${input.cwd} ${input.repository}`);
                return changeRequest(7, "2026-07-02T00:00:00Z");
              }),
            runAction: (input) =>
              Effect.sync(() => {
                seen.push(`write ${input.cwd} ${input.repository}`);
              }),
          }),
        ],
      });
      const reference = {
        projectId: "org-a/project/_git/web" as ProjectId,
        host: "dev.azure.com",
        repository: "org-b/project/_git/web",
        number: 7,
      };
      yield* service.summary(reference, { recoverTransientFailure: false });
      yield* service.runAction({ ...reference, action: "merge" });
      assert.deepStrictEqual(seen, ["read /target web", "write /target web", "read /target web"]);
    }),
  );
}

it.effect("refuses Azure cross-organization reads and writes without its checkout", () =>
  Effect.gen(function* () {
    const service = yield* makeService({
      projects: [
        project({
          id: "org-a",
          title: "org-a",
          workspaceRoot: "/org-a",
          repository: "org-a/project/_git/web",
          provider: "azure-devops",
          host: "dev.azure.com",
        }),
      ],
      providers: [
        fakeProvider("azure-devops", {
          getChangeRequestSummary: () => Effect.die("must not read the wrong organization"),
          runAction: () => Effect.die("must not modify the wrong organization"),
        }),
      ],
    });
    const reference = {
      projectId: "org-a" as ProjectId,
      host: "dev.azure.com",
      repository: "org-b/project/_git/web",
      number: 7,
    };
    const readError = yield* Effect.flip(
      service.summary(reference, { recoverTransientFailure: false }),
    );
    const writeError = yield* Effect.flip(service.runAction({ ...reference, action: "close" }));
    assert.strictEqual(readError._tag, "PullRequestUnavailableError");
    assert.strictEqual(writeError._tag, "PullRequestUnavailableError");
  }),
);

it.effect("refuses a hosted reference when nothing is checked out from that host", () =>
  Effect.gen(function* () {
    const service = yield* makeService({
      projects: [
        project({ id: "frontend", title: "web", workspaceRoot: "/web", repository: "acme/web" }),
      ],
      providers: [fakeProvider("github")],
    });

    const error = yield* service
      .summary(
        {
          projectId: "frontend" as ProjectId,
          host: "gitlab.com",
          repository: "acme/api",
          number: 7,
        },
        { recoverTransientFailure: false },
      )
      .pipe(Effect.flip);

    assert.strictEqual(error._tag, "PullRequestUnavailableError");
  }),
);

it.effect("refuses a verdict the host never claimed, without asking the provider", () =>
  Effect.gen(function* () {
    let submitted = false;
    const service = yield* makeService({
      projects: [
        project({
          id: "p1",
          title: "on gitlab",
          workspaceRoot: "/a",
          repository: "group/project",
          provider: "gitlab",
        }),
      ],
      providers: [
        fakeProvider("gitlab", {
          capabilities: {
            diff: true,
            comment: true,
            actions: ["merge"],
            mergeMethods: ["merge"],
            search: true,
            reactions: true,
            // GitLab's shape: it approves, and has nothing that rejects.
            review: {
              inlineComment: true,
              reply: true,
              resolve: true,
              verdicts: ["comment", "approve"],
            },
            reviewers: FULL_REVIEWERS,
          },
          submitReview: () => {
            submitted = true;
            return Effect.void;
          },
        }),
      ],
    });

    const error = yield* Effect.flip(
      service.submitReview({
        projectId: "p1" as ProjectId,
        repository: "group/project",
        number: 1,
        verdict: "request-changes",
        body: "no",
        comments: [],
      }),
    );

    assert.strictEqual(error._tag, "PullRequestOperationError");
    assert.isFalse(submitted);
  }),
);

it.effect(
  "refuses a review with neither a summary nor a comment, but lets an approval through",
  () =>
    Effect.gen(function* () {
      let approved = false;
      const service = yield* makeService({
        projects: [
          project({
            id: "p1",
            title: "t3code",
            workspaceRoot: "/a",
            repository: "pingdotgg/t3code",
          }),
        ],
        providers: [
          fakeProvider("github", {
            submitReview: () => {
              approved = true;
              return Effect.void;
            },
          }),
        ],
      });
      const reference = {
        projectId: "p1" as ProjectId,
        repository: "pingdotgg/t3code",
        number: 1,
      };

      const error = yield* Effect.flip(
        service.submitReview({ ...reference, verdict: "comment", body: "   ", comments: [] }),
      );
      assert.strictEqual(error._tag, "PullRequestOperationError");

      // An approval is a verdict in itself, so it needs no words.
      yield* service.submitReview({ ...reference, verdict: "approve", body: "", comments: [] });
      assert.isTrue(approved);
    }),
);

it.effect("refuses a merge strategy the host does not offer", () =>
  Effect.gen(function* () {
    let ranWith: string | null = null;
    const service = yield* makeService({
      projects: [
        project({ id: "p1", title: "t3code", workspaceRoot: "/a", repository: "pingdotgg/t3code" }),
      ],
      providers: [
        fakeProvider("github", {
          capabilities: {
            diff: true,
            comment: true,
            actions: ["merge"],
            // Azure DevOps's shape: it squashes as a completion option and has no rebase.
            mergeMethods: ["merge", "squash"],
            search: true,
            reactions: true,
            review: FULL_REVIEW,
            reviewers: FULL_REVIEWERS,
          },
          getChangeRequestSummary: () => Effect.succeed(changeRequest(1, "2026-07-02T00:00:00Z")),
          runAction: (input) => {
            ranWith = input.mergeMethod ?? "merge";
            return Effect.void;
          },
        }),
      ],
    });
    const reference = {
      projectId: "p1" as ProjectId,
      repository: "pingdotgg/t3code",
      number: 1,
    };

    // Every provider maps an unrecognised strategy to its own default, so letting this through
    // would merge with the wrong one rather than fail.
    const error = yield* Effect.flip(
      service.runAction({ ...reference, action: "merge", mergeMethod: "rebase" }),
    );
    assert.strictEqual(error._tag, "PullRequestOperationError");
    assert.strictEqual(ranWith, null);

    yield* service.runAction({ ...reference, action: "merge", mergeMethod: "squash" });
    assert.strictEqual(ranWith, "squash");
  }),
);

it.effect("refuses a review request this viewer may not make, and says what access it takes", () =>
  Effect.gen(function* () {
    let sent = false;
    const service = yield* makeService({
      projects: [project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" })],
      providers: [
        fakeProvider("github", {
          // The host asks for reviews; this account only reads the repository.
          getViewerPermissions: () =>
            Effect.succeed({
              actions: ["ready", "draft", "close", "reopen"],
              comment: true,
              resolve: true,
              verdicts: ["comment", "approve", "request-changes"],
              requestReviewers: false,
            }),
          setReviewerRequest: () => {
            sent = true;
            return Effect.void;
          },
        }),
      ],
    });

    const error = yield* Effect.flip(
      service.requestReviewers({
        projectId: "p1" as ProjectId,
        repository: "acme/web",
        number: 1,
        reviewers: [{ id: "octocat", kind: "user" }],
        requested: true,
      }),
    );

    assert.strictEqual(error._tag, "PullRequestOperationError");
    assert.include(error.message, "You need write access on this repository to ask for a review.");
    assert.isFalse(sent);
  }),
);

it.effect("refuses a label change this viewer may not make, and says what access it takes", () =>
  Effect.gen(function* () {
    let changed = false;
    const service = yield* makeService({
      projects: [project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" })],
      providers: [
        fakeProvider("github", {
          capabilities: { ...fakeProvider("github").capabilities, labels: true },
          getViewerPermissions: () =>
            Effect.succeed({
              actions: [],
              comment: true,
              resolve: false,
              verdicts: ["comment", "approve", "request-changes"],
              requestReviewers: false,
              labels: false,
            }),
          listLabelCandidates: () => Effect.die("must not be called"),
          setLabels: () => {
            changed = true;
            return Effect.void;
          },
        }),
      ],
    });

    const listError = yield* Effect.flip(
      service.labelCandidates({ projectId: "p1" as ProjectId, repository: "acme/web", number: 1 }),
    );
    assert.include(listError.message, "You need triage access on this repository");

    const error = yield* Effect.flip(
      service.setLabels({
        projectId: "p1" as ProjectId,
        repository: "acme/web",
        number: 1,
        labels: ["bug"],
        applied: true,
      }),
    );
    assert.include(error.message, "You need triage access on this repository");
    assert.isFalse(changed);
  }),
);

it.effect("answers a repeated listing from cache, and concurrent readers share one request", () =>
  Effect.gen(function* () {
    let hostCalls = 0;
    const service = yield* makeService({
      projects: [project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" })],
      providers: [
        fakeProvider("github", {
          listChangeRequests: () => {
            hostCalls += 1;
            return Effect.succeed({
              items: [changeRequest(1, "2026-07-02T00:00:00Z")],
              truncated: false,
              continues: false,
            });
          },
        }),
      ],
    });

    yield* Effect.all([service.list({ state: "open" }), service.list({ state: "open" })], {
      concurrency: "unbounded",
    });
    yield* service.list({ state: "open" });
    assert.strictEqual(hostCalls, 1);

    // A different filter is a different answer, not a cache hit.
    yield* service.list({ state: "all" });
    assert.strictEqual(hostCalls, 2);
  }),
);

it.effect(
  "keeps matching PR numbers on different hosts separate and refreshes the serving project",
  () =>
    Effect.gen(function* () {
      const hosts: string[] = [];
      const service = yield* makeService({
        projects: [
          project({ id: "p1", title: "public", workspaceRoot: "/a", repository: "acme/web" }),
          project({
            id: "p2",
            title: "enterprise",
            workspaceRoot: "/b",
            repository: "acme/web",
            host: "enterprise.test",
          }),
        ],
        providers: [
          fakeProvider("github", {
            getChangeRequest: (input) =>
              Effect.sync(() => {
                hosts.push(input.host);
                return hostedChangeRequest("body");
              }),
          }),
        ],
      });
      const own = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };
      const other = { ...own, host: "enterprise.test" };
      const readBoth = Effect.all([service.summary(own), service.summary(other)]);
      yield* readBoth;
      yield* service.invalidate({ reference: { ...own, host: "github.com" } });
      yield* readBoth;
      assert.deepStrictEqual(hosts, ["github.com", "enterprise.test", "github.com"]);
      yield* service.invalidate({ reference: own });
      yield* readBoth;
      assert.deepStrictEqual(hosts.slice(3), ["github.com"]);
      yield* service.refreshAfterTurn("p2" as ProjectId);
      yield* readBoth;
      assert.deepStrictEqual(hosts.slice(4), ["enterprise.test"]);
    }),
);

it.effect("close and reopen notify subscribed readers after invalidating their cached state", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let hostCalls = 0;
      let state: "open" | "closed" = "open";
      const reference = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };
      const service = yield* makeService({
        projects: [
          project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" }),
        ],
        providers: [
          fakeProvider("github", {
            getChangeRequestSummary: () =>
              Effect.succeed({ ...changeRequest(1, "2026-09-16T00:00:00.000Z"), state }),
            runAction: (input) =>
              Effect.sync(() => {
                state = input.action === "close" ? "closed" : "open";
              }),
            listChangeRequests: () => {
              hostCalls += 1;
              return Effect.succeed({ items: [], truncated: false, continues: false });
            },
          }),
        ],
      });

      yield* service.refreshAfterTurn(reference.projectId);
      yield* service.list({ state: "open" });
      assert.strictEqual((yield* service.summary(reference)).state, "open");
      for (const action of ["close", "reopen"] as const) {
        const refreshed = yield* service.subscribeRefreshes.pipe(
          Stream.drop(1),
          Stream.take(1),
          Stream.mapEffect(() =>
            Effect.gen(function* () {
              yield* service.list({ state: "open" });
              return yield* service.summary(reference);
            }),
          ),
          Stream.runHead,
          Effect.forkChild({ startImmediately: true }),
        );
        yield* service.runAction({ ...reference, action });
        assert.strictEqual(
          Option.getOrThrow(yield* Fiber.join(refreshed)).state,
          action === "close" ? "closed" : "open",
        );
      }
      assert.strictEqual(hostCalls, 3);
    }),
  ),
);

it.effect("explicit invalidation refreshes origin readers after a routed host mutation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let state: "open" | "closed" = "open";
      const reference = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };
      const service = yield* makeService({
        projects: [
          project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" }),
        ],
        providers: [
          fakeProvider("github", {
            getChangeRequestSummary: () =>
              Effect.succeed({ ...changeRequest(1, "2026-09-16T00:00:00.000Z"), state }),
          }),
        ],
      });
      yield* service.refreshAfterTurn(reference.projectId);
      let revision = Option.getOrThrow(yield* Stream.runHead(service.subscribeRefreshes));
      // The sync reactor invalidates before reading; it must not notify itself again.
      yield* service.invalidate({ reference });
      assert.strictEqual(
        Option.getOrThrow(yield* Stream.runHead(service.subscribeRefreshes)),
        revision,
      );
      assert.strictEqual((yield* service.summary(reference)).state, "open");

      for (const nextState of ["closed", "open"] as const) {
        const refreshed = yield* service.subscribeRefreshes.pipe(
          Stream.drop(1),
          Stream.take(1),
          Stream.mapEffect((nextRevision) =>
            service
              .summary(reference)
              .pipe(Effect.map((summary) => ({ revision: nextRevision, state: summary.state }))),
          ),
          Stream.runHead,
          Effect.forkChild({ startImmediately: true }),
        );
        state = nextState;
        yield* service.invalidate({ reference }, { notifyReaders: true });
        const result = Option.getOrThrow(yield* Fiber.join(refreshed));
        assert.strictEqual(result.state, nextState);
        assert.isAbove(result.revision, revision);
        revision = result.revision;
      }
    }),
  ),
);

it.effect("keeps routed reads separate when the GitHub account changes", () =>
  Effect.gen(function* () {
    for (const operation of ["summary", "detail", "diff", "filesViewed"] as const) {
      let failing = false;
      let calls = 0;
      const read = () =>
        Effect.suspend(() => {
          calls += 1;
          return failing
            ? Effect.fail(requestFailed)
            : Effect.succeed(hostedChangeRequest("account A content"));
        });
      const service = yield* makeService({
        projects: [
          project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" }),
        ],
        providers: [
          fakeProvider("github", {
            capabilities: { ...fakeProvider("github").capabilities, viewedFiles: "host" },
            getFilesViewed: () =>
              read().pipe(
                Effect.as({
                  files: [{ path: "private.ts", state: "viewed" as const }],
                  truncated: false,
                }),
              ),
            getChangeRequestSummary: read,
            getChangeRequest: read,
            getDiff: () =>
              read().pipe(
                Effect.as({ patch: "private patch", truncated: false, nextCursor: null }),
              ),
          }),
        ],
      });
      const readOperation = (input: Parameters<typeof service.diff>[0]) =>
        // @effect-diagnostics-next-line unnecessaryEffectGen:off - the generator unifies the per-operation union of Effect types, which Effect.asVoid cannot infer through.
        Effect.gen(function* () {
          yield* service[operation](input);
        });
      const reference = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };
      yield* readOperation({ ...reference, expectedAccountId: "101" });
      failing = true;

      for (const allowStale of [false, true]) {
        const error = yield* Effect.flip(
          readOperation({ ...reference, expectedAccountId: "202", allowStale }),
        );
        assert.strictEqual(error._tag, "PullRequestOperationError");
      }
      assert.strictEqual(calls, 3);
    }
  }),
);

it.effect("isolates routed caches for two credentials belonging to the same account", () =>
  Effect.gen(function* () {
    for (const operation of ["summary", "detail", "diff", "preview", "filesViewed"] as const) {
      let credential = "broad";
      let calls = 0;
      const read = () =>
        Effect.suspend(() => {
          calls += 1;
          return credential === "broad"
            ? Effect.succeed(hostedChangeRequest("private content"))
            : Effect.fail(requestFailed);
        });
      const service = yield* makeService({
        projects: [
          project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" }),
        ],
        providers: [
          fakeProvider("github", {
            capabilities: { ...fakeProvider("github").capabilities, viewedFiles: "host" },
            getFilesViewed: () =>
              read().pipe(
                Effect.as({
                  files: [{ path: "private.ts", state: "viewed" as const }],
                  truncated: false,
                }),
              ),
            withVerifiedCredential: (_, use) =>
              Effect.suspend(() =>
                use({
                  accountId: "101",
                  viewer: "octocat",
                  credentialFingerprint: credential,
                }),
              ),
            getChangeRequest: read,
            getChangeRequestSummary: read,
            getDiff: () =>
              read().pipe(
                Effect.as({ patch: "private patch", truncated: false, nextCursor: null }),
              ),
            getChangeRequestPreview: read,
          }),
        ],
      });
      const readOperation = (input: Parameters<typeof service.diff>[0]) =>
        // @effect-diagnostics-next-line unnecessaryEffectGen:off - the generator unifies the per-operation union of Effect types, which Effect.asVoid cannot infer through.
        Effect.gen(function* () {
          yield* service[operation](input);
        });
      const reference = {
        projectId: "p1" as ProjectId,
        repository: "acme/web",
        number: 1,
        host: "github.com",
        expectedAccountId: "101",
      };
      yield* service.withRoutingCredential(reference, readOperation(reference));
      credential = "restricted";
      for (const allowStale of [false, true]) {
        const error = yield* Effect.flip(
          service.withRoutingCredential(reference, readOperation({ ...reference, allowStale })),
        );
        assert.strictEqual(error._tag, "PullRequestOperationError");
      }
      assert.strictEqual(calls, 3);
    }
  }),
);

it.effect("rejects mismatched routing credentials before use and preserves action errors", () =>
  Effect.gen(function* () {
    let operations = 0;
    const service = yield* makeService({
      projects: [project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" })],
      providers: [
        fakeProvider("github", {
          getRoutingIdentity: () => Effect.succeed({ accountId: "101", viewer: "octocat" }),
          withVerifiedCredential: (_, use) =>
            use({
              accountId: "101",
              viewer: "octocat",
              credentialFingerprint: "credential-a",
            }),
        }),
      ],
    });
    const reference = {
      projectId: "p1" as ProjectId,
      repository: "acme/web",
      number: 1,
      host: "github.com",
      expectedAccountId: "202",
    };
    const actionError = new PullRequestOperationError({
      operation: "runAction",
      detail: "ambiguous",
    });
    const operation = Effect.sync(() => {
      operations += 1;
    }).pipe(Effect.andThen(Effect.fail(actionError)));
    const rejected = yield* Effect.flip(service.withRoutingCredential(reference, operation));
    assert.strictEqual(rejected._tag, "PullRequestOperationError");
    if (rejected._tag === "PullRequestOperationError")
      assert.strictEqual(rejected.operation, "routeIdentity");
    assert.strictEqual(operations, 0);
    assert.strictEqual(
      yield* Effect.flip(
        service.withRoutingCredential({ ...reference, expectedAccountId: "101" }, operation),
      ),
      actionError,
    );
    assert.strictEqual(operations, 1);
    assert.deepStrictEqual(yield* service.routingIdentity({ host: "github.com" }), {
      accountId: "101",
      viewer: "octocat",
      host: "github.com",
      provider: "github",
    });
  }),
);

it.effect("reuses an observed merged state for strict settlement reads", () =>
  Effect.gen(function* () {
    const reference = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };
    const service = yield* makeService({
      projects: [project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" })],
      providers: [
        fakeProvider("github", {
          getChangeRequest: () =>
            Effect.succeed({
              ...hostedChangeRequest("merged body", 4),
              state: "merged",
              updatedAt: "2026-07-03T00:00:00Z",
            }),
          getChangeRequestSummary: () => Effect.die("strict merged state must not refresh"),
        }),
      ],
    });

    yield* service.detail(reference);

    const summary = yield* service.summary(reference, { recoverTransientFailure: false });
    assert.strictEqual(summary.state, "merged");
    assert.strictEqual(summary.updatedAt, "2026-07-03T00:00:00Z");
  }),
);

it.effect("does not let a stale detail reopen overwrite a fresher linked summary", () =>
  Effect.gen(function* () {
    const gate = yield* Deferred.make<void>();
    let detailCalls = 0;
    let summaryTitle = "old title";
    let summaryState: "open" | "merged" = "open";
    const reference = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };
    const service = yield* makeService({
      projects: [project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" })],
      providers: [
        fakeProvider("github", {
          getChangeRequest: () =>
            Effect.gen(function* () {
              detailCalls += 1;
              if (detailCalls > 1) yield* Deferred.await(gate);
              return hostedChangeRequest("old body", 4);
            }),
          getChangeRequestSummary: () =>
            Effect.succeed({
              ...changeRequest(1, "2026-07-02T00:00:00Z"),
              title: summaryTitle,
              state: summaryState,
            }),
        }),
      ],
    });

    const first = yield* service.detail(reference);
    assert.strictEqual(first.title, "Change request 1");

    summaryTitle = "merged title";
    summaryState = "merged";
    yield* TestClock.adjust("61 seconds");
    const settled = yield* service.summary(reference, { recoverTransientFailure: false });
    assert.strictEqual(settled.title, "merged title");
    assert.strictEqual(settled.state, "merged");

    yield* TestClock.adjust("16 seconds");
    const stale = yield* service.detail(reference);
    assert.strictEqual(stale.title, "Change request 1");
    yield* Effect.yieldNow;

    const display = yield* service.summary(reference);
    assert.strictEqual(display.title, "merged title");
    assert.strictEqual(display.state, "merged");
    assert.strictEqual(detailCalls, 2);

    summaryTitle = "updated after merge";
    yield* TestClock.adjust("61 seconds");
    assert.strictEqual((yield* service.summary(reference)).title, "merged title");
    const refreshed = yield* service.summary({ ...reference, allowStale: false });
    assert.strictEqual(refreshed.title, "updated after merge");
    assert.strictEqual(refreshed.state, "merged");
  }),
);

for (const crossHost of [false, true]) {
  it.effect(
    `authorizes stack rebases and refreshes sibling layers (cross-host: ${crossHost})`,
    () =>
      Effect.gen(function* () {
        let taken = 0;
        let summaryReads = 0;
        let mutationFails = false;
        let stackRebase = true;
        let stackActions = true;
        const capabilities = {
          diff: true,
          comment: true,
          actions: ["update-branch"] as const,
          mergeMethods: ["merge"] as const,
          updateMethods: ["rebase"] as const,
          get stackActions() {
            return stackActions;
          },
          search: true,
          reactions: true,
          review: FULL_REVIEW,
          reviewers: FULL_REVIEWERS,
        };
        const service = yield* makeService({
          projects: [
            project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" }),
            project({
              id: "p2",
              title: "enterprise",
              workspaceRoot: "/b",
              repository: "acme/web",
              host: "enterprise.test",
            }),
          ],
          providers: [
            fakeProvider("github", {
              capabilities,
              getViewerPermissions: () =>
                Effect.succeed({
                  actions: [],
                  stackRebase,
                  comment: true,
                  resolve: false,
                  verdicts: [],
                  requestReviewers: false,
                }),
              getChangeRequestSummary: () =>
                Effect.sync(() => {
                  summaryReads++;
                  return changeRequest(8, "2026-07-01T00:00:00Z");
                }),
              runAction: () =>
                Effect.gen(function* () {
                  taken++;
                  if (mutationFails) return yield* requestFailed;
                }),
            }),
          ],
        });
        const input = {
          ...(crossHost ? { host: "enterprise.test" } : {}),
          projectId: "p1" as ProjectId,
          repository: "acme/web",
          number: 3,
          action: "update-branch" as const,
          updateMethod: "rebase" as const,
          stackNumber: 50,
          expectedStackHeads: [{ number: 3, headSha: "ccc" }],
        };
        yield* service.runAction(input);
        assert.strictEqual(taken, 1);
        const unrelated = { ...input, number: 8 };
        yield* service.summary(unrelated);
        assert.strictEqual(summaryReads, 1);
        stackRebase = false;
        assert.strictEqual(
          (yield* Effect.flip(service.runAction(input)))._tag,
          "PullRequestOperationError",
        );
        stackRebase = true;
        stackActions = false;
        assert.strictEqual(
          (yield* Effect.flip(service.runAction(input)))._tag,
          "PullRequestOperationError",
        );
        assert.strictEqual(taken, 1);
        yield* service.summary(unrelated);
        assert.strictEqual(summaryReads, 1);
        stackActions = true;
        mutationFails = true;
        yield* Effect.flip(service.runAction(input));
        assert.strictEqual(taken, 2);
        yield* service.summary(unrelated);
        assert.strictEqual(summaryReads, 2);
      }),
  );
}

it.effect("refuses a way of updating a branch that the host or the viewer does not allow", () =>
  Effect.gen(function* () {
    let taken: string | null = null;
    const service = yield* makeService({
      projects: [project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" })],
      providers: [
        fakeProvider("github", {
          capabilities: {
            diff: true,
            comment: true,
            actions: ["merge", "close", "update-branch"],
            mergeMethods: ["merge"],
            // This host brings a stale branch up to date with a merge commit and nothing else.
            updateMethods: ["merge"],
            search: true,
            reactions: true,
            review: FULL_REVIEW,
            reviewers: FULL_REVIEWERS,
          },
          getViewerPermissions: () =>
            Effect.succeed({
              actions: ["close", "update-branch"],
              comment: true,
              resolve: true,
              verdicts: ["comment"],
              requestReviewers: false,
              updateMethods: ["merge"],
            }),
          runAction: (input) => {
            taken = input.updateMethod ?? "default";
            return Effect.void;
          },
        }),
      ],
    });
    const reference = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };

    // Asking for a rebase a host does not offer must fail rather than quietly merge instead.
    const error = yield* Effect.flip(
      service.runAction({ ...reference, action: "update-branch", updateMethod: "rebase" }),
    );
    assert.strictEqual(error._tag, "PullRequestOperationError");
    assert.strictEqual(taken, null);

    yield* service.runAction({ ...reference, action: "update-branch", updateMethod: "merge" });
    assert.strictEqual(taken, "merge");
  }),
);

it.effect("sends only the words a rewrite carries", () =>
  Effect.gen(function* () {
    const received: Array<{ title?: string | undefined; body?: string | undefined }> = [];
    const reference = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };
    const service = yield* makeService({
      projects: [project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" })],
      providers: [
        fakeProvider("github", {
          updateChangeRequest: (input) => {
            received.push({ title: input.title, body: input.body });
            return Effect.void;
          },
        }),
      ],
    });

    yield* service.update({ ...reference, title: "A better title" });
    yield* service.update({ ...reference, body: "" });
    yield* service.update({ ...reference, title: "Both", body: "at once" });

    assert.deepStrictEqual(received, [
      { title: "A better title", body: undefined },
      { title: undefined, body: "" },
      { title: "Both", body: "at once" },
    ]);
  }),
);

it.effect("refuses a remark rewritten into nothing but whitespace", () =>
  Effect.gen(function* () {
    const service = yield* makeService({
      projects: [project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" })],
      providers: [
        fakeProvider("github", { updateComment: () => Effect.die("must not be called") }),
      ],
    });

    const error = yield* Effect.flip(
      service.updateComment({
        projectId: "p1" as ProjectId,
        repository: "acme/web",
        number: 1,
        commentId: "IC_1",
        kind: "issue-comment",
        body: "   \n  ",
      }),
    );

    assert.include(error.message, "A comment cannot be empty.");
  }),
);

it.effect("returns large diff slices intact without retaining them in either cache", () =>
  Effect.gen(function* () {
    let reads = 0;
    const patch = "\u{1f4bb}".repeat(140_000);
    const service = yield* makeService({
      projects: [project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" })],
      providers: [
        fakeProvider("github", {
          getDiff: () =>
            Effect.sync(() => {
              reads += 1;
              return { patch, truncated: false, nextCursor: "2" };
            }),
        }),
      ],
    });
    const reference = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };
    for (const input of [
      reference,
      { ...reference, cursor: "2" },
      { ...reference, commit: "a".repeat(40) },
    ]) {
      const before = reads;
      assert.deepStrictEqual(yield* service.diff(input), {
        patch,
        truncated: false,
        nextCursor: "2",
      });
      assert.deepStrictEqual(yield* service.diff(input), {
        patch,
        truncated: false,
        nextCursor: "2",
      });
      assert.strictEqual(reads, before + 2);
    }
  }),
);

const environmentViewedProvider = (
  revisions: Map<string, string>,
  asked: Array<ReadonlyArray<string>>,
  unreadable: ReadonlySet<string> = new Set(),
) =>
  fakeProvider("gitlab", {
    capabilities: {
      diff: true,
      comment: true,
      actions: ["merge"],
      mergeMethods: ["merge"],
      search: true,
      reactions: true,
      viewedFiles: "environment",
      review: FULL_REVIEW,
      reviewers: FULL_REVIEWERS,
    },
    getFilesViewed: () => Effect.die("the host keeps no marks of its own"),
    setFilesViewed: () => Effect.die("the host keeps no marks of its own"),
    // A merge confirms itself against the host before it says the change request landed.
    getChangeRequestSummary: () => Effect.succeed(changeRequest(1, "2026-07-02T00:00:00Z")),
    getFileRevisions: (input) => {
      asked.push(input.paths);
      return Effect.succeed({
        // A path the host looked at and did not find is at the empty version, which is what a
        // file the change request deletes is at. One it could not look at is left out entirely.
        revisions: new Map(
          input.paths.flatMap((path) =>
            unreadable.has(path) ? [] : [[path, revisions.get(path) ?? ""] as const],
          ),
        ),
      });
    },
  });

const environmentViewedService = (
  revisions: Map<string, string>,
  asked: Array<ReadonlyArray<string>>,
  unreadable: ReadonlySet<string> = new Set(),
) =>
  makeService({
    projects: [
      project({
        id: "p1",
        title: "on gitlab",
        workspaceRoot: "/a",
        repository: "group/project",
        provider: "gitlab",
      }),
    ],
    providers: [environmentViewedProvider(revisions, asked, unreadable)],
  });

const GITLAB_REFERENCE = {
  projectId: "p1" as ProjectId,
  repository: "group/project",
  number: 1,
};

it.effect("tracks Forgejo viewed files through its diff and refuses truncated baselines", () =>
  Effect.gen(function* () {
    let alpha = "b485fe5";
    let truncated = false;
    let diffReads = 0;
    const provider = yield* ForgejoPullRequestProvider.make.pipe(
      Effect.provide(
        Layer.mock(ForgejoCli)({
          api: (input) => {
            assert.strictEqual(input.host, "forge.example:3000");
            const viewer = input.path === "user";
            if (!viewer) {
              assert.strictEqual(input.repository, "reviewer/project");
              assert.strictEqual(input.path, "repos/reviewer/project/pulls/1.diff");
              diffReads++;
            }
            return Effect.succeed({
              exitCode: ChildProcessSpawner.ExitCode(0),
              stdout: viewer
                ? JSON.stringify({ login: "reviewer" })
                : truncated
                  ? `diff --git a/alpha.ts b/alpha.ts\nindex eb2d7c5..${alpha} 100644\n`
                  : [
                      "diff --git a/alpha.ts b/alpha.ts",
                      `index eb2d7c5..${alpha} 100644`,
                      "diff --git a/beta.ts b/beta.ts",
                      "index b39e8b3..5851425 100644",
                      'diff --git "a/caf\\303\\251 notes.txt" "b/caf\\303\\251 notes.txt"',
                      "index ffd99ce..6dd9855 100644",
                      "diff --git a/deleted.txt b/deleted.txt",
                      "deleted file mode 100644",
                      "index 233f5c6..0000000",
                      "diff --git a/old.txt b/renamed.txt",
                      "similarity index 100%",
                      "rename from old.txt",
                      "rename to renamed.txt",
                      "",
                    ].join("\n"),
              stderr: "",
              stdoutTruncated: !viewer && truncated,
              stderrTruncated: false,
            });
          },
        }),
      ),
    );
    const service = yield* makeService({
      projects: [
        project({
          id: "forgejo",
          title: "on forgejo",
          workspaceRoot: "/forgejo",
          repository: "reviewer/project",
          provider: "forgejo",
          host: "forge.example:3000",
          remoteUrl: "http://forge.example:3000/reviewer/project.git",
        }),
      ],
      providers: [provider],
    });
    const reference = {
      projectId: "forgejo" as ProjectId,
      repository: "reviewer/project",
      host: "forge.example:3000",
      number: 1,
    };
    const paths = ["alpha.ts", "beta.ts", "café notes.txt", "deleted.txt", "renamed.txt"];
    yield* service.setFilesViewed({
      ...reference,
      files: paths.map((path) => ({ path, viewed: true })),
    });
    assert.deepStrictEqual(
      new Map((yield* service.filesViewed(reference)).files.map((file) => [file.path, file.state])),
      new Map(paths.map((path) => [path, "viewed"])),
    );
    assert.strictEqual(diffReads, 1);

    alpha = "aabbccd";
    yield* service.invalidate({ reference });
    assert.deepStrictEqual(
      new Map((yield* service.filesViewed(reference)).files.map((file) => [file.path, file.state])),
      new Map(paths.map((path) => [path, path === "alpha.ts" ? "dismissed" : "viewed"])),
    );
    yield* service.setFilesViewed({
      ...reference,
      files: [{ path: "beta.ts", viewed: false }],
    });
    assert.isFalse(
      (yield* service.filesViewed(reference)).files.some((file) => file.path === "beta.ts"),
    );

    truncated = true;
    yield* service.invalidate({ reference });
    yield* service.setFilesViewed({
      ...reference,
      files: [{ path: "beta.ts", viewed: true }],
    });
    truncated = false;
    yield* service.invalidate({ reference });
    // A partial response must not stamp an empty revision and then dismiss the mark on recovery.
    assert.deepStrictEqual(
      (yield* service.filesViewed(reference)).files.find((file) => file.path === "beta.ts"),
      { path: "beta.ts", state: "viewed" },
    );
  }),
);

it.effect("keeps hosted Forgejo marks with their repository instead of the serving checkout", () =>
  Effect.gen(function* () {
    const projects = [
      project({
        id: "p1",
        title: "first repository",
        workspaceRoot: "/first",
        repository: "reviewer/first",
        provider: "forgejo",
        host: "forge.example",
        remoteUrl: "https://forge.example:3000/reviewer/first.git",
      }),
    ];
    const service = yield* makeService({
      projects,
      providers: [
        { ...environmentViewedProvider(new Map([["same.ts", "blob"]]), []), kind: "forgejo" },
      ],
      resolveHandle: ({ context }) =>
        Effect.succeed({
          context: {
            ...context!,
            provider: { kind: "forgejo", name: "Forgejo", baseUrl: "https://forge.example:3000" },
          },
          provider: undefined as never,
        }),
    });
    const first = {
      projectId: "p1" as ProjectId,
      host: "forge.example:3000",
      repository: "reviewer/first",
      number: 1,
    };
    const second = { ...first, repository: "reviewer/second" };
    const files = [{ path: "same.ts", viewed: true }];
    yield* service.setFilesViewed({ ...first, files });
    assert.deepStrictEqual((yield* service.filesViewed(second)).files, []);
    yield* service.setFilesViewed({ ...second, files });
    yield* service.setFilesViewed({ ...first, files: [{ path: "same.ts", viewed: false }] });
    assert.deepStrictEqual((yield* service.filesViewed(second)).files, [
      { path: "same.ts", state: "viewed" },
    ]);

    projects.push(
      project({
        id: "p2",
        title: "second repository",
        workspaceRoot: "/second",
        repository: "reviewer/second",
        provider: "forgejo",
        host: "forge.example",
        remoteUrl: "https://forge.example:3000/reviewer/second.git",
      }),
    );
    assert.deepStrictEqual(
      (yield* service.filesViewed({ ...second, projectId: "p2" as ProjectId })).files,
      [{ path: "same.ts", state: "viewed" }],
    );
    projects.push(
      project({
        id: "ssh",
        title: "second repository over SSH",
        workspaceRoot: "/ssh",
        repository: "reviewer/second",
        provider: "forgejo",
        host: "ssh.forge.example",
        remoteUrl: "git@ssh.forge.example:reviewer/second.git",
      }),
    );
    assert.deepStrictEqual(
      (yield* service.filesViewed({ ...second, projectId: "ssh" as ProjectId })).files,
      [{ path: "same.ts", state: "viewed" }],
    );
  }),
);

it.effect("finishes two presses on one file in the order they were made", () =>
  Effect.gen(function* () {
    // A tick asks the host what it has of the file before it stores anything, and an untick asks
    // nothing at all, so the second press would otherwise land first and be overwritten by the
    // first one finishing behind it.
    const held = yield* Deferred.make<void>();
    const service = yield* makeService({
      projects: [
        project({
          id: "p1",
          title: "on gitlab",
          workspaceRoot: "/a",
          repository: "group/project",
          provider: "gitlab",
        }),
      ],
      providers: [
        fakeProvider("gitlab", {
          capabilities: {
            diff: true,
            comment: true,
            actions: ["merge"],
            mergeMethods: ["merge"],
            search: true,
            reactions: true,
            viewedFiles: "environment",
            review: FULL_REVIEW,
            reviewers: FULL_REVIEWERS,
          },
          getFilesViewed: () => Effect.die("the host keeps no marks of its own"),
          setFilesViewed: () => Effect.die("the host keeps no marks of its own"),
          getFileRevisions: (input) =>
            Deferred.await(held).pipe(
              Effect.as({ revisions: new Map(input.paths.map((path) => [path, "blob-a"])) }),
            ),
        }),
      ],
    });

    const tick = service
      .setFilesViewed({
        ...GITLAB_REFERENCE,
        files: [{ path: "src/a.ts", viewed: true }],
      })
      .pipe(Effect.runFork);
    // Far enough for the tick to be waiting on the host rather than still on its way there.
    yield* TestClock.adjust("1 second");
    const untick = service
      .setFilesViewed({
        ...GITLAB_REFERENCE,
        files: [{ path: "src/a.ts", viewed: false }],
      })
      .pipe(Effect.runFork);
    yield* TestClock.adjust("1 second");
    yield* Deferred.succeed(held, undefined);
    yield* Fiber.join(tick);
    yield* Fiber.join(untick);

    // The untick came second and stands: the file is open again.
    const marked = yield* service.filesViewed(GITLAB_REFERENCE);
    assert.deepStrictEqual(marked.files, []);
  }),
);

/** Azure, whose selector is a bare repository name, backed by this environment's own marks. */
const azureViewedService = (projects: ReadonlyArray<OrchestrationProjectShell>) =>
  makeService({
    projects,
    providers: [
      fakeProvider("azure-devops", {
        capabilities: {
          diff: true,
          comment: true,
          actions: ["merge"],
          mergeMethods: ["merge"],
          search: true,
          reactions: true,
          viewedFiles: "environment",
          review: FULL_REVIEW,
          reviewers: FULL_REVIEWERS,
        },
        getFilesViewed: () => Effect.die("the host keeps no marks of this environment's own"),
        setFilesViewed: () => Effect.die("the host keeps no marks of this environment's own"),
        getFileRevisions: (input) =>
          Effect.succeed({ revisions: new Map(input.paths.map((path) => [path, "blob-a"])) }),
      }),
    ],
  });

const AZURE_PAIR = [
  project({
    id: "p1",
    title: "platform web",
    workspaceRoot: "/a",
    repository: "acme/platform/_git/web",
    provider: "azure-devops",
    host: "dev.azure.com",
  }),
  project({
    id: "p2",
    title: "other web",
    workspaceRoot: "/b",
    repository: "acme/other/_git/web",
    provider: "azure-devops",
    host: "dev.azure.com",
  }),
];

const AZURE_PLATFORM = { projectId: "p1" as ProjectId, repository: "web", number: 1 };
const AZURE_OTHER = { projectId: "p2" as ProjectId, repository: "web", number: 1 };

it.effect("keeps the marks of two Azure repositories of the same name apart", () =>
  Effect.gen(function* () {
    // Azure addresses a repository by its bare name, which is unique inside one of its projects
    // and not across an organisation. Two `web` repositories would otherwise share one row.
    const service = yield* azureViewedService(AZURE_PAIR);

    yield* service.setFilesViewed({
      ...AZURE_PLATFORM,
      files: [{ path: "src/a.ts", viewed: true }],
    });

    assert.deepStrictEqual((yield* service.filesViewed(AZURE_PLATFORM)).files, [
      { path: "src/a.ts", state: "viewed" },
    ]);
    assert.deepStrictEqual((yield* service.filesViewed(AZURE_OTHER)).files, []);
  }),
);

it.effect("keeps environment marks apart from another change request's", () =>
  Effect.gen(function* () {
    const service = yield* environmentViewedService(new Map([["src/a.ts", "blob-a"]]), []);

    yield* service.setFilesViewed({
      ...GITLAB_REFERENCE,
      files: [{ path: "src/a.ts", viewed: true }],
    });
    const other = yield* service.filesViewed({ ...GITLAB_REFERENCE, number: 2 });

    assert.deepStrictEqual(other.files, []);
  }),
);

/** The environment-backed fixture with its own answer to who the reader is. */
const environmentViewedServiceWithViewer = (
  revisions: Map<string, string>,
  getViewer: PullRequestProviderApi["getViewer"],
) =>
  makeService({
    projects: [
      project({
        id: "p1",
        title: "on gitlab",
        workspaceRoot: "/a",
        repository: "group/project",
        provider: "gitlab",
      }),
    ],
    providers: [{ ...environmentViewedProvider(revisions, []), getViewer }],
  });

it.effect("refuses the marks when the host could not be asked who is reading", () =>
  Effect.gen(function* () {
    let answering = true;
    const service = yield* environmentViewedServiceWithViewer(
      new Map([["src/a.ts", "blob-a"]]),
      () =>
        answering
          ? Effect.succeed("bilal")
          : Effect.fail(
              new PullRequestProviderError({
                provider: "gitlab",
                operation: "getViewer",
                reason: "failed",
                detail: "glab exited with status 1",
              }),
            ),
    );

    yield* service.setFilesViewed({
      ...GITLAB_REFERENCE,
      files: [{ path: "src/a.ts", viewed: true }],
    });
    // Who is signed in is held for ten minutes, so the lookup has to come round again before a
    // failing CLI can reach the read at all.
    answering = false;
    yield* TestClock.adjust("11 minutes");

    // Answering these from the unnamed reader's rows would show the reader none of their own
    // ticks, and file the next press where the recovered CLI will never look for it again.
    const read = yield* Effect.flip(service.filesViewed(GITLAB_REFERENCE));
    const write = yield* Effect.flip(
      service.setFilesViewed({
        ...GITLAB_REFERENCE,
        files: [{ path: "src/b.ts", viewed: true }],
      }),
    );
    assert.strictEqual(read._tag, "PullRequestOperationError");
    assert.strictEqual(write._tag, "PullRequestOperationError");

    answering = true;
    assert.deepStrictEqual((yield* service.filesViewed(GITLAB_REFERENCE)).files, [
      { path: "src/a.ts", state: "viewed" },
    ]);
  }),
);

it.effect("keeps Azure continuation cursors separate for repositories with the same name", () =>
  Effect.gen(function* () {
    const seen: string[] = [];
    const service = yield* makeService({
      projects: ["org-a", "org-b"].map((organization) =>
        project({
          id: organization,
          title: organization,
          workspaceRoot: `/${organization}`,
          repository: `${organization}/project/_git/web`,
          provider: "azure-devops",
          host: "dev.azure.com",
        }),
      ),
      providers: [
        fakeProvider("azure-devops", {
          listChangeRequests: (input) =>
            Effect.sync(() => {
              seen.push(input.cwd);
              return {
                items: [changeRequest(7, "2026-07-02T00:00:00Z")],
                truncated: true,
                continues: true,
              };
            }),
        }),
      ],
    });
    const first = yield* service.list({ state: "open" });
    assert.lengthOf(Object.keys(first.nextCursors), 2);
    const key = Object.keys(first.nextCursors).find((key) => key.includes("org-b"))!;
    seen.length = 0;
    yield* service.list({ state: "open", cursors: { [key]: first.nextCursors[key]! } });
    assert.deepStrictEqual(seen, ["/org-b"]);
  }),
);
