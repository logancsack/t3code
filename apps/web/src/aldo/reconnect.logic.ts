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
