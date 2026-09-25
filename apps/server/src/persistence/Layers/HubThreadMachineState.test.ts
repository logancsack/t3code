import { it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { describe, expect } from "vite-plus/test";

import {
  CheckpointTurnDiffStore,
  RunnerCursorStore,
  ThreadVcsStatusStore,
} from "../Services/HubThreadMachineState.ts";
import { HubThreadMachineStateSqliteLive } from "./HubThreadMachineState.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const TestLayer = HubThreadMachineStateSqliteLive.pipe(Layer.provide(SqlitePersistenceMemory));
const threadId = ThreadId.make("thread-1");
const otherThread = ThreadId.make("thread-2");

describe("hub thread-machine state on SQLite", () => {
  it.effect("upserts runner cursors transactionally and reads them back", () =>
    Effect.gen(function* () {
      const cursors = yield* RunnerCursorStore;
      expect(Option.isNone(yield* cursors.get(threadId))).toBe(true);
      yield* cursors.saveAll([
        { threadId, outboxId: "runner-a", bootId: "boot-1", ackedSequence: 4, updatedAt: "t1" },
        {
          threadId: otherThread,
          outboxId: "runner-b",
          bootId: "boot-9",
          ackedSequence: 1,
          updatedAt: "t1",
        },
      ]);
      yield* cursors.saveAll([
        { threadId, outboxId: "runner-a", bootId: "boot-2", ackedSequence: 9, updatedAt: "t2" },
      ]);
      expect(Option.getOrThrow(yield* cursors.get(threadId))).toEqual({
        threadId,
        outboxId: "runner-a",
        bootId: "boot-2",
        ackedSequence: 9,
        updatedAt: "t2",
      });
      yield* cursors.remove(otherThread);
      expect((yield* cursors.list()).map((cursor) => cursor.threadId)).toEqual([threadId]);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("keys diffs by whitespace mode and invalidates everything reading a turn", () =>
    Effect.gen(function* () {
      const diffs = yield* CheckpointTurnDiffStore;
      const key = (from: number, to: number, ignoreWhitespace = true) => ({
        threadId,
        fromTurnCount: from,
        toTurnCount: to,
        ignoreWhitespace,
      });
      for (const [from, to] of [
        [0, 1],
        [1, 2],
        [0, 2],
        [2, 3],
      ] as const) {
        yield* diffs.put({ ...key(from, to), diff: `diff ${from}-${to}`, createdAt: "t" });
      }
      yield* diffs.put({ ...key(1, 2, false), diff: "diff 1-2 exact", createdAt: "t" });
      expect(Option.getOrNull(yield* diffs.get(key(1, 2)))).toBe("diff 1-2");
      expect(Option.getOrNull(yield* diffs.get(key(1, 2, false)))).toBe("diff 1-2 exact");

      // Recapturing turn 2 invalidates diffs from or to turn 2 and later.
      yield* diffs.invalidateFromTurn({ threadId, turnCount: 2 });
      expect(Option.getOrNull(yield* diffs.get(key(0, 1)))).toBe("diff 0-1");
      expect(Option.isNone(yield* diffs.get(key(1, 2)))).toBe(true);
      expect(Option.isNone(yield* diffs.get(key(0, 2)))).toBe(true);
      expect(Option.isNone(yield* diffs.get(key(2, 3)))).toBe(true);

      yield* diffs.removeThread(threadId);
      expect(Option.isNone(yield* diffs.get(key(0, 1)))).toBe(true);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("stores the last git status per thread", () =>
    Effect.gen(function* () {
      const statuses = yield* ThreadVcsStatusStore;
      const local = {
        isRepo: true,
        hasPrimaryRemote: true,
        isDefaultRef: false,
        refName: "t3/work",
        hasWorkingTreeChanges: true,
        workingTree: {
          files: [{ path: "a.ts", insertions: 2, deletions: 1 }],
          insertions: 2,
          deletions: 1,
        },
      };
      yield* statuses.put({ threadId, local, remote: null, updatedAt: "t1" });
      yield* statuses.put({
        threadId,
        local,
        remote: { hasUpstream: true, aheadCount: 1, behindCount: 0, pr: null },
        updatedAt: "t2",
      });
      const rows = yield* statuses.list();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        threadId,
        local,
        remote: { aheadCount: 1 },
        updatedAt: "t2",
      });
      yield* statuses.remove(threadId);
      expect(yield* statuses.list()).toEqual([]);
    }).pipe(Effect.provide(TestLayer)),
  );
});
