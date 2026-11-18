import type { EnvironmentId, PullRequestListEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  filterPullRequestsByInvolvement,
  mergePullRequestLists,
  pullRequestEntryKey,
  groupPullRequestsByInvolvement,
  parsePullRequestQuery,
  pullRequestStatsBatches,
  pullRequestStatsRefreshBatches,
  partitionPullRequestsWithPriority,
  resolveQueryEnvironmentIds,
  resolveSelectedEnvironmentId,
  type EnvironmentPullRequestEntry,
  settlePullRequestOverrides,
} from "./pullRequestList.logic";

const VIEWERS = { "github.com": "Bilal" } as const;

function entry(
  overrides: Partial<EnvironmentPullRequestEntry> & Pick<PullRequestListEntry, "number">,
) {
  return {
    environmentId: "env-1",
    provider: "github",
    host: "github.com",
    projectId: "project-1",
    projectTitle: "t3code",
    repository: "pingdotgg/t3code",
    title: "Add the pull requests page",
    url: `https://github.com/pingdotgg/t3code/pull/${overrides.number}`,
    author: { login: "octocat", name: null, avatarUrl: null },
    headBranch: `feat/branch-${overrides.number}`,
    baseBranch: "main",
    state: "open",
    isDraft: false,
    mergeability: "mergeable",
    additions: 1,
    deletions: 0,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-02T00:00:00Z",
    viewerReviewRequested: false,
    labels: [],
    ...overrides,
  } as EnvironmentPullRequestEntry;
}

describe("visible pull request line-count targets", () => {
  it("keeps every per-environment batch within the stats contract limit", () => {
    const entries = Array.from({ length: 501 }, (_, index) =>
      entry({ additions: 0, deletions: 0, number: index + 1 }),
    );
    const entriesByKey = new Map(entries.map((item) => [pullRequestEntryKey(item), item]));
    const batches = pullRequestStatsBatches(
      entriesByKey,
      new Set(entries.map(pullRequestEntryKey)),
    );

    expect(batches.map((batch) => batch.input.refs.length)).toEqual([500, 1]);
    expect(batches.flatMap((batch) => [...batch.keys])).toEqual(entries.map(pullRequestEntryKey));
  });

  it("ignores a late refresh after the filter or stats policy changes", () => {
    const entries = [
      entry({ additions: 0, deletions: 0, number: 1 }),
      entry({ additions: 0, deletions: 0, number: 2 }),
    ];
    const entriesByKey = new Map(entries.map((item) => [pullRequestEntryKey(item), item]));
    const visibleKeys = new Set([pullRequestEntryKey(entries[1]!)]);
    const requestedScope = { key: "open", policy: "visible" } as const;
    const refresh = (currentScope: { key: string; policy: "visible" | "eager" }) =>
      pullRequestStatsRefreshBatches({
        requestedScope,
        currentScope,
        entriesByKey,
        candidateKeys: visibleKeys,
        statsByRow: new Map(),
      });

    expect(refresh(requestedScope)?.[0]?.input.refs.map((ref) => ref.number)).toEqual([2]);
    expect(refresh({ key: "closed", policy: "visible" })).toBeNull();
    expect(refresh({ key: "open", policy: "eager" })).toBeNull();
  });
});

describe("pull request involvement filtering", () => {
  it("does not treat a matching login on another host as the viewer", () => {
    // The same name on GitLab is a different account, and its viewer is unknown here.
    const mixed = [
      entry({ number: 1, author: { login: "Bilal", name: null, avatarUrl: null } }),
      entry({
        number: 2,
        provider: "gitlab",
        host: "gitlab.com",
        author: { login: "Bilal", name: null, avatarUrl: null },
      }),
    ];
    expect(
      filterPullRequestsByInvolvement(mixed, VIEWERS, "authored").map((item) => item.number),
    ).toEqual([1]);
  });
});

describe("reading qualifiers out of a typed query", () => {
  it("cuts a typed query back to what the contract carries", () => {
    const many = Array.from({ length: 14 }, (_, index) => `l${index}`).join(",");
    const long = "x".repeat(240);
    const parsed = parsePullRequestQuery(`label:${many} label:${long} author:${long}`);
    expect(parsed.filters.labels?.[0]).toHaveLength(10);
    expect(parsed.filters.labels?.[1]).toEqual(["x".repeat(200)]);
    expect(parsed.filters.author).toBe("x".repeat(200));
  });
});

const ENV_1 = "env-1" as EnvironmentId;
const ENV_2 = "env-2" as EnvironmentId;

describe("merging the environments' own listings", () => {
  const answer = (
    overrides: Partial<Parameters<typeof mergePullRequestLists>[0][number][1]> = {},
  ) =>
    ({
      viewers: { "github.com": "Bilal" },
      providers: [
        {
          host: "github.com",
          kind: "github",
          searchesOnHost: true,
          projectCount: 1,
          configured: true,
          detail: null,
        },
      ],
      entries: [],
      errors: [],
      truncated: false,
      nextCursors: {},
      ...overrides,
    }) as Parameters<typeof mergePullRequestLists>[0][number][1];

  it("tells two environments' copies of one pull request apart", () => {
    const row = entry({ number: 4 });
    expect(pullRequestEntryKey({ ...row, environmentId: ENV_1 })).not.toBe(
      pullRequestEntryKey({ ...row, environmentId: ENV_2 }),
    );
  });

  it("keeps each environment's continuation to itself", () => {
    const merged = mergePullRequestLists([
      [ENV_1, answer({ nextCursors: { "github.com pingdotgg/t3code": "cursor-1" } })],
      [ENV_2, answer()],
    ]);
    expect(merged?.nextCursors).toEqual({
      [ENV_1]: { "github.com pingdotgg/t3code": "cursor-1" },
    });
  });
});

