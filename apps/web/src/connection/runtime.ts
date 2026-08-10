import { Connection } from "@t3tools/client-runtime/connection";
import { shellSnapshotLoaderLayer } from "@t3tools/client-runtime/state/shell";
import { ShellSnapshotLoader } from "@t3tools/client-runtime/state/shell";
import {
  ThreadSnapshotLoader,
  threadSnapshotLoaderLayer,
} from "@t3tools/client-runtime/state/threads";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { Atom } from "effect/unstable/reactivity";

import { runtimeContextLayer } from "../lib/runtime";
import {
  backgroundActivityObserverLayer,
  backgroundActivityReporterLayer,
} from "../lib/backgroundActivityReporter";
import { connectionPlatformLayer } from "./platform";
import { isLandingDemo } from "../landingDemo/mode";
import { landingDemoRpcSessionLayer } from "../landingDemo/runtime";

const providedConnectionPlatformLayer = connectionPlatformLayer.pipe(
  Layer.provide(runtimeContextLayer),
);

const landingDemoSnapshotLoaderLayer = Layer.merge(
  Layer.succeed(
    ShellSnapshotLoader,
    ShellSnapshotLoader.of({ load: () => Effect.succeed(Option.none()) }),
  ),
  Layer.succeed(
    ThreadSnapshotLoader,
    ThreadSnapshotLoader.of({ load: () => Effect.succeed({ kind: "unavailable" as const }) }),
  ),
);
const snapshotLoaderLayer = isLandingDemo()
  ? landingDemoSnapshotLoaderLayer
  : Layer.merge(threadSnapshotLoaderLayer, shellSnapshotLoaderLayer);
const connectionServicesLayer = isLandingDemo()
  ? Connection.makeLayer(landingDemoRpcSessionLayer)
  : Connection.layer;

type ConnectionLayerSource =
  | typeof Connection.layer
  | typeof snapshotLoaderLayer
  | typeof runtimeContextLayer
  | typeof connectionPlatformLayer
  | typeof backgroundActivityObserverLayer
  | typeof backgroundActivityReporterLayer;

const providedClientConnectionLayer = Layer.merge(
  connectionServicesLayer,
  snapshotLoaderLayer,
).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      runtimeContextLayer,
      providedConnectionPlatformLayer,
      backgroundActivityObserverLayer,
    ),
  ),
);

const connectionLayer = backgroundActivityReporterLayer.pipe(
  Layer.provideMerge(providedClientConnectionLayer),
);

export const connectionAtomRuntime: Atom.AtomRuntime<
  Layer.Success<ConnectionLayerSource>,
  Layer.Error<ConnectionLayerSource>
> = Atom.runtime(connectionLayer);
