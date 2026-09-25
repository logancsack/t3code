// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  EventId,
  ProviderDriverKind,
  type ProviderRuntimeEvent,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import { RunnerOutbox, layer as RunnerOutboxLayer } from "./RunnerOutbox.ts";

const event = (n: number): ProviderRuntimeEvent => ({
  type: "session.state.changed",
  eventId: EventId.make(`evt-${n}`),
  provider: ProviderDriverKind.make("claudeAgent"),
  threadId: ThreadId.make("thread-outbox-test"),
  createdAt: "2026-09-25T00:00:00.000Z",
  payload: { state: "ready" },
});

/** One runner process lifetime against a persistent state directory. */
const boot = <A, E>(
  baseDir: string,
  body: (outbox: RunnerOutbox["Service"]) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const outbox = yield* RunnerOutbox;
    return yield* body(outbox);
  }).pipe(
    Effect.provide(
      RunnerOutboxLayer.pipe(
        Layer.provide(ServerConfig.ServerConfig.layerTest(process.cwd(), baseDir)),
        Layer.provide(NodeServices.layer),
      ),
    ),
  );

const sequencesOf = (stream: Stream.Stream<{ readonly sequence: number }>, count: number) =>
  stream.pipe(
    Stream.take(count),
    Stream.runCollect,
    Effect.map((entries) => Array.from(entries, (entry) => entry.sequence)),
  );

describe("RunnerOutbox", () => {
  it.effect("replays only unacknowledged events across restarts, in order", () =>
    Effect.gen(function* () {
      const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "runner-outbox-test-"));

      const firstBoot = yield* boot(baseDir, (outbox) =>
        Effect.gen(function* () {
          yield* outbox.append(event(1));
          yield* outbox.append(event(2));
          yield* outbox.append(event(3));
          const replayed = yield* sequencesOf(outbox.subscribe(0), 3);
          const acked = yield* outbox.ack(2);
          return { replayed, acked, stats: yield* outbox.stats };
        }),
      );
      expect(firstBoot.replayed).toEqual([1, 2, 3]);
      expect(firstBoot.acked).toEqual({ ackedSequence: 2, retained: 1 });

      // A crash can leave a torn final line; it must not block the next boot.
      const outboxPath = NodePath.join(baseDir, "userdata", "runner", "outbox.ndjson");
      NodeFS.appendFileSync(outboxPath, '{"sequence":4,"bootId":"torn","ev');

      const secondBoot = yield* boot(baseDir, (outbox) =>
        Effect.gen(function* () {
          const before = yield* outbox.stats;
          yield* outbox.append(event(4));
          const fromStart = yield* sequencesOf(outbox.subscribe(0), 2);
          const fromCursor = yield* sequencesOf(outbox.subscribe(3), 1);
          return { before, fromStart, fromCursor, after: yield* outbox.stats };
        }),
      );
      expect(secondBoot.before.runnerId).toBe(firstBoot.stats.runnerId);
      expect(secondBoot.before.bootId).not.toBe(firstBoot.stats.bootId);
      expect(secondBoot.before).toMatchObject({ headSequence: 3, ackedSequence: 2, retained: 1 });
      expect(secondBoot.fromStart).toEqual([3, 4]);
      expect(secondBoot.fromCursor).toEqual([4]);
      expect(secondBoot.after.headSequence).toBe(4);

      NodeFS.rmSync(baseDir, { recursive: true, force: true });
    }),
  );

  it.effect("delivers events appended after subscribing exactly once", () =>
    Effect.gen(function* () {
      const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "runner-outbox-test-"));
      const sequences = yield* boot(baseDir, (outbox) =>
        Effect.gen(function* () {
          yield* outbox.append(event(1));
          const fiber = yield* sequencesOf(outbox.subscribe(0), 3).pipe(Effect.forkChild);
          yield* Effect.yieldNow;
          yield* outbox.append(event(2));
          yield* outbox.append(event(3));
          return yield* Fiber.join(fiber);
        }),
      );
      expect(sequences).toEqual([1, 2, 3]);
      NodeFS.rmSync(baseDir, { recursive: true, force: true });
    }),
  );
});
