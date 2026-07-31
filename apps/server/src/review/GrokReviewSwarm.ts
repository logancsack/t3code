import type {
  GrokReviewFinding,
  GrokReviewInput,
  GrokReviewReport,
  ReviewDiffPreviewSource,
} from "@t3tools/contracts";
import { GrokReviewError } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";

import type { GrokReviewAgent } from "./GrokReviewAgent.ts";
import {
  deriveReviewStatus,
  GrokReviewCandidate,
  type GrokReviewCandidate as GrokReviewCandidateType,
  GrokReviewVerification,
  MAX_REVIEW_CATEGORY_CHARS,
  MAX_REVIEW_EVIDENCE_CHARS,
  MAX_REVIEW_FINDINGS,
  MAX_REVIEW_IMPACT_CHARS,
  MAX_REVIEW_LIST_ENTRIES,
  MAX_REVIEW_LIST_ENTRY_CHARS,
  MAX_REVIEW_PATH_CHARS,
  MAX_REVIEW_SUGGESTION_CHARS,
  MAX_REVIEW_SUMMARY_CHARS,
  MAX_REVIEW_TITLE_CHARS,
  MAX_REVIEW_VERIFICATION_CHARS,
  sortFindings,
  withMarkdown,
} from "./GrokReviewModel.ts";
import {
  buildDelegatedReviewPrompt,
  buildLeadReviewPrompt,
  buildVerificationPrompt,
  DEFAULT_REVIEWER_ROLES,
  type GrokReviewPromptContext,
} from "./GrokReviewPrompts.ts";
import { decodeGitPath, redactSensitiveDiff } from "./GrokReviewPrivacy.ts";

const MAX_LEAD_CONCURRENCY = 4;
const MAX_DELEGATED_REVIEWS = 2;

interface AgentOutcome {
  readonly label: string;
  readonly result:
    | { readonly _tag: "Success"; readonly candidate: GrokReviewCandidateType }
    | { readonly _tag: "Failure"; readonly error: GrokReviewError };
}

function normalizeFindingPath(value: string): string {
  return value.trim().replace(/^\.\//, "");
}

function normalizeDiffPath(value: string): string {
  return decodeGitPath(value).replace(/^(?:\.\/|[ab]\/)/, "");
}

export function changedLinesFromDiff(diff: string): ReadonlyMap<string, ReadonlySet<number>> {
  const changed = new Map<string, Set<number>>();
  let currentPath: string | undefined;
  let currentLine: number | undefined;
  let insideHunk = false;

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      currentPath = undefined;
      currentLine = undefined;
      insideHunk = false;
      continue;
    }
    if (!insideHunk && line.startsWith("+++ ")) {
      const rawPath = line.slice(4).trim();
      currentPath = rawPath === "/dev/null" ? undefined : normalizeDiffPath(rawPath);
      currentLine = undefined;
      continue;
    }
    if (line.startsWith("@@ ")) {
      const match = /\+(\d+)(?:,\d+)?/.exec(line);
      currentLine = match ? Number(match[1]) : undefined;
      insideHunk = true;
      continue;
    }
    if (!insideHunk || currentPath === undefined || currentLine === undefined) continue;
    if (line === "\\ No newline at end of file") continue;
    if (line.startsWith("+")) {
      const lines = changed.get(currentPath) ?? new Set<number>();
      lines.add(currentLine);
      changed.set(currentPath, lines);
      currentLine += 1;
      continue;
    }
    if (!line.startsWith("-")) {
      currentLine += 1;
    }
  }

  return changed;
}

function findingIsInlineEligible(
  finding: Omit<GrokReviewFinding, "fingerprint" | "inlineEligible">,
  changedLines: ReadonlyMap<string, ReadonlySet<number>>,
): boolean {
  if (finding.startLine === undefined) return false;
  return changedLines.get(normalizeFindingPath(finding.path))?.has(finding.startLine) === true;
}

function runCandidate(
  agent: GrokReviewAgent,
  input: {
    readonly label: string;
    readonly cwd: string;
    readonly prompt: string;
  },
): Effect.Effect<AgentOutcome> {
  return agent
    .run({
      cwd: input.cwd,
      prompt: input.prompt,
      outputSchema: GrokReviewCandidate,
      effort: "medium",
    })
    .pipe(
      Effect.map(
        (candidate): AgentOutcome => ({
          label: input.label,
          result: { _tag: "Success", candidate },
        }),
      ),
      Effect.catch((error) =>
        Effect.succeed({
          label: input.label,
          result: { _tag: "Failure", error },
        } satisfies AgentOutcome),
      ),
    );
}

