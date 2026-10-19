import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface TurnLivenessWatchdogStartOptions {
  /**
   * Runs each automatic retry, which starts a turn, as a command the server
   * admits: a stopping server refuses a new one and waits for one under way.
   * Without it a retry runs on its own.
   */
  readonly admitRetry?: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E | Error>;
}

export interface TurnLivenessWatchdogShape {
  /**
   * Start the background turn liveness watchdog within the provided scope.
   *
   * The watchdog guarantees that a turn shown as running is either provably
   * alive or gets visibly interrupted: it follows the provider runtime event
   * stream, and a running turn that is waiting on the model (not on a tool it
   * launched, and not on a human approval or input request) with no runtime
   * event for the stall threshold is interrupted with an error activity
   * explaining why. On startup it seeds from the persisted snapshot so turns
   * orphaned by a server or VM death are interrupted instead of spinning
   * forever. It stays parked until the server's activation, like the other
   * orchestration roots.
   */
  readonly start: (
    options?: TurnLivenessWatchdogStartOptions,
  ) => Effect.Effect<void, never, Scope.Scope>;
}

export class TurnLivenessWatchdog extends Context.Service<
  TurnLivenessWatchdog,
  TurnLivenessWatchdogShape
>()("t3/orchestration/Services/TurnLivenessWatchdog") {}
