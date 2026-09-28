// How a pull request Aldo follows reads in the thread's Previews menu.

export type AldoPullRequestStage =
  | "draft"
  | "checks-running"
  | "checks-failing"
  | "green"
  | "deploying"
  | "deployed"
  | "deploy-failed"
  | "merged"
  | "closed"
  | "stopped";

export interface AldoCheckCounts {
  readonly passed: number;
  readonly failed: number;
  readonly running: number;
}

export interface AldoPullRequestStatusInput {
  readonly status: "watching" | "merged" | "closed" | "stopped";
  readonly followups: number;
  /** Reported by an Aldo that reads stages; an older one leaves them out. */
  readonly stage?: AldoPullRequestStage;
  readonly checks?: AldoCheckCounts | null;
}

const checkCount = (count: number) => `${count} check${count === 1 ? "" : "s"}`;
const fixCount = (count: number) => `${count} fix${count === 1 ? "" : "es"}`;

/** A few words on where the pull request is: checks → merged → deployed. */
export function aldoPullRequestStatusLabel(pr: AldoPullRequestStatusInput): string {
  const fixes = pr.status === "watching" && pr.followups ? ` · ${fixCount(pr.followups)}` : "";
  switch (pr.stage) {
    case undefined:
      if (pr.status !== "watching") return pr.status;
      return pr.followups ? fixCount(pr.followups) : "watching";
    case "draft":
      return `draft${fixes}`;
    case "checks-running": {
      const total = pr.checks ? pr.checks.passed + pr.checks.failed + pr.checks.running : 0;
      return `${total ? `checks ${pr.checks!.passed}/${total}` : "checks running"}${fixes}`;
    }
    case "checks-failing":
      return `${checkCount(pr.checks?.failed || 1)} failing${fixes}`;
    case "green":
      return `checks passed${fixes}`;
    case "deploying":
      return "merged · deploying";
    case "deployed":
      return "deployed";
    case "deploy-failed":
      return "deploy failed";
    case "stopped":
      return "not followed";
    default:
      return pr.stage;
  }
}

/** Whether the user can merge it from the menu (Aldo checks again before merging). */
export function aldoPullRequestMergeable(pr: AldoPullRequestStatusInput): boolean {
  return pr.status === "watching" && pr.stage === "green";
}