function boundedText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : trimmed.slice(0, maxLength).trimEnd();
}

function uniqueStrings(values: ReadonlyArray<string>): ReadonlyArray<string> {
  return [
    ...new Set(
      values.map((value) => boundedText(value, MAX_REVIEW_LIST_ENTRY_CHARS)).filter(Boolean),
    ),
  ].slice(0, MAX_REVIEW_LIST_ENTRIES);
}

function boundVerifiedFinding(
  finding: GrokReviewCandidateType["findings"][number],
): GrokReviewCandidateType["findings"][number] {
  return {
    ...finding,
    category: boundedText(finding.category, MAX_REVIEW_CATEGORY_CHARS),
    title: boundedText(finding.title, MAX_REVIEW_TITLE_CHARS),
    path: boundedText(finding.path, MAX_REVIEW_PATH_CHARS),
    evidence: boundedText(finding.evidence, MAX_REVIEW_EVIDENCE_CHARS),
    impact: boundedText(finding.impact, MAX_REVIEW_IMPACT_CHARS),
    suggestion: boundedText(finding.suggestion, MAX_REVIEW_SUGGESTION_CHARS),
    ...(finding.verification
      ? {
          verification: boundedText(finding.verification, MAX_REVIEW_VERIFICATION_CHARS),
        }
      : {}),
  };
}

