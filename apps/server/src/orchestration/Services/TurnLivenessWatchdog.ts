import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

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
   * forever.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
}

export class TurnLivenessWatchdog extends Context.Service<
  TurnLivenessWatchdog,
  TurnLivenessWatchdogShape
>()("t3/orchestration/Services/TurnLivenessWatchdog") {}
