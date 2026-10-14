import { describe, expect, it } from "vite-plus/test";

import {
  aldoOpensPullRequestThread,
  aldoPullRequestThreadOpened,
  aldoPullRequestThreadRequest,
} from "./pullRequestThreads.logic";

const PULL_REQUEST = { number: 12, headBranch: "feature/fix", state: "open" };

describe("aldoPullRequestThreadRequest", () => {
  it("asks for a machine like the panel's, on the pull request it showed", () => {
    expect(aldoPullRequestThreadRequest("aldo-abc", PULL_REQUEST)).toEqual({
      fromEnvironmentId: "aldo-abc",
      pullRequest: { number: 12, headBranch: "feature/fix" },
    });
  });

  it("takes only the number and branch from a detail", () => {
    const detail = { ...PULL_REQUEST, title: "Fix it", url: "https://github.com/a/b/pull/12" };
    expect(aldoPullRequestThreadRequest("aldo-abc", detail).pullRequest).toEqual({
      number: 12,
      headBranch: "feature/fix",
    });
  });
});

describe("aldoOpensPullRequestThread", () => {
  it("opens one on an open pull request, where Aldo starts them", () => {
    expect(aldoOpensPullRequestThread(true, PULL_REQUEST)).toBe(true);
  });

  it("doesn't on one that's merged or closed, or with an Aldo that can't, or before it loads", () => {
    expect(aldoOpensPullRequestThread(true, { state: "merged" })).toBe(false);
    expect(aldoOpensPullRequestThread(true, { state: "closed" })).toBe(false);
    expect(aldoOpensPullRequestThread(false, PULL_REQUEST)).toBe(false);
    expect(aldoOpensPullRequestThread(true, null)).toBe(false);
  });
});

describe("aldoPullRequestThreadOpened", () => {
  it("points at the composer when there's a task in it", () => {
    expect(aldoPullRequestThreadOpened(true, "feature/fix").description).toBe(
      "The task is in the composer — read it over, then send.",
    );
  });

  it("names the branch its computer checks out when there's none", () => {
    expect(aldoPullRequestThreadOpened(false, "feature/fix").description).toBe(
      "Its computer checks out `feature/fix` as it starts.",
    );
  });
});
