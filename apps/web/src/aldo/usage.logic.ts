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

/**
 * Aldo's answers for the window, by environment id (none from an Aldo without
 * them); or still loading; or failed to load.
 */
export type AldoUsageAnswers = "loading" | "failed" | Readonly<Record<string, unknown>>;

export const ALDO_UNREPORTED_USAGE = "This cloud agent hasn't reported its usage yet.";
export const ALDO_UNREAD_USAGE = "This cloud agent's usage couldn't be read.";

const decodeSummary = Schema.decodeUnknownOption(UsageSummary);

/**
 * An agent that answered counts as it answered, and a connected one (still
 * answering, or failing to) as it does. One that isn't connected (it's
 * asleep) counts from Aldo's answer, is waited for while that loads, and
 * without one is left out: as unreported, or unread when Aldo's answers
 * couldn't be loaded.
 */
export function withAldoUsage<S extends UsageStatus>(
  status: S,
  connected: boolean,
  answers: AldoUsageAnswers,
): S {
  if (status.summary !== null || status.isPending || connected) return status;
  if (answers === "loading") return { ...status, isPending: true, error: null };
  if (answers === "failed") return { ...status, error: ALDO_UNREAD_USAGE };
  const answer = decodeSummary(answers[status.environmentId]);
  return Option.isSome(answer)
    ? { ...status, error: null, summary: answer.value }
    : { ...status, error: ALDO_UNREPORTED_USAGE };
}

function agents(count: number): string {
  return count === 1 ? "1 cloud agent" : `${count} cloud agents`;
}

/** The lines for the agents left out (by their errors), instead of one each. */
export function aldoUsageNotes(errors: ReadonlyArray<string>): string[] {
  const unreported = errors.filter((error) => error === ALDO_UNREPORTED_USAGE).length;
  const unread = errors.length - unreported;
  return [
    ...(unreported === 0
      ? []
      : [
          `Usage from ${agents(unreported)} isn't counted yet: ${
            unreported === 1 ? "it reports" : "each reports"
          } it the next time it runs.`,
        ]),
    ...(unread === 0
      ? []
      : [`Usage from ${agents(unread)} couldn't be read. Refresh to try again.`]),
  ];
}
