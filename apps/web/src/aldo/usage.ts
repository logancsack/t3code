// The Usage page counts every cloud agent's usage, a sleeping one's too,
// without waking it. T3's page asks each environment to add up its agents'
// transcripts, and a machine that sleeps isn't connected, so each one showed
// "could not report usage" and wasn't counted. aldod reports what its
// machine's agents used when turns end, and Aldo answers for the machines this
// browser isn't connected to as they would for the window asked (Aldo's
// src/lib/agent-usage.ts). One that hasn't reported yet (it hasn't run since
// machines began to) is left out, in one line (UsagePage.tsx).

import type { UsageSummaryInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { aldoMachineIsNew, fetchAldoUsage } from "./cloud";
import { withAldoUsage, type AldoUsageAnswers } from "./usage.logic";

/** Aldo's answers for one window, keyed as state/usage.ts keys it. */
export const aldoUsageAtom = Atom.family((windowKey: string) => {
  const input = JSON.parse(windowKey) as UsageSummaryInput;
  return Atom.make(Effect.tryPromise(() => fetchAldoUsage(input))).pipe(
    Atom.withLabel(`aldo-usage:${windowKey}`),
  );
});

/**
 * The page's environments, with Aldo's answers for the ones that aren't
 * connected; a machine not created yet has nothing to count.
 */
export function withAldoUsages<S extends Parameters<typeof withAldoUsage>[0]>(
  statuses: ReadonlyArray<S>,
  presentations: ReadonlyMap<string, { readonly connection: { readonly phase: string } }>,
  result: AsyncResult.AsyncResult<Record<string, unknown>, unknown>,
): S[] {
  const answers: AldoUsageAnswers = Option.getOrElse(AsyncResult.value(result), () =>
    AsyncResult.isFailure(result) ? "failed" : "loading",
  );
  return statuses
    .filter((status) => !aldoMachineIsNew(status.environmentId))
    .map((status) =>
      withAldoUsage(
        status,
        presentations.get(status.environmentId)?.connection.phase === "connected",
        answers,
      ),
    );
}
