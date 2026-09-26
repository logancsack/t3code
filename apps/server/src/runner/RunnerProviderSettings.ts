/**
 * RunnerProviderSettings - provider instance settings on a runner.
 *
 * A runner's provider registry starts from its own settings file (defaults on
 * a fresh thread machine). The hub pushes its effective settings for the
 * instances a thread uses (`runner.provider.configure`, on connect and before
 * each session start), sensitive environment values included. They are
 * layered over the local settings in memory only: nothing is written to the
 * runner's settings or secrets, and a restarted runner starts from its local
 * settings again until the hub pushes. A runner serves exactly one thread, so
 * pushed settings apply to that thread's sessions only.
 *
 * Applying settings that equal the live ones is a no-op; a changed instance is
 * rebuilt by the registry, as a settings change is on any server.
 *
 * @module runner/RunnerProviderSettings
 */
import type {
  ProviderInstanceConfig,
  ProviderInstanceConfigMap,
  ProviderInstanceId,
  ServerSettings,
  ServerSettingsError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { type BuiltInDriversEnv } from "../provider/builtInDrivers.ts";
import { deriveProviderInstanceConfigMap } from "../provider/Layers/ProviderInstanceRegistryHydration.ts";
import { ProviderInstanceRegistryMutableLayer } from "../provider/Layers/ProviderInstanceRegistryLive.ts";
import type { AnyProviderDriver } from "../provider/ProviderDriver.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import { ProviderInstanceRegistryMutator } from "../provider/Services/ProviderInstanceRegistryMutator.ts";
import { ServerSettingsService } from "../serverSettings.ts";

export interface RunnerProviderSettingsShape {
  /** Layers the hub's instance settings over the local ones; returns the hosted instances. */
  readonly apply: (
    instances: Readonly<Record<string, ProviderInstanceConfig>>,
  ) => Effect.Effect<ReadonlyArray<ProviderInstanceId>>;
  /** Local settings with the hub's instance settings layered over them. */
  readonly effectiveSettings: Effect.Effect<ServerSettings, ServerSettingsError>;
}

export class RunnerProviderSettings extends Context.Service<
  RunnerProviderSettings,
  RunnerProviderSettingsShape
>()("t3/runner/RunnerProviderSettings") {}

/**
 * The runner's provider registry: the local settings file with hub-pushed
 * instance settings layered over it, reconciled whenever either changes.
 */
export const makeRunnerProviderRegistryLayer = <R>(
  drivers: ReadonlyArray<AnyProviderDriver<R>>,
): Layer.Layer<
  ProviderInstanceRegistry | RunnerProviderSettings,
  never,
  R | ServerSettingsService
> => {
  const configDrivers = drivers as unknown as ReadonlyArray<AnyProviderDriver<BuiltInDriversEnv>>;
  return Layer.unwrap(
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const initial = yield* serverSettings.getSettings.pipe(Effect.orElseSucceed(() => undefined));
      const initialMap =
        initial === undefined
          ? ({} as ProviderInstanceConfigMap)
          : deriveProviderInstanceConfigMap(initial, configDrivers);

      const settingsLayer = Layer.effect(
        RunnerProviderSettings,
        Effect.gen(function* () {
          const mutator = yield* ProviderInstanceRegistryMutator;
          const registry = yield* ProviderInstanceRegistry;
          const pushed = yield* Ref.make<Record<string, ProviderInstanceConfig>>({});
          const lock = yield* Semaphore.make(1);
          let local: ServerSettings | undefined = initial;

          const reconcile = lock.withPermit(
            Effect.gen(function* () {
              const base =
                local === undefined ? {} : deriveProviderInstanceConfigMap(local, configDrivers);
              yield* mutator.reconcile({
                ...base,
                ...(yield* Ref.get(pushed)),
              } as ProviderInstanceConfigMap);
            }),
          );

          yield* serverSettings.streamChanges.pipe(
            Stream.runForEach((next) =>
              Effect.sync(() => {
                local = next;
              }).pipe(Effect.andThen(reconcile)),
            ),
            Effect.forkScoped,
          );

          return RunnerProviderSettings.of({
            apply: (instances) =>
              Ref.update(pushed, (current) => ({ ...current, ...instances })).pipe(
                Effect.andThen(reconcile),
                Effect.andThen(registry.listInstances),
                Effect.map((live) => live.map((instance) => instance.instanceId)),
              ),
            effectiveSettings: Effect.gen(function* () {
              const settings = yield* serverSettings.getSettings;
              return {
                ...settings,
                providerInstances: {
                  ...settings.providerInstances,
                  ...(yield* Ref.get(pushed)),
                } as ServerSettings["providerInstances"],
              };
            }),
          });
        }),
      );

      return settingsLayer.pipe(
        Layer.provideMerge(
          ProviderInstanceRegistryMutableLayer({ drivers, configMap: initialMap }),
        ),
      );
    }),
  ) as Layer.Layer<
    ProviderInstanceRegistry | RunnerProviderSettings,
    never,
    R | ServerSettingsService
  >;
};