export const runGrokReviewSwarm = Effect.fn("runGrokReviewSwarm")(function* (input: {
  readonly request: GrokReviewInput;
  readonly source: ReviewDiffPreviewSource;
  readonly agent: GrokReviewAgent;
}) {
  const crypto = yield* Crypto.Crypto;
  const runId = yield* crypto.randomUUIDv4.pipe(
    Effect.mapError(
      (cause) =>
        new GrokReviewError({
          operation: "GrokReviewSwarm.runId",
          detail: "Failed to create a review run identifier.",
          cause,
        }),
    ),
  );
  const context: GrokReviewPromptContext = {
    targetLabel: input.source.title,
    diff: redactSensitiveDiff(input.source.diff),
    focus: input.request.focus ?? [],
  };

  const leadOutcomes = yield* Effect.forEach(
    DEFAULT_REVIEWER_ROLES,
    (role) =>
      runCandidate(input.agent, {
        label: role.id,
        cwd: input.request.cwd,
        prompt: buildLeadReviewPrompt(role, context),
      }),
    { concurrency: MAX_LEAD_CONCURRENCY },
  );
  const leadCandidates = leadOutcomes.flatMap((outcome) =>
    outcome.result._tag === "Success" ? [outcome.result.candidate] : [],
  );
  if (leadCandidates.length === 0) {
    return yield* new GrokReviewError({
      operation: "GrokReviewSwarm.leads",
      detail: "Every Grok review specialist failed before producing a result.",
    });
  }

  const delegations = leadCandidates
    .flatMap((candidate) => (candidate.delegation ? [candidate.delegation] : []))
    .slice(0, MAX_DELEGATED_REVIEWS);
  const delegatedOutcomes = yield* Effect.forEach(
    delegations,
    (delegation, index) =>
      runCandidate(input.agent, {
        label: `delegated-${index + 1}`,
        cwd: input.request.cwd,
        prompt: buildDelegatedReviewPrompt(delegation, context),
      }),
    { concurrency: MAX_DELEGATED_REVIEWS },
  );
  const delegatedCandidates = delegatedOutcomes.flatMap((outcome) =>
    outcome.result._tag === "Success" ? [outcome.result.candidate] : [],
  );
  const candidates = [...leadCandidates, ...delegatedCandidates];

  const mediumVerification = yield* input.agent.run({
    cwd: input.request.cwd,
    prompt: buildVerificationPrompt({ context, candidates, highEffort: false }),
    outputSchema: GrokReviewVerification,
    effort: "medium",
  });
  const shouldEscalate =
    mediumVerification.needsHighEffortReview ||
    mediumVerification.findings.some(
      (finding) =>
        finding.severity === "blocker" || (finding.severity === "high" && finding.confidence < 0.8),
    );

  let verification = mediumVerification;
  let highEffortFailed = false;
  let highEffortSucceeded = false;
  if (shouldEscalate) {
    const highCandidate: GrokReviewCandidateType = {
      summary: mediumVerification.summary,
      findings: mediumVerification.findings,
      coverage: mediumVerification.coverage,
      limitations: mediumVerification.limitations,
      delegation: null,
    };
    const highResult = yield* input.agent
      .run({
        cwd: input.request.cwd,
        prompt: buildVerificationPrompt({
          context,
          candidates: [...candidates, highCandidate],
          highEffort: true,
        }),
        outputSchema: GrokReviewVerification,
        effort: "high",
      })
      .pipe(
        Effect.map((value) => ({ _tag: "Success" as const, value })),
        Effect.orElseSucceed(() => ({ _tag: "Failure" as const })),
      );
    if (highResult._tag === "Success") {
      verification = highResult.value;
      highEffortSucceeded = true;
    } else {
      highEffortFailed = true;
    }
  }

  const lineIndex = changedLinesFromDiff(input.source.diff);
  const verifiedFindings = verification.findings
    .slice(0, MAX_REVIEW_FINDINGS)
    .map(boundVerifiedFinding);
  const findingsWithFingerprint = yield* Effect.forEach(verifiedFindings, (finding) =>
    crypto
      .digest(
        "SHA-256",
        new TextEncoder().encode(
          [
            normalizeFindingPath(finding.path),
            finding.startLine ?? "",
            finding.severity,
            finding.title.trim().toLowerCase(),
          ].join("\0"),
        ),
      )
      .pipe(
        Effect.map((hash) => ({
          ...finding,
          path: normalizeFindingPath(finding.path),
          fingerprint: Encoding.encodeHex(hash),
          inlineEligible: findingIsInlineEligible(finding, lineIndex),
        })),
        Effect.mapError(
          (cause) =>
            new GrokReviewError({
              operation: "GrokReviewSwarm.fingerprint",
              detail: "Failed to fingerprint a verified review finding.",
              cause,
            }),
        ),
      ),
  );
  const findings = sortFindings([
    ...new Map(findingsWithFingerprint.map((finding) => [finding.fingerprint, finding])).values(),
  ]);

  const failedOutcomes = [...leadOutcomes, ...delegatedOutcomes].filter(
    (outcome) => outcome.result._tag === "Failure",
  );
  const partial = input.source.truncated || failedOutcomes.length > 0 || highEffortFailed;
  const limitations = uniqueStrings([
    ...(verification.findings.length > MAX_REVIEW_FINDINGS
      ? [`Only the first ${MAX_REVIEW_FINDINGS} verified findings are included.`]
      : []),
    ...(input.source.truncated ? ["The selected diff was truncated before model review."] : []),
    ...failedOutcomes.map((outcome) => `${outcome.label} reviewer did not return a result.`),
    ...(highEffortFailed
      ? ["High-effort escalation failed; the medium-effort verification is shown."]
      : []),
    ...verification.limitations,
  ]);
  const agentRuns =
    DEFAULT_REVIEWER_ROLES.length + delegatedOutcomes.length + 1 + (shouldEscalate ? 1 : 0);
  const report = withMarkdown({
    schemaVersion: 1,
    runId,
    target: {
      kind: input.source.kind,
      baseRef: input.source.baseRef,
      headRef: input.source.headRef,
      diffHash: input.source.diffHash,
    },
    status: deriveReviewStatus({ findings, partial }),
    resolvedModel: input.agent.resolvedModel,
    grokBuildVersion: input.agent.grokBuildVersion,
    reasoningEffort: "medium",
    escalatedToHigh: highEffortSucceeded,
    summary: boundedText(verification.summary, MAX_REVIEW_SUMMARY_CHARS),
    findings,
    coverage: uniqueStrings(verification.coverage),
    limitations,
    usage: {
      agentRuns,
      mediumEffortRuns: agentRuns - (shouldEscalate ? 1 : 0),
      highEffortRuns: highEffortSucceeded ? 1 : 0,
    },
  });
  return report satisfies GrokReviewReport;
});
