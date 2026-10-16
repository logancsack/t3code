import type { DesktopHostTelemetrySnapshot } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import * as DesktopTelemetryReceiver from "../resourceTelemetry/DesktopTelemetryReceiver.ts";
import * as HostPowerMonitor from "./HostPowerMonitor.ts";

it.effect("keeps a power update received during startup ahead of its older snapshot", () =>
  Effect.gen(function* () {
    const sampledAt = DateTime.makeUnsafe("2026-06-17T12:00:00.000Z");
    const initial: DesktopHostTelemetrySnapshot = {
      version: 1,
      type: "desktopTelemetry",
      sequence: 1,
      sampledAtUnixMs: DateTime.toEpochMillis(sampledAt),
      electronPid: 100,
      power: {
        source: "electron-main",
        idle: "false",
        idleSeconds: 0,
        locked: "false",
        suspended: false,
        onBattery: "false",
        lowPowerMode: "unknown",
        thermalState: "nominal",
        stale: false,
        updatedAt: sampledAt,
      },
      speedLimitPercent: Option.none(),
      electronProcesses: [],
    };
    const updated: DesktopHostTelemetrySnapshot = {
      ...initial,
      sequence: 2,
      power: {
        ...initial.power,
        locked: "true",
        onBattery: "true",
        updatedAt: DateTime.makeUnsafe("2026-06-17T12:00:01.000Z"),
      },
    };
    const changes = yield* PubSub.sliding<DesktopHostTelemetrySnapshot>(1);
    const drained = yield* Deferred.make<void>();
    const receiver = DesktopTelemetryReceiver.layerTest({
      latest: Effect.die("Startup must use the atomic subscription and snapshot."),
      changes: Stream.die("Startup must consume its subscribed changes."),
      subscribe: Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        yield* PubSub.publish(changes, updated);
        return {
          latest: Option.some(initial),
          changes: Stream.concat(
            Stream.fromSubscription(subscription).pipe(Stream.take(1)),
            Stream.fromEffect(Deferred.succeed(drained, undefined)).pipe(Stream.drain),
          ),
        };
      }),
    });

    yield* Effect.gen(function* () {
      const monitor = yield* HostPowerMonitor.HostPowerMonitor;
      yield* Deferred.await(drained);
      expect(yield* monitor.snapshot).toEqual(updated.power);
      yield* monitor.report(initial.power);
      expect(yield* monitor.snapshot).toEqual(updated.power);
    }).pipe(Effect.provide(HostPowerMonitor.layer.pipe(Layer.provide(receiver))));
  }),
);
