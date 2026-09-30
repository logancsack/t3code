import { it } from "@effect/vitest";
import {
  type ProviderInstanceEnvironment,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import type { AnyProviderDriver, ProviderInstance } from "../provider/ProviderDriver.ts";
import type { ProviderAdapterShape } from "../provider/Services/ProviderAdapter.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import type { TextGenerationShape } from "../textGeneration/TextGeneration.ts";
import {
  makeRunnerProviderRegistryLayer,
  RunnerProviderSettings,
} from "./RunnerProviderSettings.ts";

const driverKind = ProviderDriverKind.make("claudeAgent");

/** A driver that records every instance it builds and the environment it got. */
const recordingDriver = (created: Array<{ id: string; env: ProviderInstanceEnvironment }>) =>
  ({
    driverKind,
    metadata: { displayName: "Claude", supportsMultipleInstances: true },
    configSchema: Schema.Unknown as unknown as Schema.Codec<unknown, unknown>,
    defaultConfig: () => ({}),
    create: ({ instanceId, displayName, enabled, environment }) =>
      Effect.sync(() => {
        created.push({ id: instanceId, env: environment });
        return {
          instanceId,
          driverKind,
          continuationIdentity: { driverKind, continuationKey: instanceId },
          displayName,
          enabled,
          snapshot: {
            maintenanceCapabilities: { provider: driverKind, packageName: null, update: null },
            getSnapshot: Effect.succeed({} as ServerProvider),
            refresh: Effect.succeed({} as ServerProvider),
            streamChanges: Stream.empty,
          },
          adapter: {} as ProviderAdapterShape<never>,
          textGeneration: {} as TextGenerationShape,
        } satisfies ProviderInstance;
      }),
  }) satisfies AnyProviderDriver;

describe("runner provider settings", () => {
  it.effect("layers the hub's instance settings over the local ones, in memory only", () =>
    Effect.gen(function* () {
      const created: Array<{ id: string; env: ProviderInstanceEnvironment }> = [];
      const layer = makeRunnerProviderRegistryLayer([recordingDriver(created)]).pipe(
        Layer.provideMerge(ServerSettingsService.layerTest()),
      );
      yield* Effect.gen(function* () {
        const settings = yield* RunnerProviderSettings;
        const registry = yield* ProviderInstanceRegistry;
        const serverSettings = yield* ServerSettingsService;
        expect(created.map((entry) => entry.id)).toEqual(["claudeAgent"]);

        const work = {
          driver: driverKind,
          environment: [{ name: "ANTHROPIC_API_KEY", value: "sk-hub", sensitive: true }],
        };
        const hosted = yield* settings.apply({ claude_work: work });
        expect(hosted).toEqual(["claudeAgent", "claude_work"]);
        expect(created.at(-1)).toEqual({ id: "claude_work", env: work.environment });

        // The same settings again change nothing; new settings rebuild the instance.
        yield* settings.apply({ claude_work: work });
        expect(created.length).toBe(2);
        yield* settings.apply({
          claude_work: { ...work, environment: [{ ...work.environment[0]!, value: "sk-new" }] },
        });
        expect(created.length).toBe(3);
        expect(yield* registry.getInstance(ProviderInstanceId.make("claude_work"))).toBeDefined();

        // The runner's own settings never receive the pushed secret.
        expect((yield* serverSettings.getSettings).providerInstances).toEqual({});
        const effective = yield* settings.effectiveSettings;
        expect(Object.keys(effective.providerInstances)).toEqual(["claude_work"]);
      }).pipe(Effect.provide(layer));
    }),
  );
});
