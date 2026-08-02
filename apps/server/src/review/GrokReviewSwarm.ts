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
  type GrokReviewCandidate as GrokReviewCandidateType,
  GrokReviewCandidateWire,
  type GrokReviewVerification as GrokReviewVerificationType,
  GrokReviewVerificationWire,
  GROK_REVIEW_FINDINGS_OMITTED_LIMITATION,
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
  normalizeGrokReviewCandidate,
  normalizeGrokReviewVerification,
  sortFindings,
  withMarkdown,
} from "./GrokReviewModel.ts";
import {
  buildDelegatedReviewPrompt,
  buildLeadReviewPrompt,
  buildVerificationPrompt,
  DEFAULT_REVIEWER_ROLES,
  SUPPLEMENTAL_REVIEWER_ROLES,
  type GrokReviewPromptContext,
} from "./GrokReviewPrompts.ts";
import {
  decodeGitPath,
  redactSensitiveContextWithMetadata,
  redactSensitiveDiffWithMetadata,
} from "./GrokReviewPrivacy.ts";

const MAX_LEAD_CONCURRENCY = 6;
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
  const lines = changedLines.get(normalizeFindingPath(finding.path));
  return (
    lines?.has(finding.startLine) === true &&
    (finding.endLine === undefined || lines.has(finding.endLine))
  );
}

