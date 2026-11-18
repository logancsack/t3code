import type { EnvironmentId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

import type { PlatformConnectionRegistration } from "../connection/catalog.ts";

export class PlatformConnectionSource extends Context.Service<
  PlatformConnectionSource,
  {
    // Each emission is the full current set of platform-managed environments
    // (the primary local environment plus any desktop-local backends running
    // alongside it). The registry reconciles the set, so the source can drive
    // both additions and removals by re-emitting.
    readonly registrations: Stream.Stream<ReadonlyArray<PlatformConnectionRegistration>>;
    /**
     * Which of them the host says are asleep, read as each emission is
     * reconciled (a cloud platform's sleeping machines): those run nothing
     * until they're needed (EnvironmentRegistry's dormant environments).
     */
    readonly asleep?: Effect.Effect<ReadonlySet<EnvironmentId>>;
  }
>()("@t3tools/client-runtime/platform/source/PlatformConnectionSource") {}
