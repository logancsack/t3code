import * as NodeCrypto from "node:crypto";

import { CommandId, EventId, type OrchestrationThreadShell } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import * as ServerConfig from "./config.ts";
import { hasQueuedManagedTurnStart, managedGatewayTokenMatches } from "./managedDevPcActivity.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";

export const MANAGED_DEVPC_DRAIN_PATH = "/api/_devpc/drain";
const MANAGED_GATEWAY_HEADER = "x-devpc-gateway-token";
export const MANAGED_DEVPC_DRAIN_DETAIL =
  "The agent run was stopped because the workspace is being paused. The run is complete with an infrastructure interruption; the original request remains available to retry after resume.";

export function managedThreadNeedsTerminalization(
  thread: OrchestrationThreadShell,
  nowMs: number,
): boolean {
  return (
    thread.latestTurn?.state === "running" ||
    thread.session?.status === "starting" ||
    thread.session?.status === "running" ||
    hasQueuedManagedTurnStart([thread], nowMs)
  );
}

const handleManagedDevPcDrain = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const config = yield* ServerConfig.ServerConfig;
  if (
    !config.managedDevPc ||
    !managedGatewayTokenMatches(request.headers[MANAGED_GATEWAY_HEADER], config.managedGatewayToken)
  ) {
    return HttpServerResponse.jsonUnsafe(
      { error: { code: "NOT_FOUND", message: "Drain route not found." } },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const nowMs = yield* Clock.currentTimeMillis;
  const createdAt = DateTime.formatIso(DateTime.makeUnsafe(nowMs));
  const snapshot = yield* snapshots.getShellSnapshot();
  const targets = snapshot.threads.filter((thread) =>
    managedThreadNeedsTerminalization(thread, nowMs),
  );

  yield* Effect.forEach(
    targets,
    (thread) =>
      Effect.gen(function* () {
        const activeTurnId = thread.session?.activeTurnId ?? null;
        if (activeTurnId !== null) {
          yield* engine.dispatch({
            type: "thread.turn.interrupt",
            commandId: CommandId.make(`server:managed-drain-interrupt:${NodeCrypto.randomUUID()}`),
            threadId: thread.id,
            turnId: activeTurnId,
            createdAt,
          });
        }
        yield* engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make(`server:managed-drain-terminal:${NodeCrypto.randomUUID()}`),
          threadId: thread.id,
          session: {
            ...(thread.session ?? {
              threadId: thread.id,
              providerName: null,
              providerInstanceId: thread.modelSelection.instanceId,
              runtimeMode: thread.runtimeMode,
            }),
            status: "error",
            activeTurnId: null,
            lastError: MANAGED_DEVPC_DRAIN_DETAIL,
            updatedAt: createdAt,
          },
          createdAt,
        });
        yield* engine.dispatch({
          type: "thread.activity.append",
          commandId: CommandId.make(`server:managed-drain-activity:${NodeCrypto.randomUUID()}`),
          threadId: thread.id,
          activity: {
            id: EventId.make(NodeCrypto.randomUUID()),
            tone: "error",
            kind: "provider.turn.interrupted-for-pause",
            summary: "Agent run stopped before workspace pause",
            payload: { detail: MANAGED_DEVPC_DRAIN_DETAIL },
            turnId: activeTurnId,
            createdAt,
          },
          createdAt,
        });
      }),
    { concurrency: 1 },
  );

  return HttpServerResponse.jsonUnsafe(
    { drained: true, terminalizedRuns: targets.length },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
});

export const managedDevPcDrainRouteLayer = HttpRouter.add(
  "POST",
  MANAGED_DEVPC_DRAIN_PATH,
  handleManagedDevPcDrain,
);
