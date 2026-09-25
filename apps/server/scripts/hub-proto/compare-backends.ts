// Compares the SQLite and Postgres read paths over the same imported history.
// Prints only equal/different plus counts, never row contents.
//
//   node scripts/hub-proto/compare-backends.ts <sqlite-file> <postgres-url> <owner> <thread-ids,> [skip-thread-ids,]
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId, type OrchestrationThreadDetailWindow } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";

import { ServerConfig } from "../../src/config.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../../src/orchestration/Layers/ProjectionSnapshotQuery.ts";
import { ProjectionSnapshotQuery } from "../../src/orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../../src/orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../../src/orchestration/ThreadPlanProgress.ts";
import { makeSqlitePersistenceLive } from "../../src/persistence/Layers/Sqlite.ts";
import {
  makeHubSharedLayer,
  makeHubUserEngineLayer,
  type HubSharedServices,
} from "../../src/persistence/Postgres/HubEngine.ts";
import { RepositoryIdentityResolver } from "../../src/project/RepositoryIdentityResolver.ts";

const [sqliteFile, pgUrl, owner, threadArg, skipArg] = process.argv.slice(2);
if (!sqliteFile || !pgUrl || !owner || !threadArg) {
  throw new Error("usage: compare-backends.ts <sqlite> <pg-url> <owner> <threads,> [skip,]");
}
const threadIds = threadArg.split(",").map((id) => ThreadId.make(id));
// Threads the benchmark wrote to differ by design; leave them out of whole-model checks.
const skipThreads = new Set(skipArg ? skipArg.split(",") : []);
const out = (line: string) => process.stdout.write(`${line}\n`);

const sqliteQuery = ManagedRuntime.make(
  OrchestrationProjectionSnapshotQueryLive.pipe(
    Layer.provide(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provide(
      Layer.succeed(RepositoryIdentityResolver, { resolve: () => Effect.succeed(null) }),
    ),
    Layer.provide(makeSqlitePersistenceLive(sqliteFile)),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-hub-compare-" })),
    Layer.provide(NodeServices.layer),
  ),
);
const shared = ManagedRuntime.make(makeHubSharedLayer({ url: pgUrl }));
const sharedContext = await shared.runPromise(Effect.context<HubSharedServices>());
const pgQuery = ManagedRuntime.make(
  makeHubUserEngineLayer({ userId: owner, shared: sharedContext }),
);

const both = async <A, E>(
  read: (query: ProjectionSnapshotQuery["Service"]) => Effect.Effect<A, E>,
) => {
  const sqlite = await sqliteQuery.runPromise(
    Effect.flatMap(Effect.service(ProjectionSnapshotQuery), read),
  );
  const pg = await pgQuery.runPromise(
    Effect.flatMap(Effect.service(ProjectionSnapshotQuery), read),
  );
  return { sqlite, pg };
};

// Drops fields that legitimately differ between the two stores after the
// benchmark appended events (sequences, max updatedAt) and the skipped threads.
const normalize = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value), (key, inner) => {
    if (key === "snapshotSequence" || key === "threadSequence") return undefined;
    if (Array.isArray(inner)) {
      return inner.filter(
        (item) =>
          !(
            item &&
            typeof item === "object" &&
            skipThreads.has((item as { id?: string }).id ?? "")
          ),
      );
    }
    return inner;
  });

let failures = 0;
const check = (label: string, sqlite: unknown, pg: unknown, counts: string) => {
  const left = JSON.stringify(normalize(sqlite));
  const right = JSON.stringify(normalize(pg));
  const equal = left === right;
  if (!equal) failures += 1;
  out(`${equal ? "equal" : "DIFFERENT"}: ${label} (${counts}; ${left.length} bytes)`);
};

const readModel = await both((query) => query.getCommandReadModel());
check(
  "getCommandReadModel",
  { ...readModel.sqlite, updatedAt: undefined },
  { ...readModel.pg, updatedAt: undefined },
  `threads=${readModel.pg.threads.length}`,
);
const shell = await both((query) => query.getShellSnapshot());
check(
  "getShellSnapshot",
  { ...shell.sqlite, updatedAt: undefined },
  { ...shell.pg, updatedAt: undefined },
  `threads=${shell.pg.threads.length}`,
);
const archived = await both((query) => query.getArchivedShellSnapshot());
check(
  "getArchivedShellSnapshot",
  { ...archived.sqlite, updatedAt: undefined },
  { ...archived.pg, updatedAt: undefined },
  `threads=${archived.pg.threads.length}`,
);
const counts = await both((query) => query.getCounts());
check("getCounts", counts.sqlite, counts.pg, `threads=${counts.pg.threadCount}`);

for (const [index, threadId] of threadIds.entries()) {
  const full = await both((query) => query.getThreadDetailSnapshot(threadId));
  const fullPg = Option.getOrThrow(full.pg).thread;
  check(
    `thread#${index + 1} full`,
    full.sqlite,
    full.pg,
    `messages=${fullPg.messages.length} activities=${fullPg.activities.length}`,
  );
  const byId = await both((query) => query.getThreadDetailById(threadId));
  check(`thread#${index + 1} getThreadDetailById`, byId.sqlite, byId.pg, "raw activities");
  // Walk every page with the client's page sizes and compare each page.
  for (const turnLimit of [10, 3]) {
    let window: OrchestrationThreadDetailWindow = { turnLimit };
    for (let page = 1; page <= 200; page += 1) {
      const current = window;
      const result = await both((query) => query.getThreadDetailSnapshot(threadId, current));
      const pgSnapshot = Option.getOrThrow(result.pg);
      check(
        `thread#${index + 1} turnLimit=${turnLimit} page ${page}`,
        result.sqlite,
        result.pg,
        `messages=${pgSnapshot.thread.messages.length} activities=${pgSnapshot.thread.activities.length} hasMore=${pgSnapshot.page?.hasMore}`,
      );
      const cursor = pgSnapshot.page?.beforeCursor;
      if (!pgSnapshot.page?.hasMore || !cursor) break;
      window = { turnLimit, beforeCursor: cursor };
    }
  }
}

const search = await both((query) => query.searchThreads({ query: "the", limit: 50 }));
check("searchThreads('the')", search.sqlite, search.pg, `matches=${search.pg.matches.length}`);
const searchUpper = await both((query) => query.searchThreads({ query: "THE", limit: 50 }));
check(
  "searchThreads('THE')",
  searchUpper.sqlite,
  searchUpper.pg,
  `matches=${searchUpper.pg.matches.length}`,
);

out(failures === 0 ? "ALL EQUAL" : `${failures} DIFFERENCES`);
await pgQuery.dispose();
await shared.dispose();
await sqliteQuery.dispose();
