// Which machines a directory fetch should try connecting to again (reconnect.ts).

/** What of a machine the rule reads: the directory's state, and this tab's connection phase (undefined until registered). */
export interface AldoReconnectEntry {
  readonly environmentId: string;
  readonly state: "new" | "ready" | "stopped" | "failed";
}

/**
 * Machines the directory says are up that this tab isn't connecting to: a
 * connection told "asleep" waits to be told to try again (directory.ts), and
 * stays waiting when the machine is woken by something other than this tab
 * (Aldo's own work on it, another device). One not registered yet connects
 * on registration; one connecting, connected or backing off is left to it,
 * unless its latest attempt was told "asleep" from an older listing without
 * asking Aldo (`toldAsleepFromListing`): that attempt has nothing under way
 * to cut off, and, answered just as this listing came, it would otherwise
 * wait for the next.
 */
export function aldoMachinesToRetry(
  environments: ReadonlyArray<AldoReconnectEntry>,
  phaseOf: (environmentId: string) => string | undefined,
  toldAsleepFromListing: (environmentId: string) => boolean = () => false,
): string[] {
  return environments
    .filter(
      (environment) =>
        environment.state === "ready" &&
        (phaseOf(environment.environmentId) === "available" ||
          toldAsleepFromListing(environment.environmentId)),
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

/** What of a machine a page waiting on a message Aldo holds for it reads (dispatch.ts). */
export interface AldoHeldStartEntry {
  readonly state: AldoReconnectEntry["state"];
  /** Aldo's starts of its threads and the messages it holds for them, by T3 thread id (an older Aldo leaves them out). */
  readonly starts?: Readonly<Record<string, { readonly state: string }>>;
}

/**
 * What a page waiting on a message Aldo holds does next, from a directory
 * read made since Aldo took it: connect, the machine is up; wait, while
 * Aldo's delivery of the message brings it up ("starting"), rather than wake
 * it too (of two calls bringing one machine up, the one that loses waits out
 * the other's start, then goes over it again); else wake it: the message
 * waits for credits or room (whose refusal the wake shows), a try failed and
 * waits to go again, Aldo gave up on it or holds it no more, or an older Aldo
 * doesn't say.
 */
export function aldoHeldStartStep(
  machine: AldoHeldStartEntry | undefined,
  t3ThreadId: string,
): "up" | "follow" | "wake" {
  if (machine?.state === "ready") return "up";
  return machine?.starts?.[t3ThreadId]?.state === "starting" ? "follow" : "wake";
}
