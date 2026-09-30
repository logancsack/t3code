// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { it } from "@effect/vitest";
import {
  EventId,
  ProviderDriverKind,
  type ProviderRuntimeEvent,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect } from "vite-plus/test";

import { makeWithOptions, type RunnerOutboxShape } from "./RunnerOutbox.ts";

const event = (id: string): ProviderRuntimeEvent => ({
  type: "session.state.changed",
  eventId: EventId.make(id),
  provider: ProviderDriverKind.make("claudeAgent"),
  threadId: ThreadId.make("thread-outbox-test"),
  createdAt: "2026-09-25T00:00:00.000Z",
  payload: { state: "ready" },
});

const tempDirs: Array<string> = [];
const makeDatabasePath = () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "runner-outbox-test-"));
  tempDirs.push(dir);
  return NodePath.join(dir, "runner", "outbox.sqlite");
};
afterEach(() => {
  for (const dir of tempDirs.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

/** One runner process lifetime against a persistent database. */
const boot = <A, E>(
  databasePath: string,
  body: (outbox: RunnerOutboxShape) => Effect.Effect<A, E>,
  maxRetained?: number,
) =>
  Effect.scoped(
    makeWithOptions({ databasePath, ...(maxRetained ? { maxRetained } : {}) }).pipe(
      Effect.flatMap(body),
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
      const databasePath = makeDatabasePath();
      const firstBoot = yield* boot(databasePath, (outbox) =>
        Effect.gen(function* () {
          yield* outbox.append(event("e1"));
          yield* outbox.append(event("e2"));
          yield* outbox.append(event("e3"));
          const replayed = yield* sequencesOf(outbox.subscribe(0), 3);
          const acked = yield* outbox.ack(2);
          return { replayed, acked, stats: yield* outbox.stats };
        }),
      );
      expect(firstBoot.replayed).toEqual([1, 2, 3]);
      expect(firstBoot.acked).toEqual({ ackedSequence: 2, retained: 1 });

      const secondBoot = yield* boot(databasePath, (outbox) =>
        Effect.gen(function* () {
          const before = yield* outbox.stats;
          yield* outbox.append(event("e4"));
          const fromAck = yield* sequencesOf(outbox.subscribe(2), 2);
          const fromCursor = yield* sequencesOf(outbox.subscribe(3), 1);
          return { before, fromAck, fromCursor, after: yield* outbox.stats };
        }),
      );
      expect(secondBoot.before.runnerId).toBe(firstBoot.stats.runnerId);
      expect(secondBoot.before.bootId).not.toBe(firstBoot.stats.bootId);
      expect(secondBoot.before).toMatchObject({
        headSequence: 3,
        ackedSequence: 2,
        firstRetainedSequence: 3,
        retained: 1,
      });
      expect(secondBoot.fromAck).toEqual([3, 4]);
      expect(secondBoot.fromCursor).toEqual([4]);
      expect(secondBoot.after.headSequence).toBe(4);
    }),
  );

  it.effect("keeps sequences increasing after every event is acknowledged", () =>
    Effect.gen(function* () {
      const databasePath = makeDatabasePath();
      yield* boot(databasePath, (outbox) =>
        Effect.gen(function* () {
          yield* outbox.append(event("e1"));
          yield* outbox.append(event("e2"));
          yield* outbox.ack(2);
        }),
      );
      const next = yield* boot(databasePath, (outbox) =>
        outbox.append(event("e3")).pipe(Effect.andThen(sequencesOf(outbox.subscribe(0), 1))),
      );
      expect(next).toEqual([3]);
    }),
  );

  it.effect("delivers events appended after subscribing exactly once", () =>
    Effect.gen(function* () {
      const databasePath = makeDatabasePath();
      const sequences = yield* boot(databasePath, (outbox) =>
        Effect.gen(function* () {
          yield* outbox.append(event("e1"));
          const fiber = yield* sequencesOf(outbox.subscribe(0), 3).pipe(Effect.forkChild);
          yield* Effect.yieldNow;
          yield* outbox.append(event("e2"));
          yield* outbox.append(event("e3"));
          return yield* Fiber.join(fiber);
        }),
      );
      expect(sequences).toEqual([1, 2, 3]);
    }),
  );

  it.effect("makes duplicate adapter event ids unique so hub command ids cannot collide", () =>
    Effect.gen(function* () {
      const databasePath = makeDatabasePath();
      const eventIds = yield* boot(databasePath, (outbox) =>
        Effect.gen(function* () {
          yield* outbox.append(event("same"));
          yield* outbox.append(event("same"));
          return yield* outbox.subscribe(0).pipe(
            Stream.take(2),
            Stream.runCollect,
            Effect.map((entries) => Array.from(entries, (entry) => entry.event.eventId)),
          );
        }),
      );
      expect(eventIds).toEqual(["same", "same:2"]);
    }),
  );

  it.effect("drops the oldest unacknowledged events past retention and reports the gap", () =>
    Effect.gen(function* () {
      const databasePath = makeDatabasePath();
      const result = yield* boot(
        databasePath,
        (outbox) =>
          Effect.gen(function* () {
            for (const id of ["e1", "e2", "e3", "e4", "e5"]) yield* outbox.append(event(id));
            return {
              stats: yield* outbox.stats,
              replay: yield* sequencesOf(outbox.subscribe(0), 3),
            };
          }),
        3,
      );
      expect(result.stats).toMatchObject({
        headSequence: 5,
        firstRetainedSequence: 3,
        retained: 3,
        dropped: 2,
      });
      expect(result.replay).toEqual([3, 4, 5]);
    }),
  );
});