function runCandidate(
  agent: GrokReviewAgent,
  input: {
    readonly label: string;
    readonly cwd: string;
    readonly prompt: string;
    readonly allowTools: boolean;
  },
): Effect.Effect<AgentOutcome> {
  return agent
    .run({
      cwd: input.cwd,
      prompt: input.prompt,
      outputSchema: GrokReviewCandidateWire,
      effort: "medium",
      allowTools: input.allowTools,
    })
    .pipe(
      Effect.map(
        (candidate): AgentOutcome => ({
          label: input.label,
          result: { _tag: "Success", candidate: normalizeGrokReviewCandidate(candidate) },
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

function runVerification(
  agent: GrokReviewAgent,
  input: {
    readonly cwd: string;
    readonly prompt: string;
    readonly effort: "medium" | "high";
  },
) {
  return agent
    .run({
      cwd: input.cwd,
      prompt: input.prompt,
      outputSchema: GrokReviewVerificationWire,
      effort: input.effort,
      allowTools: false,
    })
    .pipe(Effect.map(normalizeGrokReviewVerification));
}

function reviewerFailureSummary(error: GrokReviewError): string {
  return `${error.operation}: ${error.message}`.replace(/\s+/g, " ").slice(0, 220);
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

function contextCoverage(
  sections: ReadonlyArray<{ readonly title: string }>,
): ReadonlyArray<string> {
  if (sections.length === 0) return [];

  return [
    `Repository context supplied (${sections.length} section${sections.length === 1 ? "" : "s"}): ${sections
      .map((section) => section.title)
      .join(", ")}`,
  ];
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
  readonly supplementalAgent?: GrokReviewAgent;
  readonly supplementalUnavailableReason?: string;
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
  const redactedDiff = redactSensitiveDiffWithMetadata(input.source.diff);
  let repositoryContextRedacted = false;
  const repositoryContext = (input.request.context?.sections ?? []).map((section) => {
    const title = redactSensitiveContextWithMetadata(section.title);
    const content = redactSensitiveContextWithMetadata(section.content);
    repositoryContextRedacted ||= title.redacted || content.redacted;
    return { title: title.text, content: content.text };
  });
  const context: GrokReviewPromptContext = {
    targetLabel: input.source.title,
    diff: redactedDiff.diff,
    focus: input.request.focus ?? [],
    repositoryContext,
  };

  const leadRequests = [
    ...DEFAULT_REVIEWER_ROLES.map((role) => ({ role, agent: input.agent })),
    ...(input.supplementalAgent
      ? SUPPLEMENTAL_REVIEWER_ROLES.map((role) => ({
          role,
          agent: input.supplementalAgent!,
        }))
      : []),
  ];
  const leadOutcomes = yield* Effect.forEach(
    leadRequests,
    ({ role, agent }) =>
      runCandidate(agent, {
        label: role.id,
        cwd: input.request.cwd,
        prompt: buildLeadReviewPrompt(role, context),
        allowTools: false,
      }),
    { concurrency: MAX_LEAD_CONCURRENCY },
  );
  const leadCandidates = leadOutcomes.flatMap((outcome) =>
    outcome.result._tag === "Success" ? [outcome.result.candidate] : [],
  );
  if (leadCandidates.length === 0) {
    const diagnostics = leadOutcomes
      .flatMap((outcome) =>
        outcome.result._tag === "Failure"
          ? [`${outcome.label}: ${reviewerFailureSummary(outcome.result.error)}`]
          : [],
      )
      .join("; ")
      .slice(0, 1_200);
    return yield* new GrokReviewError({
      operation: "GrokReviewSwarm.leads",
      detail: `Every Aldo Review specialist failed before producing a result.${
        diagnostics ? ` ${diagnostics}` : ""
      }`,
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
        allowTools: true,
      }),
    { concurrency: MAX_DELEGATED_REVIEWS },
  );
  const delegatedCandidates = delegatedOutcomes.flatMap((outcome) =>
    outcome.result._tag === "Success" ? [outcome.result.candidate] : [],
  );
  const candidates = [...leadCandidates, ...delegatedCandidates];

  const mediumResult = yield* Effect.result(
    runVerification(input.agent, {
      cwd: input.request.cwd,
      prompt: buildVerificationPrompt({ context, candidates, highEffort: false }),
      effort: "medium",
    }),
  );

  let verification: GrokReviewVerificationType;
  let highEffortFailed = false;
  let highEffortSucceeded = false;
  let highEffortAttempted = false;
  let highEffortUnavailable = false;
  let mediumVerificationFailed = false;
  let mediumVerificationOmittedFindings = false;

  if (mediumResult._tag === "Failure") {
    mediumVerificationFailed = true;
    if (input.agent.supportsHighEffort === false) {
      return yield* new GrokReviewError({
        operation: "GrokReviewSwarm.verify",
        detail:
          "Medium-effort review verification failed and the selected provider does not expose a high-effort fallback.",
        cause: mediumResult.failure,
      });
    }
    highEffortAttempted = true;
    const highResult = yield* Effect.result(
      runVerification(input.agent, {
        cwd: input.request.cwd,
        prompt: buildVerificationPrompt({ context, candidates, highEffort: true }),
        effort: "high",
      }),
    );
    if (highResult._tag === "Failure") {
      return yield* new GrokReviewError({
        operation: "GrokReviewSwarm.verify",
        detail: "Medium and high-effort review verification both failed.",
        cause: highResult.failure,
      });
    }
    verification = highResult.success;
    highEffortSucceeded = true;
  } else {
    verification = mediumResult.success;
    mediumVerificationOmittedFindings = verification.limitations.includes(
      GROK_REVIEW_FINDINGS_OMITTED_LIMITATION,
    );
    const shouldEscalate =
      verification.needsHighEffortReview ||
      verification.findings.some(
        (finding) =>
          (finding.severity === "blocker" || finding.severity === "high") &&
          finding.confidence < 0.8,
      );
    if (shouldEscalate) {
      highEffortUnavailable = input.agent.supportsHighEffort === false;
      highEffortAttempted = !highEffortUnavailable;
      const highCandidate: GrokReviewCandidateType = {
        summary: verification.summary,
        findings: verification.findings,
        coverage: verification.coverage,
        limitations: verification.limitations,
        delegation: null,
      };
      if (!highEffortUnavailable) {
        const highResult = yield* Effect.result(
          runVerification(input.agent, {
            cwd: input.request.cwd,
            prompt: buildVerificationPrompt({
              context,
              candidates: [...candidates, highCandidate],
              highEffort: true,
            }),
            effort: "high",
          }),
        );
        if (highResult._tag === "Success") {
          verification = highResult.success;
          highEffortSucceeded = true;
        } else {
          highEffortFailed = true;
        }
      }
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
  const normalizationOmittedFindings =
    mediumVerificationOmittedFindings ||
    [...candidates, verification].some((candidate) =>
      candidate.limitations.includes(GROK_REVIEW_FINDINGS_OMITTED_LIMITATION),
    );
  const partial =
    input.source.truncated ||
    redactedDiff.redacted ||
    repositoryContextRedacted ||
    failedOutcomes.length > 0 ||
    input.supplementalUnavailableReason !== undefined ||
    (input.request.context?.limitations.length ?? 0) > 0 ||
    normalizationOmittedFindings ||
    highEffortFailed ||
    highEffortUnavailable;
  const limitations = uniqueStrings([
    ...(normalizationOmittedFindings ? [GROK_REVIEW_FINDINGS_OMITTED_LIMITATION] : []),
    ...(input.source.truncated ? ["The selected diff was truncated before model review."] : []),
    ...(redactedDiff.redacted
      ? ["Sensitive-file patches were redacted and could not be reviewed."]
      : []),
    ...(repositoryContextRedacted
      ? ["Potential secrets in repository context were redacted before model review."]
      : []),
    ...(input.supplementalUnavailableReason ? [input.supplementalUnavailableReason] : []),
    ...failedOutcomes.map((outcome) =>
      outcome.result._tag === "Failure"
        ? `${outcome.label} reviewer failed (${reviewerFailureSummary(outcome.result.error)}).`
        : "",
    ),
    ...(mediumVerificationFailed
      ? ["Medium-effort verification failed; the high-effort fallback completed."]
      : []),
    ...(highEffortFailed
      ? ["High-effort escalation failed; the medium-effort verification is shown."]
      : []),
    ...(highEffortUnavailable
      ? [
          "The selected provider does not expose a high-effort review mode; the medium-effort verification is shown.",
        ]
      : []),
    ...verification.limitations,
    ...(input.request.context?.limitations ?? []),
  ]);
  const agentRuns =
    leadRequests.length + delegatedOutcomes.length + 1 + (highEffortAttempted ? 1 : 0);
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
    ...(input.supplementalAgent
      ? { supplementalModels: [input.supplementalAgent.resolvedModel] }
      : {}),
    grokBuildVersion: input.agent.grokBuildVersion,
    reasoningEffort: "medium",
    escalatedToHigh: highEffortSucceeded,
    summary: boundedText(verification.summary, MAX_REVIEW_SUMMARY_CHARS),
    findings,
    coverage: uniqueStrings([...contextCoverage(repositoryContext), ...verification.coverage]),
    limitations,
    usage: {
      agentRuns,
      mediumEffortRuns: agentRuns - (highEffortAttempted ? 1 : 0),
      highEffortRuns: highEffortAttempted ? 1 : 0,
    },
  });
  return report satisfies GrokReviewReport;
});
