// @effect-diagnostics nodeBuiltinImport:off
// Verifies a `t3 hub import`: reads the standalone state directory and the hub
// tenant it was imported into through the same snapshot queries (the
// standalone SQLite layer and the hub's Postgres layer, selected by
// HubDatabase as in a server) and compares the results. Prints only
// equal/different plus counts, never row contents.
//
// Reads the hub database and tenant from the same environment as
// `t3 hub import` (T3CODE_HUB_DATABASE_URL, T3CODE_HUB_DATABASE_ADMIN_URL,
// T3CODE_HUB_TENANT_ID). Every thread is compared unless thread ids are given.
// NUL characters, which the import stores as U+FFFD, compare equal.
//
//   node apps/server/scripts/hub-import-compare.ts <state-dir> [thread-id,...]
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId, type OrchestrationThreadDetailWindow } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";

import { ServerConfig } from "../src/config.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../src/orchestration/Layers/ProjectionSnapshotQuery.ts";
import { ProjectionSnapshotQuery } from "../src/orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../src/orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../src/orchestration/ThreadPlanProgress.ts";
import {
  layerConfig as ServerPersistenceLive,
  makeSqlitePersistenceLive,
} from "../src/persistence/Layers/Sqlite.ts";
import { HubDatabase } from "../src/persistence/Postgres/HubDatabase.ts";
import { makeHubDatabase } from "../src/persistence/Postgres/HubDatabaseLive.ts";
import { RepositoryIdentityResolver } from "../src/project/RepositoryIdentityResolver.ts";

const [stateDir, threadArg] = process.argv.slice(2);
const databaseUrl = process.env.T3CODE_HUB_DATABASE_URL;
const tenantId = process.env.T3CODE_HUB_TENANT_ID;
if (!stateDir || !databaseUrl || !tenantId) {
  throw new Error(
    "usage: T3CODE_HUB_DATABASE_URL=… T3CODE_HUB_TENANT_ID=… hub-import-compare.ts <state-dir> [thread-id,...]",
  );
}
const out = (line: string) => process.stdout.write(`${line}\n`);

// Repository identity is resolved from checkouts standalone and recorded in the
// hub; neither is under test here.
const queryLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
  Layer.provide(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provide(Layer.succeed(RepositoryIdentityResolver, { resolve: () => Effect.succeed(null) })),
);
const platform = ServerConfig.layerTest(process.cwd(), { prefix: "t3-hub-import-compare-" }).pipe(
  Layer.provideMerge(NodeServices.layer),
);
const sqliteQuery = ManagedRuntime.make(
  queryLayer.pipe(
    Layer.provide(makeSqlitePersistenceLive(NodePath.join(stateDir, "state.sqlite"))),
    Layer.provide(platform),
  ),
);
const hubQuery = ManagedRuntime.make(
  queryLayer.pipe(
    Layer.provide(ServerPersistenceLive),
    Layer.provide(platform),
    Layer.provide(
      Layer.effect(
        HubDatabase,
        makeHubDatabase({
          databaseUrl,
          databaseAdminUrl: process.env.T3CODE_HUB_DATABASE_ADMIN_URL,
          tenantId,
        }),
      ),
    ),
  ),
);

const both = async <A, E>(
  read: (query: ProjectionSnapshotQuery["Service"]) => Effect.Effect<A, E>,
) => ({
  sqlite: await sqliteQuery.runPromise(
    Effect.flatMap(Effect.service(ProjectionSnapshotQuery), read),
  ),
  hub: await hubQuery.runPromise(Effect.flatMap(Effect.service(ProjectionSnapshotQuery), read)),
});

// Sequences continue per tenant in the hub, so they are not compared, and the
// hub stores NUL characters as U+FFFD (Postgres text cannot hold them).
const normalize = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value), (key, inner) =>
    key === "snapshotSequence" || key === "threadSequence"
      ? undefined
      : typeof inner === "string"
        ? inner.replaceAll("\u0000", "\uFFFD")
        : inner,
  );

let failures = 0;
const check = (label: string, sqlite: unknown, hub: unknown, counts: string) => {
  const left = JSON.stringify(normalize(sqlite));
  const right = JSON.stringify(normalize(hub));
  const equal = left === right;
  if (!equal) failures += 1;
  out(`${equal ? "equal" : "DIFFERENT"}: ${label} (${counts}; ${left.length} bytes)`);
};

const readModel = await both((query) => query.getCommandReadModel());
check(
  "getCommandReadModel",
  { ...readModel.sqlite, updatedAt: undefined },
  { ...readModel.hub, updatedAt: undefined },
  `threads=${readModel.hub.threads.length}`,
);
const shell = await both((query) => query.getShellSnapshot());
check(
  "getShellSnapshot",
  { ...shell.sqlite, updatedAt: undefined },
  { ...shell.hub, updatedAt: undefined },
  `threads=${shell.hub.threads.length}`,
);
const archived = await both((query) => query.getArchivedShellSnapshot());
check(
  "getArchivedShellSnapshot",
  { ...archived.sqlite, updatedAt: undefined },
  { ...archived.hub, updatedAt: undefined },
  `threads=${archived.hub.threads.length}`,
);
const counts = await both((query) => query.getCounts());
check("getCounts", counts.sqlite, counts.hub, `threads=${counts.hub.threadCount}`);

const threadIds = threadArg
  ? threadArg.split(",").map((id) => ThreadId.make(id))
  : readModel.sqlite.threads.map((thread) => thread.id);
for (const [index, threadId] of threadIds.entries()) {
  const label = `thread#${index + 1}`;
  const full = await both((query) => query.getThreadDetailSnapshot(threadId));
  const fullHub = Option.getOrUndefined(full.hub)?.thread;
  check(
    `${label} full`,
    full.sqlite,
    full.hub,
    fullHub
      ? `messages=${fullHub.messages.length} activities=${fullHub.activities.length}`
      : "absent",
  );
  const byId = await both((query) => query.getThreadDetailById(threadId));
  check(`${label} getThreadDetailById`, byId.sqlite, byId.hub, "raw activities");
  if (fullHub === undefined) continue;
  // Walk every page with the client's page sizes and compare each page.
  for (const turnLimit of [10, 3]) {
    let window: OrchestrationThreadDetailWindow = { turnLimit };
    for (let page = 1; page <= 200; page += 1) {
      const current = window;
      const result = await both((query) => query.getThreadDetailSnapshot(threadId, current));
      const hubPage = Option.getOrUndefined(result.hub);
      check(
        `${label} turnLimit=${turnLimit} page ${page}`,
        result.sqlite,
        result.hub,
        hubPage
          ? `messages=${hubPage.thread.messages.length} activities=${hubPage.thread.activities.length} hasMore=${hubPage.page?.hasMore}`
          : "absent",
      );
      const cursor = hubPage?.page?.beforeCursor;
      if (!hubPage?.page?.hasMore || !cursor) break;
      window = { turnLimit, beforeCursor: cursor };
    }
  }
}

const search = await both((query) => query.searchThreads({ query: "the", limit: 50 }));
check("searchThreads('the')", search.sqlite, search.hub, `matches=${search.hub.matches.length}`);
const searchUpper = await both((query) => query.searchThreads({ query: "THE", limit: 50 }));
check(
  "searchThreads('THE')",
  searchUpper.sqlite,
  searchUpper.hub,
  `matches=${searchUpper.hub.matches.length}`,
);

out(failures === 0 ? "ALL EQUAL" : `${failures} DIFFERENCES`);
await hubQuery.dispose();
await sqliteQuery.dispose();
process.exitCode = failures === 0 ? 0 : 1;
