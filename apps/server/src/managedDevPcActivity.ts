import * as NodeCrypto from "node:crypto";

import type { OrchestrationThreadShell } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import * as ServerConfig from "./config.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";

export const MANAGED_DEVPC_ACTIVITY_PATH = "/api/_devpc/activity";
const MANAGED_GATEWAY_HEADER = "x-devpc-gateway-token";

function tokenMatches(actual: string | undefined, expected: string | undefined): boolean {
  if (!actual || !expected) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    NodeCrypto.timingSafeEqual(actualBytes, expectedBytes)
  );
}

export function hasRunningManagedTurn(threads: ReadonlyArray<OrchestrationThreadShell>): boolean {
  return threads.some(
    (thread) =>
      thread.latestTurn?.state === "running" &&
      !thread.hasPendingApprovals &&
      !thread.hasPendingUserInput &&
      !thread.hasActionableProposedPlan,
  );
}

const handleManagedDevPcActivity = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const config = yield* ServerConfig.ServerConfig;
  if (
    !config.managedDevPc ||
    !tokenMatches(request.headers[MANAGED_GATEWAY_HEADER], config.managedGatewayToken)
  ) {
    return HttpServerResponse.jsonUnsafe(
      { error: { code: "NOT_FOUND", message: "Activity route not found." } },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  const snapshots = yield* ProjectionSnapshotQuery;
  return yield* snapshots.getShellSnapshot().pipe(
    Effect.match({
      onFailure: () =>
        HttpServerResponse.jsonUnsafe(
          { error: { code: "ACTIVITY_UNAVAILABLE", message: "Activity is unavailable." } },
          { status: 503, headers: { "cache-control": "no-store" } },
        ),
      onSuccess: (snapshot) =>
        HttpServerResponse.jsonUnsafe(
          { active: hasRunningManagedTurn(snapshot.threads) },
          { status: 200, headers: { "cache-control": "no-store" } },
        ),
    }),
  );
});

export const managedDevPcActivityRouteLayer = HttpRouter.add(
  "GET",
  MANAGED_DEVPC_ACTIVITY_PATH,
  handleManagedDevPcActivity,
);
