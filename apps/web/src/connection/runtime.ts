import { Connection, LegacyOrchestrationSupport } from "@t3tools/client-runtime/connection";
import { ShellSnapshotLoader } from "@t3tools/client-runtime/state/shell";
import {
  BoundedThreadSnapshotLoader,
  ThreadHistoryController,
  ThreadSnapshotLoader,
} from "@t3tools/client-runtime/state/threads";
import { PullRequestDiffLoader } from "@t3tools/client-runtime/state/pull-requests";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Atom } from "effect/reactivity";

import { isAldoCloud } from "../aldo/api";
import { aldoThreadSnapshotLoaderLayer } from "../aldo/pendingThreads";
import { isGuestPage } from "../guestPage";
import { isLandingDemo } from "../landingDemo/mode";

import * as Runtime from "../lib/runtime";
import * as BackgroundActivityReporter from "../lib/backgroundActivityReporter";
import * as ConnectionPlatform from "./platform";

const layerProvidedConnectionPlatform = ConnectionPlatform.layer.pipe(Layer.provide(Runtime.layer));

const layerLandingDemoSnapshotLoader = Layer.merge(
  Layer.succeed(
    ShellSnapshotLoader.ShellSnapshotLoader,
    ShellSnapshotLoader.ShellSnapshotLoader.of({
      load: Effect.fn("ShellSnapshotLoader.load")(() => Effect.succeedNone),
    }),
  ),
  Layer.succeed(
    ThreadSnapshotLoader,
    ThreadSnapshotLoader.of({
      load: Effect.fn("ThreadSnapshotLoader.load")(() =>
        Effect.succeed({ _tag: "unavailable" as const }),
      ),
    }),
  ),
);

const layerSnapshotLoader = Layer.mergeAll(
  isLandingDemo()
    ? layerLandingDemoSnapshotLoader
    : Layer.merge(
        // Aldo: a thread this tab is still creating reads "missing" as "not yet".
        isAldoCloud ? aldoThreadSnapshotLoaderLayer : BoundedThreadSnapshotLoader.layer,
        ShellSnapshotLoader.layer,
      ),
  ThreadHistoryController.layer,
  PullRequestDiffLoader.layer,
);

const layerConnectionServices = isLandingDemo()
  ? Connection.makeLayer(
      // The demo's scripted session loads only for a visit that asks for it.
      Layer.unwrap(
        Effect.promise(() =>
          import("../landingDemo/runtime").then((module) => module.landingDemoRpcSessionLayer),
        ),
      ),
    )
  : Connection.layerWithOptions({
      environmentThemes: true,
      usageLimitSources: true,
      usageLimitsCommand: true,
    });

type ConnectionLayerSource =
  | typeof Connection.layer
  | typeof layerSnapshotLoader
  | typeof Runtime.layer
  | typeof ConnectionPlatform.layer
  | typeof BackgroundActivityReporter.layerObserver
  | typeof BackgroundActivityReporter.layer;

const layerProvidedClientConnection = layerSnapshotLoader.pipe(
  Layer.provideMerge(layerConnectionServices),
  Layer.provideMerge(
    Layer.mergeAll(
      Runtime.layer,
      // Aldo's machines may still run the original wire protocol.
      Layer.succeed(LegacyOrchestrationSupport, isAldoCloud),
      layerProvidedConnectionPlatform,
      BackgroundActivityReporter.layerObserver,
    ),
  ),
);

const layerConnection = BackgroundActivityReporter.layer.pipe(
  Layer.provideMerge(layerProvidedClientConnection),
);

/**
 * A guest has no session here. Building the connection would open the page origin's environment
 * with whatever cookie this browser holds, plus every environment saved in it, so on the guest
 * page the runtime fails to build and every atom on it keeps its empty value.
 */
const layerForPage = Layer.unwrap(
  Effect.suspend((): Effect.Effect<typeof layerConnection> =>
    isGuestPage()
      ? Effect.die(new Error("The guest page has no environment connection."))
      : Effect.succeed(layerConnection),
  ),
);

export const connectionAtomRuntime: Atom.AtomRuntime<
  Layer.Success<ConnectionLayerSource>,
  Layer.Error<ConnectionLayerSource>
> = Atom.runtime(layerForPage);
