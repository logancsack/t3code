/**
 * Per-user orchestration engine over the shared hub Postgres pool.
 *
 * The hub keeps T3's one-writer engine model per user: each active user gets an
 * engine (command queue, in-memory command read model, event PubSub) whose
 * repositories are scoped by `HubTenant`. All engines in a process share one
 * `SqlClient`, so the pool size is independent of the number of active users.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "../../config.ts";
import { makeHubPostgresPersistenceLive, type HubPostgresConfig } from "../Layers/Postgres.ts";
import { OrchestrationEngineLive } from "../../orchestration/Layers/OrchestrationEngine.ts";
import { makeOrchestrationProjectionPipeline } from "../../orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionPipeline } from "../../orchestration/Services/ProjectionPipeline.ts";
import * as ThreadBackgroundLiveness from "../../orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../../orchestration/ThreadPlanProgress.ts";
import { RepositoryIdentityResolver } from "../../project/RepositoryIdentityResolver.ts";
import { hubTenantLayer } from "./HubTenant.ts";
import { PgOrchestrationCommandReceiptRepositoryLive } from "./OrchestrationCommandReceipts.ts";
import { PgOrchestrationEventStoreLive } from "./OrchestrationEventStore.ts";
import { PgProjectionPendingApprovalRepositoryLive } from "./ProjectionPendingApprovals.ts";
import { PgProjectionProjectRepositoryLive } from "./ProjectionProjects.ts";
import { PgProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { PgProjectionStateRepositoryLive } from "./ProjectionState.ts";
import { PgProjectionThreadActivityRepositoryLive } from "./ProjectionThreadActivities.ts";
import { PgProjectionThreadMessageRepositoryLive } from "./ProjectionThreadMessages.ts";
import { PgProjectionThreadProposedPlanRepositoryLive } from "./ProjectionThreadProposedPlans.ts";
import { PgProjectionThreadSessionRepositoryLive } from "./ProjectionThreadSessions.ts";
import { PgProjectionThreadRepositoryLive } from "./ProjectionThreads.ts";
import { PgProjectionTurnRepositoryLive } from "./ProjectionTurns.ts";

export const PgOrchestrationProjectionPipelineLive = Layer.effect(
  OrchestrationProjectionPipeline,
  makeOrchestrationProjectionPipeline(),
).pipe(
  Layer.provideMerge(PgProjectionProjectRepositoryLive),
  Layer.provideMerge(PgProjectionThreadRepositoryLive),
  Layer.provideMerge(PgProjectionThreadMessageRepositoryLive),
  Layer.provideMerge(PgProjectionThreadProposedPlanRepositoryLive),
  Layer.provideMerge(PgProjectionThreadActivityRepositoryLive),
  Layer.provideMerge(PgProjectionThreadSessionRepositoryLive),
  Layer.provideMerge(PgProjectionTurnRepositoryLive),
  Layer.provideMerge(PgProjectionPendingApprovalRepositoryLive),
  Layer.provideMerge(PgProjectionStateRepositoryLive),
);

// The hub has no repositories on disk. Repository identity moves onto the
// project record (see the design doc); until then projects report none.
const NoRepositoryIdentityLive = Layer.succeed(RepositoryIdentityResolver, {
  resolve: () => Effect.succeed(null),
});

/** Process-wide services every user engine shares: the pool and the platform. */
export type HubSharedServices = SqlClient.SqlClient | NodeServices.NodeServices;

export const makeHubSharedLayer = (config: HubPostgresConfig) =>
  Layer.merge(makeHubPostgresPersistenceLive(config), NodeServices.layer);

/**
 * Engine + snapshot query for one user over the process-wide services.
 * ServerConfig is only used for attachment side effects, which move to object
 * storage in the hub; a per-user temp config keeps the prototype self-contained.
 */
export const makeHubUserEngineLayer = (input: {
  readonly userId: string;
  readonly shared: Context.Context<HubSharedServices>;
}) => {
  const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: `t3-hub-${input.userId.replace(/[^a-zA-Z0-9_-]/g, "_")}-`,
  });
  return Layer.mergeAll(
    OrchestrationEngineLive.pipe(
      Layer.provide(PgProjectionSnapshotQueryLive),
      Layer.provide(PgOrchestrationProjectionPipelineLive),
    ),
    PgProjectionSnapshotQueryLive,
  ).pipe(
    Layer.provideMerge(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provide(PgOrchestrationEventStoreLive),
    Layer.provideMerge(PgOrchestrationCommandReceiptRepositoryLive),
    Layer.provide(NoRepositoryIdentityLive),
    Layer.provide(hubTenantLayer(input.userId)),
    Layer.provideMerge(serverConfigLayer),
    Layer.provideMerge(Layer.succeedContext(input.shared)),
  );
};