describe('who "I" am, per server', () => {
  const answer = (viewers: Record<string, string>, entries: ReadonlyArray<PullRequestListEntry>) =>
    ({
      viewers,
      providers: [],
      entries,
      errors: [],
      truncated: false,
      nextCursors: {},
    }) as Parameters<typeof mergePullRequestLists>[0][number][1];
  const byBilal = { login: "Bilal", name: null, avatarUrl: null };

  it("does not let one server's account decide who authored another server's rows", () => {
    // Both servers reach github.com, signed in as different people. Folded into one host-keyed
    // record, whichever answered last spoke for both — and every row of the reader's own work
    // was filed under Others.
    const merged = mergePullRequestLists([
      [ENV_1, answer({ "github.com": "Bilal" }, [entry({ number: 1, author: byBilal })])],
      [ENV_2, answer({ "github.com": "Octocat" }, [entry({ number: 2, author: byBilal })])],
    ])!;

    const groups = groupPullRequestsByInvolvement(merged.entries, merged.viewers);
    expect(
      groups.find((group) => group.key === "authored")?.entries.map((row) => row.number),
    ).toEqual([1]);
    expect(
      filterPullRequestsByInvolvement(merged.entries, merged.viewers, "authored").map(
        (row) => row.number,
      ),
    ).toEqual([1]);
  });
});

describe("which environments a listing should ask", () => {
  const ENV_3 = "env-3" as EnvironmentId;
  const environmentIds = [ENV_1, ENV_2, ENV_3];

  it("asks only the environments that actually hold an ambiguous bare id, never a third that doesn't", () => {
    const projects = [
      { id: "project-1", environmentId: ENV_1 },
      { id: "project-1", environmentId: ENV_2 },
    ];
    // Two servers can genuinely hold the same project id string; the third holds no such project
    // and asking it would return an unrelated project's rows rather than an honest empty answer.
    expect(
      resolveQueryEnvironmentIds(environmentIds, projects, undefined, "project-1", true),
    ).toEqual([ENV_1, ENV_2]);
  });
});

describe("the server a saved selection names", () => {
  const known = new Set([ENV_1, ENV_2]);

  it("resolves to nothing yet for a server that is known but not ready, rather than falling back", () => {
    // ENV_2 is in the catalog (still connecting, say) but not the fallback; a caller that then
    // looks a project up under ENV_2 finds none rather than one belonging to the fallback server.
    expect(resolveSelectedEnvironmentId(ENV_2, known, ENV_1)).toBe(ENV_2);
  });
});

describe("the priority groups against a paginated feed", () => {
  const authoredRow = (number: number, updatedAt: string) =>
    entry({ number, updatedAt, author: { login: "Bilal", name: null, avatarUrl: null } });

  it("shows every authored row the host reported, not only the ones the feed page holds", () => {
    // The feed is one page ordered by recency, so on a busy repository it can hold exactly one of
    // somebody's own pull requests while the rest sit further down the host's list. The Authored
    // group comes from its own server-filtered read for that reason: grouping the page instead
    // leaves the older ones under Others, or off the page altogether.
    const newest = authoredRow(6039, "2026-08-11T08:00:00Z");
    const older = [
      authoredRow(5499, "2026-08-10T17:00:00Z"),
      authoredRow(5544, "2026-08-10T16:00:00Z"),
    ];
    const feed = [newest, entry({ number: 6123, updatedAt: "2026-08-11T09:00:00Z" })];

    const groups = partitionPullRequestsWithPriority(feed, [newest, ...older], []);

    expect(
      groups.find((group) => group.key === "authored")?.entries.map((row) => row.number),
    ).toEqual([6039, 5499, 5544]);
    expect(
      groups.find((group) => group.key === "others")?.entries.map((row) => row.number),
    ).toEqual([6123]);
  });
});

describe("pull request list override settlement", () => {
  const entry = (number: number, state: "open" | "closed" | "merged") =>
    ({ number, state, isDraft: false, labels: [] }) as unknown as PullRequestListEntry;
  const key = (row: { number: number }) => `#${row.number}`;

  it("keeps an override until an answer agrees with it", () => {
    const at = 1_000_000;
    const closed = { state: "closed" as const, updatedAt: "2026-07-03T00:00:00Z", token: 1, at };
    const overrides = new Map([["#1", closed]]);
    // A read from before the action still says open: the override stands.
    expect(settlePullRequestOverrides(overrides, [entry(1, "open")], key, at + 5_000)).toBe(
      overrides,
    );
    // Absent from the answer says nothing: the row may live in another group or page.
    expect(settlePullRequestOverrides(overrides, [entry(2, "open")], key, at + 5_000).size).toBe(1);
    // Present as closed: confirmed.
    expect(settlePullRequestOverrides(overrides, [entry(1, "closed")], key, at + 5_000).size).toBe(
      0,
    );
    // Present as open a good while later: the host's news, which outranks the note.
    expect(settlePullRequestOverrides(overrides, [entry(1, "open")], key, at + 90_000).size).toBe(
      0,
    );
  });
});
