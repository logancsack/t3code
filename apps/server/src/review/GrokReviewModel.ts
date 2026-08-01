import type {
  GrokReviewFinding,
  GrokReviewReasoningEffort,
  GrokReviewReport,
  GrokReviewSeverity,
  GrokReviewStatus,
} from "@t3tools/contracts";
import { TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const MAX_REVIEW_FINDINGS = 20;
export const MAX_REVIEW_LIST_ENTRIES = 8;
export const MAX_REVIEW_SUMMARY_CHARS = 2_000;
export const MAX_REVIEW_CATEGORY_CHARS = 120;
export const MAX_REVIEW_TITLE_CHARS = 240;
export const MAX_REVIEW_PATH_CHARS = 500;
export const MAX_REVIEW_EVIDENCE_CHARS = 500;
export const MAX_REVIEW_IMPACT_CHARS = 350;
export const MAX_REVIEW_SUGGESTION_CHARS = 500;
export const MAX_REVIEW_VERIFICATION_CHARS = 350;
export const MAX_REVIEW_LIST_ENTRY_CHARS = 300;
export const MAX_REVIEW_DELEGATION_CHARS = 800;
export const MAX_REVIEW_DELEGATION_PATHS = 8;
export const GROK_REVIEW_FINDINGS_OMITTED_LIMITATION =
  "Some model-proposed findings were omitted because they were malformed or exceeded the report limit.";

/**
 * Grok's constrained output is intentionally decoded through a permissive wire
 * shape first. Real models still occasionally emit null for optional fields or
 * exceed a presentation bound by a few characters. Rejecting the whole agent
 * result for those repairable differences made otherwise useful reviews
 * disappear, so normalization below restores the strict canonical shape.
 */
const GrokReviewCandidateFindingWire = Schema.Struct({
  severity: Schema.Literals(["blocker", "high", "medium", "low"]),
  confidence: Schema.Number,
  category: Schema.String,
  title: Schema.String,
  path: Schema.String,
  startLine: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  endLine: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  evidence: Schema.String,
  impact: Schema.String,
  suggestion: Schema.String,
  verification: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const GrokReviewDelegationWire = Schema.Struct({
  objective: Schema.String,
  paths: Schema.Array(Schema.String),
});

export const GrokReviewCandidateWire = Schema.Struct({
  summary: Schema.String,
  findings: Schema.Array(GrokReviewCandidateFindingWire),
  coverage: Schema.Array(Schema.String),
  limitations: Schema.Array(Schema.String),
  delegation: Schema.optionalKey(Schema.NullOr(GrokReviewDelegationWire)),
});
export type GrokReviewCandidateWire = typeof GrokReviewCandidateWire.Type;

export const GrokReviewVerificationWire = Schema.Struct({
  summary: Schema.String,
  findings: Schema.Array(GrokReviewCandidateFindingWire),
  coverage: Schema.Array(Schema.String),
  limitations: Schema.Array(Schema.String),
  needsHighEffortReview: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  escalationReason: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type GrokReviewVerificationWire = typeof GrokReviewVerificationWire.Type;

const boundedNonEmpty = (maxLength: number) =>
  TrimmedNonEmptyString.check(Schema.isMaxLength(maxLength));
const PositiveLine = Schema.Int.check(Schema.isGreaterThan(0));
const Confidence = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }));

export const GrokReviewCandidateFinding = Schema.Struct({
  severity: Schema.Literals(["blocker", "high", "medium", "low"]),
  confidence: Confidence,
  category: boundedNonEmpty(MAX_REVIEW_CATEGORY_CHARS),
  title: boundedNonEmpty(MAX_REVIEW_TITLE_CHARS),
  path: boundedNonEmpty(MAX_REVIEW_PATH_CHARS),
  startLine: Schema.optionalKey(PositiveLine),
  endLine: Schema.optionalKey(PositiveLine),
  evidence: boundedNonEmpty(MAX_REVIEW_EVIDENCE_CHARS),
  impact: boundedNonEmpty(MAX_REVIEW_IMPACT_CHARS),
  suggestion: boundedNonEmpty(MAX_REVIEW_SUGGESTION_CHARS),
  verification: Schema.optionalKey(boundedNonEmpty(MAX_REVIEW_VERIFICATION_CHARS)),
}).check(
  Schema.makeFilter(
    (finding) =>
      finding.endLine === undefined ||
      (finding.startLine !== undefined && finding.endLine >= finding.startLine) ||
      "endLine requires startLine and must be greater than or equal to it.",
  ),
);
export type GrokReviewCandidateFinding = typeof GrokReviewCandidateFinding.Type;

export const GrokReviewDelegation = Schema.Struct({
  objective: boundedNonEmpty(MAX_REVIEW_DELEGATION_CHARS),
  paths: Schema.Array(boundedNonEmpty(MAX_REVIEW_PATH_CHARS)).check(
    Schema.isMaxLength(MAX_REVIEW_DELEGATION_PATHS),
  ),
});
export type GrokReviewDelegation = typeof GrokReviewDelegation.Type;

export const GrokReviewCandidate = Schema.Struct({
  summary: boundedNonEmpty(MAX_REVIEW_SUMMARY_CHARS),
  findings: Schema.Array(GrokReviewCandidateFinding).check(Schema.isMaxLength(MAX_REVIEW_FINDINGS)),
  coverage: Schema.Array(boundedNonEmpty(MAX_REVIEW_LIST_ENTRY_CHARS)).check(
    Schema.isMaxLength(MAX_REVIEW_LIST_ENTRIES),
  ),
  limitations: Schema.Array(boundedNonEmpty(MAX_REVIEW_LIST_ENTRY_CHARS)).check(
    Schema.isMaxLength(MAX_REVIEW_LIST_ENTRIES),
  ),
  delegation: Schema.NullOr(GrokReviewDelegation),
});
export type GrokReviewCandidate = typeof GrokReviewCandidate.Type;

export const GrokReviewVerification = Schema.Struct({
  summary: boundedNonEmpty(MAX_REVIEW_SUMMARY_CHARS),
  findings: Schema.Array(GrokReviewCandidateFinding).check(Schema.isMaxLength(MAX_REVIEW_FINDINGS)),
  coverage: Schema.Array(boundedNonEmpty(MAX_REVIEW_LIST_ENTRY_CHARS)).check(
    Schema.isMaxLength(MAX_REVIEW_LIST_ENTRIES),
  ),
  limitations: Schema.Array(boundedNonEmpty(MAX_REVIEW_LIST_ENTRY_CHARS)).check(
    Schema.isMaxLength(MAX_REVIEW_LIST_ENTRIES),
  ),
  needsHighEffortReview: Schema.Boolean,
  escalationReason: Schema.NullOr(Schema.String.check(Schema.isMaxLength(800))),
});
export type GrokReviewVerification = typeof GrokReviewVerification.Type;

function boundedText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : trimmed.slice(0, maxLength).trimEnd();
}

function boundedStrings(values: ReadonlyArray<string>): Array<string> {
  return [
    ...new Set(
      values.map((value) => boundedText(value, MAX_REVIEW_LIST_ENTRY_CHARS)).filter(Boolean),
    ),
  ].slice(0, MAX_REVIEW_LIST_ENTRIES);
}

function positiveLine(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function normalizeCandidateFinding(
  finding: typeof GrokReviewCandidateFindingWire.Type,
): GrokReviewCandidateFinding | null {
  const category = boundedText(finding.category, MAX_REVIEW_CATEGORY_CHARS);
  const title = boundedText(finding.title, MAX_REVIEW_TITLE_CHARS);
  const path = boundedText(finding.path, MAX_REVIEW_PATH_CHARS);
  const evidence = boundedText(finding.evidence, MAX_REVIEW_EVIDENCE_CHARS);
  const impact = boundedText(finding.impact, MAX_REVIEW_IMPACT_CHARS);
  const suggestion = boundedText(finding.suggestion, MAX_REVIEW_SUGGESTION_CHARS);
  if (!category || !title || !path || !evidence || !impact || !suggestion) return null;

  const startLine = positiveLine(finding.startLine);
  const candidateEndLine = positiveLine(finding.endLine);
  const endLine =
    startLine !== undefined && candidateEndLine !== undefined && candidateEndLine >= startLine
      ? candidateEndLine
      : undefined;
  const verification = finding.verification
    ? boundedText(finding.verification, MAX_REVIEW_VERIFICATION_CHARS)
    : undefined;

  return {
    severity: finding.severity,
    confidence: Math.max(0, Math.min(1, finding.confidence)),
    category,
    title,
    path,
    ...(startLine === undefined ? {} : { startLine }),
    ...(endLine === undefined ? {} : { endLine }),
    evidence,
    impact,
    suggestion,
    ...(verification ? { verification } : {}),
  };
}

function normalizedFindings(findings: ReadonlyArray<typeof GrokReviewCandidateFindingWire.Type>): {
  readonly findings: Array<GrokReviewCandidateFinding>;
  readonly omitted: boolean;
} {
  const validFindings = findings.flatMap((finding) => {
    const normalized = normalizeCandidateFinding(finding);
    return normalized ? [normalized] : [];
  });
  const normalized = validFindings.slice(0, MAX_REVIEW_FINDINGS);
  return { findings: normalized, omitted: normalized.length < findings.length };
}

export function normalizeGrokReviewCandidate(
  candidate: GrokReviewCandidateWire,
): GrokReviewCandidate {
  const normalized = normalizedFindings(candidate.findings);
  const objective = candidate.delegation
    ? boundedText(candidate.delegation.objective, MAX_REVIEW_DELEGATION_CHARS)
    : "";
  const delegationPaths = candidate.delegation
    ? candidate.delegation.paths
        .map((value) => boundedText(value, MAX_REVIEW_PATH_CHARS))
        .filter(Boolean)
        .slice(0, MAX_REVIEW_DELEGATION_PATHS)
    : [];
  return {
    summary:
      boundedText(candidate.summary, MAX_REVIEW_SUMMARY_CHARS) ||
      "The reviewer returned no summary.",
    findings: normalized.findings,
    coverage: boundedStrings(candidate.coverage),
    limitations: boundedStrings([
      ...(normalized.omitted ? [GROK_REVIEW_FINDINGS_OMITTED_LIMITATION] : []),
      ...candidate.limitations,
    ]),
    delegation: objective ? { objective, paths: delegationPaths } : null,
  };
}

export function normalizeGrokReviewVerification(
  verification: GrokReviewVerificationWire,
): GrokReviewVerification {
  const normalized = normalizedFindings(verification.findings);
  const escalationReason = verification.escalationReason
    ? boundedText(verification.escalationReason, MAX_REVIEW_DELEGATION_CHARS)
    : null;
  return {
    summary:
      boundedText(verification.summary, MAX_REVIEW_SUMMARY_CHARS) ||
      "The verifier returned no summary.",
    findings: normalized.findings,
    coverage: boundedStrings(verification.coverage),
    limitations: boundedStrings([
      ...(normalized.omitted ? [GROK_REVIEW_FINDINGS_OMITTED_LIMITATION] : []),
      ...verification.limitations,
    ]),
    needsHighEffortReview: verification.needsHighEffortReview ?? false,
    escalationReason,
  };
}

const severityRank: Readonly<Record<GrokReviewSeverity, number>> = {
  blocker: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function sortFindings(
  findings: ReadonlyArray<GrokReviewFinding>,
): ReadonlyArray<GrokReviewFinding> {
  return findings.toSorted((left, right) => {
    const severity = severityRank[left.severity] - severityRank[right.severity];
    if (severity !== 0) return severity;
    const path = left.path.localeCompare(right.path);
    if (path !== 0) return path;
    return (
      (left.startLine ?? Number.MAX_SAFE_INTEGER) - (right.startLine ?? Number.MAX_SAFE_INTEGER)
    );
  });
}

export function deriveReviewStatus(input: {
  readonly findings: ReadonlyArray<GrokReviewFinding>;
  readonly partial: boolean;
}): GrokReviewStatus {
  if (input.partial) return "partial";
  return input.findings.length === 0 ? "pass" : "findings";
}

function findingLocation(finding: GrokReviewFinding): string {
  if (finding.startLine === undefined) return finding.path;
  if (finding.endLine !== undefined && finding.endLine !== finding.startLine) {
    return `${finding.path}:${finding.startLine}-${finding.endLine}`;
  }
  return `${finding.path}:${finding.startLine}`;
}

export function renderGrokReviewMarkdown(input: {
  readonly status: GrokReviewStatus;
  readonly summary: string;
  readonly findings: ReadonlyArray<GrokReviewFinding>;
  readonly coverage: ReadonlyArray<string>;
  readonly limitations: ReadonlyArray<string>;
  readonly model: string;
  readonly reasoningEffort: GrokReviewReasoningEffort;
  readonly escalatedToHigh: boolean;
  readonly runId: string;
}): string {
  const lines = [
    "## Aldo Review",
    "",
    input.summary.trim(),
    "",
    `**Result:** ${input.status} · **Model:** ${input.model} · **Reasoning:** ${
      input.escalatedToHigh ? "medium → high" : input.reasoningEffort
    }`,
  ];

  if (input.findings.length === 0) {
    lines.push(
      "",
      input.status === "partial"
        ? "No actionable findings were verified in the reviewed portion."
        : "No actionable findings were verified.",
    );
  } else {
    lines.push("", `### Findings (${input.findings.length})`);
    for (const finding of input.findings) {
      lines.push(
        "",
        `#### ${finding.severity.toUpperCase()}: ${finding.title}`,
        "",
        `\`${findingLocation(finding)}\` · confidence ${Math.round(finding.confidence * 100)}%`,
        "",
        finding.impact,
        "",
        `Evidence: ${finding.evidence}`,
        "",
        `Suggested change: ${finding.suggestion}`,
      );
      if (finding.verification) {
        lines.push("", `Verification: ${finding.verification}`);
      }
    }
  }

  if (input.coverage.length > 0) {
    lines.push("", "### Coverage", "", ...input.coverage.map((entry) => `- ${entry}`));
  }
  if (input.limitations.length > 0) {
    lines.push("", "### Limitations", "", ...input.limitations.map((entry) => `- ${entry}`));
  }
  lines.push("", `<!-- aldo-review:${input.runId} -->`);
  return lines.join("\n");
}

export function withMarkdown(report: Omit<GrokReviewReport, "markdown">): GrokReviewReport {
  return {
    ...report,
    markdown: renderGrokReviewMarkdown({
      status: report.status,
      summary: report.summary,
      findings: report.findings,
      coverage: report.coverage,
      limitations: report.limitations,
      model: report.resolvedModel,
      reasoningEffort: report.reasoningEffort,
      escalatedToHigh: report.escalatedToHigh,
      runId: report.runId,
    }),
  };
}
