import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";

import {
  buildPullRequestSummariesGraphQlQuery,
  buildReviewSubmissionJson,
  buildPullRequestStackMembershipsGraphQlQuery,
  decodePullRequestStackMembershipsJson,
  buildSetFilesViewedGraphQlMutation,
  decodeBaseComparisonJson,
  decodePullRequestDetailJson,
  decodePullRequestListJson,
  decodeViewerPermissionsJson,
  REVIEW_THREADS_GRAPHQL_QUERY,
} from "./gitHubPullRequestJson.ts";

function listJson(entries: ReadonlyArray<Record<string, unknown>>): string {
  return JSON.stringify(
    entries.map((entry) => ({
      number: 1,
      title: "Add the pull requests page",
      url: "https://github.com/pingdotgg/t3code/pull/1",
      headRefName: "feat/page",
      baseRefName: "main",
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-02T00:00:00Z",
      ...entry,
    })),
  );
}

function expectSuccess<A>(result: Result.Result<A, unknown>): A {
  expect(Result.isSuccess(result)).toBe(true);
  if (!Result.isSuccess(result)) throw new Error("expected a successful decode");
  return result.success;
}

describe("pull request list decoding", () => {
  it("treats a merge timestamp as merged even when the state still says closed", () => {
    const [entry] = expectSuccess(
      decodePullRequestListJson(listJson([{ state: "CLOSED", mergedAt: "2026-07-03T00:00:00Z" }])),
    ).items;
    expect(entry?.state).toBe("merged");
  });
});

