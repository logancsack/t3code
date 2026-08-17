import * as NodeCrypto from "node:crypto";

import type { OrchestrationThreadShell } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import * as ServerConfig from "./config.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import { hasRunningPrimeAgentSubagents } from "./provider/PrimeAgentActivity.ts";

export const MANAGED_DEVPC_ACTIVITY_PATH = "/api/_devpc/activity";
const MANAGED_GATEWAY_HEADER = "x-devpc-gateway-token";

export function managedGatewayTokenMatches(
  actual: string | undefined,
  expected: string | undefined,
): boolean {
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
      thread.session?.status === "running" &&
      thread.session.activeTurnId === thread.latestTurn.turnId &&
      !thread.hasPendingApprovals &&
      !thread.hasPendingUserInput &&
      !thread.hasActionableProposedPlan,
  );
}

/** Client timestamps may be slightly ahead of the server, but not arbitrarily so. */
export const QUEUED_TURN_START_FUTURE_SKEW_MS = 2 * 60_000;

export function hasQueuedManagedTurnStart(
  threads: ReadonlyArray<OrchestrationThreadShell>,
  nowMs: number,
): boolean {
  return threads.some((thread) => {
    if (thread.session?.status === "error") return false;
    if (thread.latestUserMessageAt === null) return false;
    const messageAtMs = Date.parse(thread.latestUserMessageAt);
    if (!Number.isFinite(messageAtMs)) return false;
    const latestTurnAtMs =
      thread.latestTurn === null
        ? Number.NEGATIVE_INFINITY
        : Math.max(
            ...[
              thread.latestTurn.requestedAt,
              thread.latestTurn.startedAt,
              thread.latestTurn.completedAt,
            ].map((candidate) =>
              candidate == null ? Number.NEGATIVE_INFINITY : Date.parse(candidate),
            ),
          );
    // An accepted message remains work until a concrete turn adopts it or a
    // durable terminal session error rejects it. Aging it out made an orphaned
    // start look idle while the UI correctly retained the pending request.
    return messageAtMs > latestTurnAtMs && messageAtMs <= nowMs + QUEUED_TURN_START_FUTURE_SKEW_MS;
  });
}

/** A provider session mid-boot is about to run a turn; that is agent work too. */
export function hasStartingManagedSession(
  threads: ReadonlyArray<OrchestrationThreadShell>,
): boolean {
  return threads.some((thread) => thread.session?.status === "starting");
}

/**
 * Work that exists but is blocked on the human: pause-safe (the workspace may
 * idle out while an approval waits), yet worth surfacing so the platform can
 * distinguish "nothing to do" from "waiting on the user".
 */
export function hasPendingManagedWork(threads: ReadonlyArray<OrchestrationThreadShell>): boolean {
  return threads.some(
    (thread) =>
      thread.hasPendingApprovals || thread.hasPendingUserInput || thread.hasActionableProposedPlan,
  );
}

const handleManagedDevPcActivity = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const config = yield* ServerConfig.ServerConfig;
  if (
    !config.managedDevPc ||
    !managedGatewayTokenMatches(request.headers[MANAGED_GATEWAY_HEADER], config.managedGatewayToken)
  ) {
    return HttpServerResponse.jsonUnsafe(
      { error: { code: "NOT_FOUND", message: "Activity route not found." } },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  const snapshots = yield* ProjectionSnapshotQuery;
  const nowMs = yield* Clock.currentTimeMillis;
  return yield* snapshots.getShellSnapshot().pipe(
    Effect.match({
      onFailure: () =>
        HttpServerResponse.jsonUnsafe(
          { error: { code: "ACTIVITY_UNAVAILABLE", message: "Activity is unavailable." } },
          { status: 503, headers: { "cache-control": "no-store" } },
        ),
      onSuccess: (snapshot) => {
        // `active` keeps its original meaning (a genuinely running turn) so
        // control planes reading only that field see unchanged behavior.
        // `working` widens it with imminent work — a queued turn start or a
        // booting session — which must hold a work claim before the turn's
        // running state lands. `pendingWork` is human-blocked work: pause-safe
        // but not "idle".
        const active = hasRunningManagedTurn(snapshot.threads) || hasRunningPrimeAgentSubagents();
        return HttpServerResponse.jsonUnsafe(
          {
            active,
            working:
              active ||
              hasQueuedManagedTurnStart(snapshot.threads, nowMs) ||
              hasStartingManagedSession(snapshot.threads),
            pendingWork: hasPendingManagedWork(snapshot.threads),
          },
          { status: 200, headers: { "cache-control": "no-store" } },
        );
      },
    }),
  );
});

export const managedDevPcActivityRouteLayer = HttpRouter.add(
  "GET",
  MANAGED_DEVPC_ACTIVITY_PATH,
  handleManagedDevPcActivity,
);
