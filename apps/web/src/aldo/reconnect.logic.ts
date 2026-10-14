// Which machines a directory fetch should try connecting to again (reconnect.ts).

/** What of a machine the rule reads: the directory's state, and this tab's connection phase (undefined until registered). */
export interface AldoReconnectEntry {
  readonly environmentId: string;
  readonly state: "new" | "ready" | "stopped" | "failed";
}

/**
 * Machines the directory says are up that this tab isn't connecting to: a
 * connection told "asleep" waits to be told to try again (cloud.ts), and
 * stays waiting when the machine is woken by something other than this tab
 * (Aldo's own work on it, another device). One not registered yet connects
 * on registration; one connecting, connected or backing off is left to it.
 */
export function aldoMachinesToRetry(
  environments: ReadonlyArray<AldoReconnectEntry>,
  phaseOf: (environmentId: string) => string | undefined,
): string[] {
  return environments
    .filter(
      (environment) =>
        environment.state === "ready" && phaseOf(environment.environmentId) === "available",
    )
    .map((environment) => environment.environmentId);
}

/**
 * Whether a wake that failed is asked again: it got no answer (`status` null:
 * the network dropped it, as a phone switching networks or going to the
 * background during a first boot that takes minutes does), a gateway gave up
 * waiting on it, or Aldo said "not yet" (the machine still starting for
 * another call). Aldo converges a repeated wake on the same machine. Any other
 * answer (a refusal, a start that failed) is the user's to know.
 */
export function aldoWakeAgain(status: number | null): boolean {
  return status === null || [408, 429, 502, 503, 504].includes(status);
}
