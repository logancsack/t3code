/**
 * HubLayers - the hub's replacements for checkout-bound services.
 *
 * `server.ts` composes the same runtime for every mode from a
 * `ServerModeLayers` record. Standalone uses the local implementations; a
 * hub (`T3CODE_SERVER_MODE=hub`) uses this set, in which every service that
 * would read a checkout, run git, open a PTY or spawn a provider CLI routes
 * to the thread's runner instead, or serves from a hub cache, or fails with
 * a typed error. Hub-only infrastructure (machine directory, connection
 * pool, event delivery, session registry, caches) is provided underneath.
 *
 * @module hub/HubLayers
 */
import { SourceControlRepositoryError, type SourceControlProviderKind } from "@t3tools/contracts";
import { HubModeUnsupportedError } from "@t3tools/contracts/runner";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { ServerConfig } from "../config.ts";
import { makeHubPgClientLayer } from "../persistence/Layers/Postgres.ts";
import type { PersistenceSqlError } from "../persistence/Errors.ts";
import { HubThreadMachineStateSqliteLive } from "../persistence/Layers/HubThreadMachineState.ts";
import { HUB_MIGRATION_050 } from "../persistence/Postgres/migrations/050_HubThreadMachineState.ts";
import { HubThreadMachineStatePostgresLive } from "../persistence/Postgres/HubThreadMachineState.ts";
import { hubTenantLayer } from "../persistence/Postgres/HubTenant.ts";
import * as ProviderSessionRuntime from "../persistence/ProviderSessionRuntime.ts";
import type {
  CheckpointTurnDiffStore,
  RunnerCursorStore,
  ThreadVcsStatusStore,
} from "../persistence/Services/HubThreadMachineState.ts";
import { RepositoryIdentityResolver } from "../project/RepositoryIdentityResolver.ts";
import { resolveBuiltInDrivers } from "../provider/builtInDrivers.ts";
import { makeProviderInstanceRegistryHydration } from "../provider/Layers/ProviderInstanceRegistryHydration.ts";
import { DeterministicIngestionCommandIds } from "../serverModeHooks.ts";
import { SourceControlRepositoryService } from "../sourceControl/SourceControlRepositoryService.ts";
import * as HubRunnerLifecycle from "./HubRunnerLifecycle.ts";
import * as HubThreadCheckouts from "./HubThreadCheckouts.ts";
import { hubTerminalManagerLayer } from "./HubTerminals.ts";
import {
  hubGitManagerLayer,
  hubGitWorkflowServiceLayer,
  hubReviewServiceLayer,
  hubVcsProvisioningServiceLayer,
  hubVcsStatusBroadcasterLayer,
  hubVcsStatusCacheLayer,
} from "./HubVcs.ts";
import {
  hubCheckoutGitProbeLayer,
  hubCheckpointStoreLayer,
  hubWorkspaceEntriesLayer,
  hubWorkspaceFileSystemLayer,
  hubWorkspacePathsLayer,
} from "./HubWorkspace.ts";
import * as MachineDirectory from "./MachineDirectory.ts";
import { makeRemoteProviderDriver } from "./RemoteProviderDriver.ts";
import * as RemoteSessionRegistry from "./RemoteSessionRegistry.ts";
import * as RunnerConnectionPool from "./RunnerConnectionPool.ts";
import * as RunnerEventDelivery from "./RunnerEventDelivery.ts";

/**
 * Hub thread-machine state: Postgres iff `T3CODE_HUB_DATABASE_URL` is set,
 * otherwise the server's SQLite database (tests and local development).
 *
 * TODO(tm-hub integration): use the hub persistence composition's Postgres
 * client and tenant instead of this dedicated pool, and run migration 050
 * from the hub migration framework.
 */
type HubStateStores = RunnerCursorStore | CheckpointTurnDiffStore | ThreadVcsStatusStore;

