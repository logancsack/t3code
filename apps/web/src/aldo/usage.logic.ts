// How the Usage page counts a cloud agent this browser isn't connected to
// (see usage.ts). Pure, so it's tested on its own.

import { UsageSummary } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** An environment's line on the Usage page, as state/usage.ts reads it. */
interface UsageStatus {
  readonly environmentId: string;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly summary: UsageSummary | null;
}

/** Aldo's answers for the window, by environment id; or still loading; or none (an Aldo without them, or out of reach). */
export type AldoUsageAnswers = "loading" | "none" | Readonly<Record<string, unknown>>;

export const ALDO_UNREPORTED_USAGE = "This cloud agent hasn't reported its usage yet.";

const decodeSummary = Schema.decodeUnknownOption(UsageSummary);

/**
 * An agent that answered counts as it answered, and one still answering is
 * waited for. One that couldn't (it's asleep, so not connected) counts from
 * Aldo's answer, is waited for while that loads, and without one is left out
 * as unreported.
 */
export function withAldoUsage<S extends UsageStatus>(status: S, answers: AldoUsageAnswers): S {
  if (status.summary !== null || status.isPending) return status;
  if (answers === "loading") return { ...status, isPending: true, error: null };
  const answer = answers === "none" ? Option.none() : decodeSummary(answers[status.environmentId]);
  return Option.isSome(answer)
    ? { ...status, error: null, summary: answer.value }
    : { ...status, error: ALDO_UNREPORTED_USAGE };
}

/** One line for the agents left out, instead of one each. */
export function aldoUnreportedUsageNote(count: number): string {
  return count === 1
    ? "Usage from 1 cloud agent isn't counted yet: it reports it the next time it runs."
    : `Usage from ${count} cloud agents isn't counted yet: each reports it the next time it runs.`;
}
