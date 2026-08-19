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
    Effect.flatMap(dispatchCommand),
    Effect.match({
      onFailure: (error) =>
        HttpServerResponse.jsonUnsafe(
          { error: { code: "INVALID_DISPATCH", message: error.message } },
          { status: 400, headers: { "cache-control": "no-store" } },
        ),
      onSuccess: (receipt) =>
        HttpServerResponse.jsonUnsafe(receipt, {
          status: 202,
          headers: { "cache-control": "no-store" },
        }),
    }),
  );
});

export const managedDevPcDispatchRouteLayer = HttpRouter.add(
  "POST",
  MANAGED_DEVPC_DISPATCH_PATH,
  handleManagedDevPcDispatch,
);
