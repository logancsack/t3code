import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import * as ServerConfig from "./config.ts";
import { managedGatewayTokenMatches } from "./managedDevPcActivity.ts";
import { projectThreadDetailSnapshot } from "./orchestration/ActivityPayloadProjection.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";

const decodeThreadId = Schema.decodeUnknownOption(ThreadId);

/** Workspace-local coordinator reads use the same capability as managed dispatch. */
export const managedDevPcAgentRouteLayer = HttpRouter.add(
  "GET",
  "/api/_devpc/agent/snapshot",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig.ServerConfig;
    const headers = { "cache-control": "no-store, private" };
    if (
      !config.managedDevPc ||
      !managedGatewayTokenMatches(
        request.headers["x-devpc-gateway-token"],
        config.managedGatewayToken,
      )
    ) {
      return HttpServerResponse.jsonUnsafe({ error: "Not found" }, { status: 404, headers });
    }
    const snapshots = yield* ProjectionSnapshotQuery;
    const threadId = new URL(request.url, "http://localhost").searchParams.get("threadId");
    if (threadId !== null) {
      const decoded = decodeThreadId(threadId);
      if (Option.isNone(decoded)) {
        return HttpServerResponse.jsonUnsafe({ error: "Invalid thread" }, { status: 400, headers });
      }
      return yield* snapshots.getThreadDetailSnapshot(decoded.value, { turnLimit: 3 }).pipe(
        Effect.match({
          onFailure: () =>
            HttpServerResponse.jsonUnsafe({ error: "Unavailable" }, { status: 503, headers }),
          onSuccess: (snapshot) =>
            Option.isSome(snapshot)
              ? HttpServerResponse.jsonUnsafe(projectThreadDetailSnapshot(snapshot.value), {
                  headers,
                })
              : HttpServerResponse.jsonUnsafe({ error: "Not found" }, { status: 404, headers }),
        }),
      );
    }
    return yield* snapshots.getShellSnapshot().pipe(
      Effect.match({
        onFailure: () =>
          HttpServerResponse.jsonUnsafe({ error: "Unavailable" }, { status: 503, headers }),
        onSuccess: (snapshot) => HttpServerResponse.jsonUnsafe(snapshot, { headers }),
      }),
    );
  }),
);
