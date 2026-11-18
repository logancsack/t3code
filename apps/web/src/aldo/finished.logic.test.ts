import { describe, expect, it } from "vite-plus/test";

import { type AldoHome, type AldoHomeConversation, type AldoHomePullRequest } from "./homeApi";
import {
  checksLine,
  finishedResults,
  followupsLine,
  mergeWords,
  onlyWaiting,
  pullRequestState,
  resultState,
} from "./finished.logic";

const NOW = Date.parse("2026-11-18T15:00:00Z");
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
const target = (id: string) => ({ environmentId: `aldo-${id}`, threadId: id });

function conversation(id: string, overrides: Partial<AldoHomeConversation> = {}) {
  return {
    ref: `m:${id}`,
    thread: target(id),
    title: `Thread ${id}`,
    repos: ["acme/web"],
    branch: "feature",
    state: "done",
    machine: "asleep",
    at: at(60),
    stateAt: at(60),
    ...overrides,
  } satisfies AldoHomeConversation;
}

function pullRequest(id: string, overrides: Partial<AldoHomePullRequest> = {}) {
  return {
    environmentId: `aldo-${id}`,
    thread: target(id),
    threadTitle: `Thread ${id}`,
    repo: "acme/web",
    number: 1,
    url: "https://github.com/acme/web/pull/1",
    title: "Add CSV export",
    status: "watching",
    stage: "checks-running",
    checks: { passed: 9, failed: 0, running: 3 },
    deploy: null,
    followups: 0,
    reviewsExhausted: false,
    greenSince: null,
    mergesAt: null,
    mergedAt: null,
    updatedAt: at(5),
    ...overrides,
  } satisfies AldoHomePullRequest;
}

function home(
  conversations: ReadonlyArray<AldoHomeConversation>,
  pullRequests: ReadonlyArray<AldoHomePullRequest>,
): AldoHome {
  return { conversations, pullRequests, actions: [], approvals: [] } as unknown as AldoHome;
}

describe("pullRequestState", () => {
  it("gives a green check only to what shipped, and says what failed in amber's words", () => {
    const failing = pullRequestState(
      pullRequest("a", { stage: "checks-failing", checks: { passed: 11, failed: 2, running: 0 } }),
      NOW,
    );
    expect(failing).toMatchObject({ tone: "failing", words: "2 checks failing" });
    expect(
      pullRequestState(pullRequest("a", { stage: "checks-failing", checks: null }), NOW).words,
    ).toBe("Checks failing");
    expect(pullRequestState(pullRequest("a"), NOW)).toMatchObject({
      tone: "running",
      words: "Checks 9 of 12",
    });
    expect(
      pullRequestState(pullRequest("a", { status: "merged", stage: "deployed" }), NOW),
    ).toMatchObject({ tone: "shipped", words: "Deployed" });
    expect(
      pullRequestState(pullRequest("a", { status: "merged", stage: "deploy-failed" }), NOW),
    ).toMatchObject({ tone: "failing", words: "Deploy failed" });
    expect(pullRequestState(pullRequest("a", { stage: "draft" }), NOW).tone).toBe("draft");
  });

  it("says when Aldo merges a green one on its own, that a held one waits, and that one with no countdown is the user's", () => {
    const coming = pullRequest("a", { stage: "green", mergesAt: at(-9) });
    expect(pullRequestState(coming, NOW)).toMatchObject({
      tone: "merging",
      words: "Merges in 9 min",
    });
    expect(pullRequestState(pullRequest("a", { stage: "green", mergesAt: at(1) }), NOW).words).toBe(
      "Merging",
    );
    expect(pullRequestState(pullRequest("a", { stage: "green", held: true }), NOW)).toMatchObject({
      tone: "yours",
      words: "Held for your merge",
    });
    expect(pullRequestState(pullRequest("a", { stage: "green" }), NOW)).toMatchObject({
      tone: "yours",
      words: "Ready to merge",
    });
  });
});

describe("mergeWords", () => {
  it("counts down within the hour, and gives the time otherwise or for a line that isn't redrawn", () => {
    expect(mergeWords(at(-0.5), NOW)).toBe("Merges in 1 min");
    expect(mergeWords(at(-90), NOW)).toMatch(/^Merges at /);
    expect(mergeWords(at(-9), NOW, true)).toMatch(/^Merges at /);
    expect(mergeWords(at(0), NOW)).toBe("Merging");
  });
});