describe("pull request detail decoding", () => {
  const detailJson = JSON.stringify({
    number: 7,
    title: "Detail",
    url: "https://github.com/pingdotgg/t3code/pull/7",
    headRefName: "feat/detail",
    baseRefName: "main",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-05T00:00:00Z",
    body: "Body",
    statusCheckRollup: [
      { __typename: "CheckRun", name: "build", status: "IN_PROGRESS" },
      { __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "FAILURE" },
      { __typename: "StatusContext", context: "ci/legacy", state: "SUCCESS" },
    ],
    comments: [{ id: "c1", body: "second", createdAt: "2026-07-04T00:00:00Z" }],
    reviews: [
      { id: "r1", body: "first", state: "CHANGES_REQUESTED", submittedAt: "2026-07-03T00:00:00Z" },
      { id: "r2", body: "   ", state: "APPROVED", submittedAt: "2026-07-06T00:00:00Z" },
    ],
    commits: [
      {
        oid: "abc1234",
        messageHeadline: "Ship the timeline",
        committedDate: "2026-07-05T00:00:00Z",
        authors: [
          { login: "octocat", name: "Octo Cat", email: "octo@example.com" },
          { name: "Pair Author", email: "pair@example.com" },
        ],
      },
    ],
  });

  it("keeps a workflow waiting for approval out of the passing state", () => {
    const raw = JSON.parse(detailJson) as Record<string, unknown>;
    const detail = expectSuccess(
      decodePullRequestDetailJson(
        JSON.stringify({
          ...raw,
          statusCheckRollup: [
            { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
            {
              __typename: "CheckRun",
              name: "contributor tests",
              status: "COMPLETED",
              conclusion: "ACTION_REQUIRED",
            },
          ],
        }),
      ),
    );

    expect(detail.checks.map((check) => check.status)).toEqual(["success", "action-required"]);
    expect(detail.checksState).toBe("pending");
  });
});

describe("repository access decoding", () => {
  const repositoryJson = (viewerPermission?: string | null) =>
    JSON.stringify({
      data: {
        repository: {
          pullRequest: null,
          mergeCommitAllowed: true,
          squashMergeAllowed: false,
          rebaseMergeAllowed: true,
          ...(viewerPermission === undefined ? {} : { viewerPermission }),
        },
      },
    });

  it("fails rather than defaulting open when a setting is missing", () => {
    const decoded = decodeViewerPermissionsJson(
      JSON.stringify({ data: { repository: { pullRequest: null, mergeCommitAllowed: true } } }),
    );
    expect(Result.isSuccess(decoded)).toBe(false);
  });

  it("withholds write where gh names no permission, which is not a standing it gave", () => {
    // The one place an unknown answer is not granted: a Merge button a reader cannot use wastes
    // the press, where a missing one still leaves the pull request open on its host.
    expect(expectSuccess(decodeViewerPermissionsJson(repositoryJson())).canWrite).toBe(false);
    expect(expectSuccess(decodeViewerPermissionsJson(repositoryJson(null))).canWrite).toBe(false);
  });
});

describe("viewer permission decoding", () => {
  const viewerJson = (repository: Record<string, unknown>) =>
    JSON.stringify({
      data: {
        repository: {
          mergeCommitAllowed: true,
          squashMergeAllowed: false,
          rebaseMergeAllowed: true,
          ...repository,
        },
      },
    });

  it("says no to a passer-by on a repository they can only read", () => {
    expect(
      expectSuccess(
        decodeViewerPermissionsJson(
          viewerJson({
            viewerPermission: "READ",
            pullRequest: { viewerCanUpdate: false, viewerDidAuthor: false },
          }),
        ),
      ),
    ).toEqual({
      mergeCapabilities: { merge: true, squash: false, rebase: true },
      canWrite: false,
      canTriage: false,
      canUpdate: false,
      didAuthor: false,
    });
  });
});

describe("REVIEW_THREADS_GRAPHQL_QUERY", () => {
  it("caps the initial query after the 104-point rate-limit regression", () => {
    const match = REVIEW_THREADS_GRAPHQL_QUERY.match(
      /reviewThreads\(first: (\d+)[\s\S]*?comments\(first: (\d+)\)/u,
    );

    expect(match).not.toBeNull();
    if (match === null) throw new Error("expected review-thread connections");
    expect(Number(match[1]) * Number(match[2])).toBeLessThanOrEqual(1_000);
  });
});

describe("review submission payload", () => {
  it("sends an approval with no words and no comments", () => {
    expect(
      JSON.parse(buildReviewSubmissionJson({ verdict: "approve", body: "", comments: [] })),
    ).toEqual({ event: "APPROVE", body: "", comments: [] });
  });
});

describe("how far a branch trails its base", () => {
  it("refuses a body that is not the answer to this question", () => {
    expect(Result.isSuccess(decodeBaseComparisonJson("{"))).toBe(false);
  });
});

describe("buildSetFilesViewedGraphQlMutation", () => {
  it("keeps a path out of the document, so one cannot be read as part of it", () => {
    const mutation = buildSetFilesViewedGraphQlMutation([
      { path: '") { __typename } evil: markFileAsViewed(input: { path: "x', viewed: true },
    ]);
    expect(mutation).not.toBeNull();
    if (mutation === null) return;
    expect(mutation.query).not.toContain("evil");
    expect(mutation.variables.path0).toBe(
      '") { __typename } evil: markFileAsViewed(input: { path: "x',
    );
  });
});

describe("pull request stack membership batches", () => {
  it("refuses malformed responses and unsafe query selectors", () => {
    expect(Result.isFailure(decodePullRequestStackMembershipsJson('{"errors":[]}'))).toBe(true);
    expect(buildPullRequestStackMembershipsGraphQlQuery('acme/web") { x } #', [1])).toBeNull();
    expect(buildPullRequestStackMembershipsGraphQlQuery("acme/web", [0])).toBeNull();
    expect(buildPullRequestStackMembershipsGraphQlQuery("acme/web", [1.5])).toBeNull();
    expect(buildPullRequestStackMembershipsGraphQlQuery("acme/web", [])).toBeNull();
    expect(buildPullRequestStackMembershipsGraphQlQuery("acme/web", [7, 8])).toContain(
      "pullRequest(number: 8)",
    );
  });
});

describe("batched pull request summaries", () => {
  it("refuses a repository GraphQL cannot address, rather than writing it into the document", () => {
    expect(
      buildPullRequestSummariesGraphQlQuery([{ repository: 'acme/web") { x } #', number: 1 }]),
    ).toBeNull();
    expect(
      buildPullRequestSummariesGraphQlQuery([{ repository: "acme/web", number: 0 }]),
    ).toBeNull();
    expect(buildPullRequestSummariesGraphQlQuery([])).toBeNull();
  });
});
