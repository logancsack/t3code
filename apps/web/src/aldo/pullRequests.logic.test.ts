import { describe, expect, it } from "vite-plus/test";

import { aldoPullRequestMergeable, aldoPullRequestStatusLabel } from "./pullRequests.logic";

const watching = { status: "watching" as const, followups: 0 };

describe("aldoPullRequestStatusLabel", () => {
  it("reads as before with an Aldo that doesn't report stages", () => {
    expect(aldoPullRequestStatusLabel(watching)).toBe("watching");
    expect(aldoPullRequestStatusLabel({ ...watching, followups: 1 })).toBe("1 fix");
    expect(aldoPullRequestStatusLabel({ ...watching, followups: 3 })).toBe("3 fixes");
    expect(aldoPullRequestStatusLabel({ status: "merged", followups: 2 })).toBe("merged");
  });

  it("counts checks while they run, and the agent's fixes", () => {
    const checks = { passed: 3, failed: 0, running: 1 };
    expect(aldoPullRequestStatusLabel({ ...watching, stage: "checks-running", checks })).toBe(
      "checks 3/4",
    );
    expect(aldoPullRequestStatusLabel({ ...watching, stage: "checks-running", checks: null })).toBe(
      "checks running",
    );
    expect(
      aldoPullRequestStatusLabel({ ...watching, followups: 2, stage: "checks-running", checks }),
    ).toBe("checks 3/4 · 2 fixes");
  });

  it("says what's failing, passed, merged and deployed", () => {
    expect(
      aldoPullRequestStatusLabel({
        ...watching,
        stage: "checks-failing",
        checks: { passed: 1, failed: 2, running: 0 },
      }),
    ).toBe("2 checks failing");
    expect(aldoPullRequestStatusLabel({ ...watching, stage: "green" })).toBe("checks passed");
    expect(aldoPullRequestStatusLabel({ ...watching, stage: "deploying" })).toBe(
      "merged · deploying",
    );
    expect(aldoPullRequestStatusLabel({ status: "merged", followups: 1, stage: "deployed" })).toBe(
      "deployed",
    );
    expect(
      aldoPullRequestStatusLabel({ status: "merged", followups: 0, stage: "deploy-failed" }),
    ).toBe("deploy failed");
    expect(aldoPullRequestStatusLabel({ status: "merged", followups: 0, stage: "merged" })).toBe(
      "merged",
    );
    expect(aldoPullRequestStatusLabel({ status: "stopped", followups: 0, stage: "stopped" })).toBe(
      "not followed",
    );
  });
});

describe("aldoPullRequestMergeable", () => {
  it("offers merging only a followed pull request whose checks passed", () => {
    expect(aldoPullRequestMergeable({ ...watching, stage: "green" })).toBe(true);
    expect(aldoPullRequestMergeable({ ...watching, stage: "checks-running" })).toBe(false);
    expect(aldoPullRequestMergeable({ ...watching, stage: "draft" })).toBe(false);
    expect(aldoPullRequestMergeable({ ...watching })).toBe(false);
    expect(aldoPullRequestMergeable({ status: "stopped", followups: 0, stage: "green" })).toBe(
      false,
    );
  });
});
