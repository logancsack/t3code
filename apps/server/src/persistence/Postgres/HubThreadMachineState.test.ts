/**
 * Hub thread-machine state on Postgres (migration 050). Runs only when
 * T3_HUB_TEST_DATABASE_URL points at a disposable database, e.g.
 *   T3_HUB_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54339/hub
 */
import * as NodeCrypto from "node:crypto";

import { it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { expect } from "vite-plus/test";

import { makeHubPgClientLayer } from "../Layers/Postgres.ts";
import {
  CheckpointTurnDiffStore,
  RunnerCursorStore,
  ThreadVcsStatusStore,
} from "../Services/HubThreadMachineState.ts";
import { HubThreadMachineStatePostgresLive } from "./HubThreadMachineState.ts";
import { hubTenantLayer } from "./HubTenant.ts";
import {
  HUB_MIGRATION_050,
  HUB_THREAD_MACHINE_STATE_TABLES,
} from "./migrations/050_HubThreadMachineState.ts";

const databaseUrl = process.env.T3_HUB_TEST_DATABASE_URL;
const runId = NodeCrypto.randomUUID().slice(0, 8);
const userA = `test-machines-a-${runId}`;
const userB = `test-machines-b-${runId}`;
const threadId = ThreadId.make("thread-shared");

const storesFor = (userId: string) =>
  HubThreadMachineStatePostgresLive.pipe(Layer.provide(hubTenantLayer(userId)));

if (databaseUrl === undefined) {
  it.skip("hub thread-machine state on Postgres (set T3_HUB_TEST_DATABASE_URL)", () => {});
} else {
  it.layer(
    Layer.effectDiscard(HUB_MIGRATION_050).pipe(
      Layer.provideMerge(makeHubPgClientLayer({ url: databaseUrl, maxConnections: 2 })),
    ),
    { excludeTestServices: true },
  )("hub thread-machine state on Postgres", (it) => {
    it.effect("isolates cursors, diffs and git status per user", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const writeAs = (userId: string, sequence: number) =>
          Effect.gen(function* () {
            yield* (yield* RunnerCursorStore).saveAll([
              {
                threadId,
                outboxId: "runner",
                bootId: userId,
                ackedSequence: sequence,
                updatedAt: "t",
              },
            ]);
            yield* (yield* CheckpointTurnDiffStore).put({
              threadId,
              fromTurnCount: 0,
              toTurnCount: 1,
              ignoreWhitespace: true,
              diff: `diff of ${userId}`,
              createdAt: "t",
            });
          }).pipe(Effect.provide(storesFor(userId)));
        yield* writeAs(userA, 3);
        yield* writeAs(userB, 7);

        const readAs = (userId: string) =>
          Effect.gen(function* () {
            const cursor = yield* (yield* RunnerCursorStore).get(threadId);
            const diff = yield* (yield* CheckpointTurnDiffStore).get({
              threadId,
              fromTurnCount: 0,
              toTurnCount: 1,
              ignoreWhitespace: true,
            });
            return {
              sequence: Option.getOrThrow(cursor).ackedSequence,
              diff: Option.getOrNull(diff),
              statuses: yield* (yield* ThreadVcsStatusStore).list(),
            };
          }).pipe(Effect.provide(storesFor(userId)));
        expect(yield* readAs(userA)).toEqual({
          sequence: 3,
          diff: `diff of ${userA}`,
          statuses: [],
        });
        expect(yield* readAs(userB)).toEqual({
          sequence: 7,
          diff: `diff of ${userB}`,
          statuses: [],
        });

        yield* Effect.gen(function* () {
          yield* (yield* CheckpointTurnDiffStore).invalidateFromTurn({ threadId, turnCount: 1 });
        }).pipe(Effect.provide(storesFor(userA)));
        expect((yield* readAs(userA)).diff).toBeNull();
        expect((yield* readAs(userB)).diff).toBe(`diff of ${userB}`);

        for (const table of HUB_THREAD_MACHINE_STATE_TABLES) {
          yield* sql`DELETE FROM ${sql(table)} WHERE ${sql.in("user_id", [userA, userB])}`;
        }
      }),
    );
  });
}
