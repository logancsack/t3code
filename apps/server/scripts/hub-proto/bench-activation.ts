// Hub prototype benchmark. Prints only counts, sizes, and timings.
//
//   node --expose-gc scripts/hub-proto/bench-activation.ts pg <postgres-url> <owner-user> <thread-ids,>
//   node --expose-gc scripts/hub-proto/bench-activation.ts sqlite <sqlite-file> - <thread-ids,>
//
// pg mode clones the owner's metadata for synthetic users to measure memory per
// active engine, and counts round trips by wrapping node-postgres' Client.query.
import * as NodeModule from "node:module";
import * as NodePerfHooks from "node:perf_hooks";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EventId,
  MessageId,
  ThreadId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "../../src/config.ts";
import { OrchestrationEngineLive } from "../../src/orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../../src/orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../../src/orchestration/Layers/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../../src/orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../src/orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../../src/orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../../src/orchestration/ThreadPlanProgress.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../src/persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../src/persistence/Layers/OrchestrationEventStore.ts";
import { makeSqlitePersistenceLive } from "../../src/persistence/Layers/Sqlite.ts";
import {
  makeHubSharedLayer,
  makeHubUserEngineLayer,
  type HubSharedServices,
} from "../../src/persistence/Postgres/HubEngine.ts";
import { RepositoryIdentityResolver } from "../../src/project/RepositoryIdentityResolver.ts";

const [mode, target, ownerArg, threadArg] = process.argv.slice(2);
if ((mode !== "pg" && mode !== "sqlite") || !target || !threadArg) {
  throw new Error("usage: bench-activation.ts pg|sqlite <url|file> <owner|-> <thread-ids,>");
}
const owner = ownerArg ?? "owner";
const threadIds = threadArg.split(",").map((id) => ThreadId.make(id));
const ACTIVATIONS = Number(process.env.BENCH_ACTIVATIONS ?? 30);
const ENGINES = Number(process.env.BENCH_ENGINES ?? 20);
const DETAIL_RUNS = Number(process.env.BENCH_DETAIL_RUNS ?? 10);
const DISPATCHES = Number(process.env.BENCH_DISPATCHES ?? 50);

const out = (line: string) => process.stdout.write(`${line}\n`);
const gc = () => (globalThis as { gc?: () => void }).gc?.();
const mib = (bytes: number) => Math.round((bytes / 1048576) * 10) / 10;
const percentile = (values: ReadonlyArray<number>, p: number) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;
};
const summary = (values: ReadonlyArray<number>) =>
  `p50=${percentile(values, 50).toFixed(1)}ms p90=${percentile(values, 90).toFixed(1)}ms min=${Math.min(...values).toFixed(1)}ms max=${Math.max(...values).toFixed(1)}ms n=${values.length}`;
const time = async <A>(run: () => Promise<A>) => {
  const start = NodePerfHooks.performance.now();
  const value = await run();
  return { ms: NodePerfHooks.performance.now() - start, value };
};

// Round-trip counter over node-postgres (resolved through @effect/sql-pg).
let pgQueries = 0;
if (mode === "pg") {
  const requirePg = NodeModule.createRequire(import.meta.resolve("@effect/sql-pg/PgClient"));
  const Pg = requirePg("pg") as {
    Client: { prototype: { query: (...args: unknown[]) => unknown } };
  };
  const query = Pg.Client.prototype.query;
  Pg.Client.prototype.query = function (this: unknown, ...args: unknown[]) {
    pgQueries += 1;
    return query.apply(this, args);
  };
}

const NoRepositoryIdentityLive = Layer.succeed(RepositoryIdentityResolver, {
  resolve: () => Effect.succeed(null),
});

type EngineRuntime = ManagedRuntime.ManagedRuntime<
  OrchestrationEngineService | ProjectionSnapshotQuery,
  unknown
>;

