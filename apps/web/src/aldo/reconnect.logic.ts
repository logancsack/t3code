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
  /**
   * Aldo's starts of its threads and the messages it holds for them, by T3
   * thread id, with when each was sent (`at`, ISO); an older Aldo leaves them out.
   */
  readonly starts?: Readonly<Record<string, { readonly state: string; readonly at?: string }>>;
}

/**
 * How long a page trusts Aldo to be bringing a machine up for a held message
 * before it wakes the machine itself: "starting" only says the message is on
 * its way with no error, and a delivery whose function died stays claimed for
 * minutes until a sweep takes it up again. A wake joins a start under way.
 */
const HELD_START_TRUSTED_MS = 150_000;

/**
 * What a page waiting on a message Aldo holds does next, from a directory
 * read made since Aldo took it. Wait while Aldo's delivery of the message is
 * under way ("starting"), rather than wake the machine too (of two calls
 * bringing one machine up, the one that loses waits out the other's start,
 * then goes over it again), until the page has followed it for
 * HELD_START_TRUSTED_MS or it was sent that long ago. Go on once the machine
 * is up and Aldo has sent the message (it marks the machine up before it has
 * put the user's settings on it, so the page doesn't send it first). Else
 * wake it: the message waits for credits or room (whose refusal the wake
 * shows), a try failed and waits to go again, Aldo gave up on it, or an older
 * Aldo doesn't say and the machine isn't up.
 */
export function aldoHeldStartStep(
  machine: AldoHeldStartEntry | undefined,
  t3ThreadId: string,
  followedMs: number,
  now: number,
): "up" | "follow" | "wake" {
  const start = machine?.starts?.[t3ThreadId];
  if (start?.state === "starting") {
    const sentAt = start.at === undefined ? Number.NaN : Date.parse(start.at);
    const stale = followedMs >= HELD_START_TRUSTED_MS || now - sentAt >= HELD_START_TRUSTED_MS;
    return stale ? "wake" : "follow";
  }
  return start === undefined && machine?.state === "ready" ? "up" : "wake";
}
