import { ClientOrchestrationCommand } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import * as ServerConfig from "./config.ts";
import { managedGatewayTokenMatches } from "./managedDevPcActivity.ts";
import { makeOrchestrationCommandDispatcher } from "./orchestration/CommandDispatcher.ts";
import { normalizeDispatchCommand } from "./orchestration/Normalizer.ts";

export const MANAGED_DEVPC_DISPATCH_PATH = "/api/_devpc/dispatch";
const MANAGED_GATEWAY_HEADER = "x-devpc-gateway-token";

function isPermanentDispatchFailure(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== "object" || current === null || seen.has(current)) continue;
    seen.add(current);
    const tagged = current as { readonly _tag?: unknown };
    if (
      tagged._tag === "OrchestrationCommandInvariantError" ||
      tagged._tag === "OrchestrationCommandPreviouslyRejectedError"
    ) {
      return true;
    }
    for (const value of Object.values(current)) pending.push(value);
  }
  return false;
}

const handleManagedDevPcDispatch = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const config = yield* ServerConfig.ServerConfig;
  if (
    !config.managedDevPc ||
    !managedGatewayTokenMatches(request.headers[MANAGED_GATEWAY_HEADER], config.managedGatewayToken)
  ) {
    return HttpServerResponse.jsonUnsafe(
      { error: { code: "NOT_FOUND", message: "Dispatch route not found." } },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  const dispatchCommand = yield* makeOrchestrationCommandDispatcher;
  return yield* request.json.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(ClientOrchestrationCommand)),
    Effect.flatMap(normalizeDispatchCommand),
    Effect.matchEffect({
      onFailure: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: { code: "INVALID_DISPATCH", message: error.message } },
            { status: 400, headers: { "cache-control": "no-store" } },
          ),
        ),
      onSuccess: (command) =>
        dispatchCommand(command).pipe(
          Effect.match({
            onFailure: (error) => {
              const permanent = isPermanentDispatchFailure(error);
              return HttpServerResponse.jsonUnsafe(
                {
                  error: {
                    code: permanent ? "INVALID_DISPATCH" : "DISPATCH_UNAVAILABLE",
                    message: error.message,
                  },
                },
                {
                  status: permanent ? 400 : 503,
                  headers: { "cache-control": "no-store" },
                },
              );
            },
            onSuccess: (receipt) =>
              HttpServerResponse.jsonUnsafe(receipt, {
                status: 202,
                headers: { "cache-control": "no-store" },
              }),
          }),
        ),
    }),
  );
});

export const managedDevPcDispatchRouteLayer = HttpRouter.add(
  "POST",
  MANAGED_DEVPC_DISPATCH_PATH,
  handleManagedDevPcDispatch,
);