describe("resultState", () => {
  it("is done without pull requests, and otherwise the most pressing one, numbered when there are several", () => {
    expect(resultState([], NOW)).toMatchObject({ tone: "done", pullRequest: null });
    const shipped = pullRequest("a", { number: 3, status: "merged", stage: "deployed" });
    const failing = pullRequest("a", { number: 4, stage: "checks-failing" });
    expect(resultState([shipped], NOW).words).toBe("Deployed");
    expect(resultState([shipped, failing], NOW)).toMatchObject({
      tone: "failing",
      words: "#4: Checks failing",
    });
  });
});

describe("finishedResults", () => {
  it("keeps done threads whose pull requests are on their way, what failed first, then the soonest merge, then the newest", () => {
    const results = finishedResults(
      home(
        [
          conversation("running", { stateAt: at(10) }),
          conversation("merging", { stateAt: at(200) }),
          conversation("failing", { stateAt: at(300) }),
          conversation("later", { stateAt: at(5) }),
          conversation("draft", { stateAt: at(1) }),
        ],
        [
          pullRequest("running"),
          pullRequest("merging", { stage: "green", mergesAt: at(-9) }),
          pullRequest("failing", { stage: "checks-failing" }),
          pullRequest("later", { stage: "green", mergesAt: at(-30) }),
          pullRequest("draft", { stage: "draft" }),
        ],
      ),
      NOW,
    );
    expect(results.map((r) => r.conversation.ref)).toEqual([
      "m:failing",
      "m:merging",
      "m:later",
      "m:draft",
      "m:running",
    ]);
    expect(results.map(onlyWaiting)).toEqual([false, false, false, false, true]);
    expect(results[0]).toMatchObject({ key: "finished:m:failing", at: at(300) });
  });

  it("leaves out what's still going, put away, a routine's run, shipped, or in Needs you", () => {
    const results = finishedResults(
      home(
        [
          conversation("working", { state: "working" }),
          conversation("settled", { settled: true }),
          conversation("routine", { routine: "r1" }),
          conversation("shipped"),
          conversation("merge-is-theirs"),
          conversation("held"),
          conversation("asks", {
            state: "waiting",
            pending: {
              kind: "question",
              requestId: "q1",
              questions: [{ id: "q", header: "Which", question: "Which one?", options: [] }],
            } as never,
          }),
          conversation("deploying"),
        ],
        [
          pullRequest("working", { stage: "checks-failing" }),
          pullRequest("settled", { stage: "checks-failing" }),
          pullRequest("routine", { stage: "checks-failing" }),
          pullRequest("shipped", { status: "merged", stage: "deployed" }),
          pullRequest("merge-is-theirs", { stage: "green" }),
          pullRequest("held", { stage: "green", held: true }),
          pullRequest("asks", { stage: "checks-failing" }),
          pullRequest("deploying", { status: "merged", stage: "deploying" }),
        ],
      ),
      NOW,
    );
    expect(results.map((r) => r.conversation.ref)).toEqual(["m:deploying"]);
    expect(results[0]!.state.words).toBe("Deploying");
  });
});

describe("receipt lines", () => {
  it("say what the checks say and how often Aldo sent it back", () => {
    expect(checksLine({ passed: 14, failed: 0, running: 0 })).toBe("14 checks passed");
    expect(checksLine({ passed: 11, failed: 2, running: 0 })).toBe(
      "11 of 13 checks passed, 2 failing",
    );
    expect(checksLine({ passed: 9, failed: 0, running: 3 })).toBe(
      "9 of 12 checks passed, 3 running",
    );
    expect(checksLine({ passed: 0, failed: 0, running: 0 })).toBeNull();
    expect(checksLine(null)).toBeNull();
    expect(followupsLine(0)).toBeNull();
    expect(followupsLine(1)).toBe("Aldo sent it back to the agent once");
    expect(followupsLine(3)).toBe("Aldo sent it back to the agent 3 times");
  });
});