const hubStateStores = <E, R>(sqlitePersistence: Layer.Layer<SqlClient.SqlClient, E, R>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const hub = config.hub;
      const sqlite: Layer.Layer<HubStateStores, E | PersistenceSqlError | SqlError, R> =
        HubThreadMachineStateSqliteLive.pipe(Layer.provide(sqlitePersistence));
      if (!hub?.databaseUrl || !hub.tenantId) return sqlite;
      const postgres: Layer.Layer<HubStateStores, E | PersistenceSqlError | SqlError, R> =
        HubThreadMachineStatePostgresLive.pipe(
          Layer.provide(Layer.effectDiscard(HUB_MIGRATION_050)),
          Layer.provide(hubTenantLayer(hub.tenantId)),
          Layer.provideMerge(
            makeHubPgClientLayer({
              url: hub.databaseUrl,
              maxConnections: 2,
              applicationName: "t3-hub-thread-machines",
            }),
          ),
        );
      return postgres;
    }),
  );

/**
 * Hub-only services underneath the whole runtime: stores, machine directory,
 * connection pool, session registry, event delivery and git status cache.
 */
export const makeHubInfrastructureLayer = <E, R>(parts: {
  readonly sqlitePersistence: Layer.Layer<SqlClient.SqlClient, E, R>;
}) =>
  Layer.mergeAll(RunnerEventDelivery.layer, hubVcsStatusCacheLayer).pipe(
    Layer.provideMerge(
      RemoteSessionRegistry.layer.pipe(
        Layer.provide(ProviderSessionRuntime.layer.pipe(Layer.provide(parts.sqlitePersistence))),
      ),
    ),
    Layer.provideMerge(RunnerConnectionPool.layer),
    Layer.provideMerge(MachineDirectory.layer),
    Layer.provideMerge(hubStateStores(parts.sqlitePersistence)),
  );

/** Every built-in driver kind, each forwarding to the thread's runner. */
export const hubProviderInstanceRegistryLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    return makeProviderInstanceRegistryHydration(
      resolveBuiltInDrivers({ museCodeEnabled: config.museCodeEnabled }).map(
        makeRemoteProviderDriver,
      ),
    );
  }),
);

/**
 * A hub never runs git locally, so identity comes from what the hub persists
 * about the project. TODO(tm-hub integration): the hub persistence branch
 * stores repository identity on projects and provides this resolver.
 */
export const hubRepositoryIdentityResolverLayer = Layer.succeed(
  RepositoryIdentityResolver,
  RepositoryIdentityResolver.of({ resolve: () => Effect.succeed(null) }),
);

const unsupportedRepositoryOperation = (
  provider: SourceControlProviderKind,
  operation: string,
  detail: string,
) =>
  new SourceControlRepositoryError({
    provider,
    operation,
    detail,
    cause: new HubModeUnsupportedError({ operation, detail }),
  });

/**
 * Repository lookup and listing use provider APIs and work on a hub; cloning
 * and publishing need a checkout and have no hub implementation yet.
 */
export const hubSourceControlRepositoryServiceLayer = Layer.effect(
  SourceControlRepositoryService,
  Effect.gen(function* () {
    const local = yield* SourceControlRepositoryService;
    return SourceControlRepositoryService.of({
      listRepositories: local.listRepositories,
      lookupRepository: local.lookupRepository,
      cloneRepository: (input) =>
        Effect.fail(
          unsupportedRepositoryOperation(
            input.provider ?? "unknown",
            "cloneRepository",
            "Thread machines clone a project's repository themselves.",
          ),
        ),
      publishRepository: (input) =>
        Effect.fail(
          unsupportedRepositoryOperation(
            input.provider ?? "unknown",
            "publishRepository",
            "Publishing a checkout is not routed to thread machines yet.",
          ),
        ),
    });
  }),
);

/** Hooks consumed by the orchestration reactors and command dispatch. */
export const hubReactorHooksLayer = Layer.mergeAll(
  Layer.succeed(DeterministicIngestionCommandIds, true),
  hubCheckoutGitProbeLayer,
  HubThreadCheckouts.layer,
);

/** Background work that needs the reactors: delivery acks, resume, machine release. */
export const hubRuntimeBackgroundLayer = HubRunnerLifecycle.layer;

export {
  hubCheckpointStoreLayer,
  hubGitManagerLayer,
  hubGitWorkflowServiceLayer,
  hubReviewServiceLayer,
  hubTerminalManagerLayer,
  hubVcsProvisioningServiceLayer,
  hubVcsStatusBroadcasterLayer,
  hubWorkspaceEntriesLayer,
  hubWorkspaceFileSystemLayer,
  hubWorkspacePathsLayer,
};