const sqliteEngineLayer = (file: string) =>
  Layer.mergeAll(
    OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationProjectionPipelineLive),
    ),
    OrchestrationProjectionSnapshotQueryLive,
  ).pipe(
    Layer.provideMerge(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provideMerge(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(NoRepositoryIdentityLive),
    Layer.provide(makeSqlitePersistenceLive(file)),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-hub-bench-" })),
    Layer.provideMerge(NodeServices.layer),
  );

const shared =
  mode === "pg"
    ? ManagedRuntime.make(makeHubSharedLayer({ url: target, maxConnections: 10 }))
    : null;
const sharedContext = shared ? await shared.runPromise(Effect.context<HubSharedServices>()) : null;
const sql = sharedContext ? Context.get(sharedContext, SqlClient.SqlClient) : null;

const makeEngine = (userId: string): EngineRuntime =>
  ManagedRuntime.make(
    sharedContext
      ? makeHubUserEngineLayer({ userId, shared: sharedContext })
      : sqliteEngineLayer(target),
  ) as EngineRuntime;

const activate = async (userId: string) => {
  const runtime = makeEngine(userId);
  const queriesBefore = pgQueries;
  const { ms } = await time(() => runtime.runPromise(Effect.service(OrchestrationEngineService)));
  return { runtime, ms, queries: pgQueries - queriesBefore };
};

const results: Record<string, unknown> = { mode };
// BENCH_SECTIONS=memory measures engine memory in a fresh process (one warm-up
// activation first), so earlier snapshot reads do not pre-grow the heap.
const onlyMemory = process.env.BENCH_SECTIONS === "memory";
if (onlyMemory) {
  const warmup = await activate(owner);
  await warmup.runtime.dispose();
} else {
  // Activation (bootstrap + command read model), cold first then repeated.
  const cold = await activate(owner);
  const readModel = (await cold.runtime.runPromise(
    Effect.flatMap(Effect.service(ProjectionSnapshotQuery), (query) => query.getCommandReadModel()),
  )) as OrchestrationReadModel;
  out(
    `read model: projects=${readModel.projects.length} threads=${readModel.threads.length} ` +
      `latestTurns=${readModel.threads.filter((thread) => thread.latestTurn !== null).length} ` +
      `sessions=${readModel.threads.filter((thread) => thread.session !== null).length} ` +
      `plans=${readModel.threads.reduce((n, thread) => n + thread.proposedPlans.length, 0)} ` +
      `snapshotSequence=${readModel.snapshotSequence} jsonBytes=${JSON.stringify(readModel).length}`,
  );
  out(`cold activation: ${cold.ms.toFixed(1)}ms queries=${cold.queries}`);
  await cold.runtime.dispose();
  const activationMs: number[] = [];
  let activationQueries = 0;
  for (let index = 0; index < ACTIVATIONS; index += 1) {
    const run = await activate(owner);
    activationMs.push(run.ms);
    activationQueries = run.queries;
    await run.runtime.dispose();
  }
  out(`warm activation: ${summary(activationMs)} queries/activation=${activationQueries}`);
  results.activation = { coldMs: cold.ms, warm: activationMs, queries: activationQueries };

  // getCommandReadModel alone, on a live engine.
  const live = await activate(owner);
  const query = await live.runtime.runPromise(Effect.service(ProjectionSnapshotQuery));
  const readModelMs: number[] = [];
  for (let index = 0; index < ACTIVATIONS; index += 1) {
    readModelMs.push((await time(() => live.runtime.runPromise(query.getCommandReadModel()))).ms);
  }
  out(`getCommandReadModel: ${summary(readModelMs)}`);
  const shellMs: number[] = [];
  let shellThreads = 0;
  for (let index = 0; index < ACTIVATIONS; index += 1) {
    const run = await time(() => live.runtime.runPromise(query.getShellSnapshot()));
    shellMs.push(run.ms);
    shellThreads = run.value.threads.length;
  }
  out(`getShellSnapshot: ${summary(shellMs)} threads=${shellThreads}`);
  results.readModelMs = readModelMs;
  results.shellMs = shellMs;

  // Thread detail loads: the client's first page (turnLimit 10) and the full thread.
  const details: Record<string, unknown> = {};
  for (const [index, threadId] of threadIds.entries()) {
    for (const window of [{ turnLimit: 10 }, undefined] as const) {
      const samples: number[] = [];
      let counts = "";
      for (let run = 0; run < DETAIL_RUNS; run += 1) {
        const queriesBefore = pgQueries;
        const { ms, value } = await time(() =>
          live.runtime.runPromise(query.getThreadDetailSnapshot(threadId, window)),
        );
        samples.push(ms);
        const thread = Option.getOrThrow(value).thread;
        counts =
          `messages=${thread.messages.length} activities=${thread.activities.length} ` +
          `checkpoints=${thread.checkpoints.length} queries=${pgQueries - queriesBefore}`;
      }
      const label = `thread#${index + 1} ${window ? "page(turnLimit=10)" : "full"}`;
      out(`detail ${label}: ${summary(samples)} ${counts}`);
      details[label] = { samples, counts };
    }
  }
  results.details = details;

  // Command dispatch on the owner's largest thread: activity appends and streaming deltas.
  const engine = await live.runtime.runPromise(Effect.service(OrchestrationEngineService));
  const dispatchThread = threadIds[0]!;
  const appendMs: number[] = [];
  const appendQueries: number[] = [];
  const createdAt = "2026-09-25T12:00:00.000Z";
  for (let index = 0; index < DISPATCHES; index += 1) {
    const queriesBefore = pgQueries;
    appendMs.push(
      (
        await time(() =>
          live.runtime.runPromise(
            engine.dispatch({
              type: "thread.activity.append",
              commandId: CommandId.make(`bench-activity-${process.pid}-${index}`),
              threadId: dispatchThread,
              activity: {
                id: EventId.make(`bench-activity-${process.pid}-${index}`),
                tone: "tool",
                kind: "bench.synthetic",
                summary: "synthetic benchmark activity",
                payload: { index },
                turnId: null,
                createdAt,
              },
              createdAt,
            }),
          ),
        )
      ).ms,
    );
    appendQueries.push(pgQueries - queriesBefore);
  }
  out(
    `dispatch thread.activity.append: ${summary(appendMs)} queries/command=${percentile(appendQueries, 50)}`,
  );
  const deltaMs: number[] = [];
  const deltaQueries: number[] = [];
  for (let index = 0; index < DISPATCHES; index += 1) {
    const queriesBefore = pgQueries;
    deltaMs.push(
      (
        await time(() =>
          live.runtime.runPromise(
            engine.dispatch({
              type: "thread.message.assistant.delta",
              commandId: CommandId.make(`bench-delta-${process.pid}-${index}`),
              threadId: dispatchThread,
              messageId: MessageId.make(`bench-message-${process.pid}`),
              delta: "x",
              createdAt,
            }),
          ),
        )
      ).ms,
    );
    deltaQueries.push(pgQueries - queriesBefore);
  }
  out(
    `dispatch thread.message.assistant.delta: ${summary(deltaMs)} queries/command=${percentile(deltaQueries, 50)}`,
  );
  results.dispatch = { appendMs, appendQueries, deltaMs, deltaQueries };
  await live.runtime.dispose();
}

// Memory per active engine: distinct synthetic users with the owner's metadata.
if (sql && shared) {
  const users = Array.from({ length: ENGINES }, (_, index) => `bench-user-${index + 1}`);
  await shared.runPromise(
    Effect.gen(function* () {
      for (const table of [
        "projection_projects",
        "projection_threads",
        "projection_thread_sessions",
        "projection_turns",
        "projection_thread_proposed_plans",
        "projection_state",
      ]) {
        const columns = (yield* sql<{ name: string }>`
          SELECT column_name AS name FROM information_schema.columns
          WHERE table_name = ${table} AND column_name NOT IN ('user_id', 'row_id')
          ORDER BY ordinal_position
        `).map((row) => row.name);
        const list = sql.literal(columns.join(", "));
        yield* sql`DELETE FROM ${sql(table)} WHERE user_id LIKE 'bench-user-%'`;
        for (const user of users) {
          yield* sql`
            INSERT INTO ${sql(table)} (user_id, ${list})
            SELECT ${user}, ${list} FROM ${sql(table)} WHERE user_id = ${owner}
          `;
        }
      }
      yield* sql`DELETE FROM hub_users WHERE user_id LIKE 'bench-user-%'`;
      for (const user of users) {
        yield* sql`
          INSERT INTO hub_users (user_id, last_event_sequence)
          SELECT ${user}, last_event_sequence FROM hub_users WHERE user_id = ${owner}
        `;
      }
    }),
  );
  gc();
  gc();
  const before = process.memoryUsage();
  const engines: EngineRuntime[] = [];
  for (const user of users) {
    engines.push((await activate(user)).runtime);
  }
  gc();
  gc();
  const after = process.memoryUsage();
  out(
    `memory: ${ENGINES} active engines rssDelta=${mib(after.rss - before.rss)}MiB ` +
      `heapUsedDelta=${mib(after.heapUsed - before.heapUsed)}MiB ` +
      `perEngine rss=${mib((after.rss - before.rss) / ENGINES)}MiB heap=${mib((after.heapUsed - before.heapUsed) / ENGINES)}MiB ` +
      `baseRss=${mib(before.rss)}MiB`,
  );
  results.memory = { engines: ENGINES, before, after };
  // Parallel activation of all synthetic users at once (cold-start storm).
  for (const runtime of engines) await runtime.dispose();
  const storm = await time(() => Promise.all(users.map((user) => activate(user))));
  out(`parallel activation of ${ENGINES} users: ${storm.ms.toFixed(1)}ms total`);
  for (const run of storm.value) await run.runtime.dispose();
  await shared.runPromise(
    Effect.gen(function* () {
      for (const table of [
        "projection_projects",
        "projection_threads",
        "projection_thread_sessions",
        "projection_turns",
        "projection_thread_proposed_plans",
        "projection_state",
        "hub_users",
      ]) {
        yield* sql`DELETE FROM ${sql(table)} WHERE user_id LIKE 'bench-user-%'`;
      }
    }),
  );
  await shared.dispose();
} else {
  gc();
  gc();
  const before = process.memoryUsage();
  const engines: EngineRuntime[] = [];
  for (let index = 0; index < ENGINES; index += 1) engines.push((await activate(owner)).runtime);
  gc();
  gc();
  const after = process.memoryUsage();
  out(
    `memory: ${ENGINES} active engines rssDelta=${mib(after.rss - before.rss)}MiB ` +
      `heapUsedDelta=${mib(after.heapUsed - before.heapUsed)}MiB ` +
      `perEngine rss=${mib((after.rss - before.rss) / ENGINES)}MiB heap=${mib((after.heapUsed - before.heapUsed) / ENGINES)}MiB`,
  );
  for (const runtime of engines) await runtime.dispose();
}

out(`RESULTS_JSON ${JSON.stringify(results)}`);
