/**
 * `/api/_devpc/*`: how Aldo's control plane and the coordinator beside the server reach a managed
 * workspace. Every route answers 404 unless the server is managed and the caller holds the
 * gateway token, so the routes do not exist for anyone else.
 */
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as ServerConfig from "../config.ts";
import { managedGatewayTokenMatches } from "../managedGatewayToken.ts";
import { LegacyCommand } from "./legacyCommands.ts";
import * as ManagedDevPc from "./ManagedDevPc.ts";

const GATEWAY_HEADER = "x-devpc-gateway-token";
/** Turns a coordinator read answers with when it names no window. */
const DEFAULT_TURN_LIMIT = 3;

const noStore = { "cache-control": "no-store" };
const noStorePrivate = { "cache-control": "no-store, private" };
// Tells Aldo this gateway honours turnLimit and beforeCursor; a generation-1 machine ignores both.
const paged = { ...noStorePrivate, "x-devpc-paged": "1" };

const decodeThreadId = Schema.decodeUnknownOption(ThreadId);
const decodeCommand = Schema.decodeUnknownEffect(LegacyCommand);

const positiveInt = (value: string | null) => {
  if (value === null) return Option.some(undefined);
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Option.some(parsed) : Option.none();
};

const coded = (status: number, code: string, message: string) =>
  HttpServerResponse.jsonUnsafe({ error: { code, message } }, { status, headers: noStore });

const plain = (status: number, error: string) =>
  HttpServerResponse.jsonUnsafe({ error }, { status, headers: noStorePrivate });

/** The request of a caller holding the gateway token; none for anyone else. */
const authorized = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const config = yield* ServerConfig.ServerConfig;
  return config.managedDevPc &&
    managedGatewayTokenMatches(request.headers[GATEWAY_HEADER], config.managedGatewayToken)
    ? Option.some(request)
    : Option.none();
});

const gated = <E, R>(
  notFound: HttpServerResponse.HttpServerResponse,
  handler: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) =>
  authorized.pipe(
    Effect.flatMap(
      Option.match({
        onNone: (): Effect.Effect<HttpServerResponse.HttpServerResponse, E, R> =>
          Effect.succeed(notFound),
        onSome: handler,
      }),
    ),
  );

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const managed = yield* ManagedDevPc.ManagedDevPc;

    const activity = gated(coded(404, "NOT_FOUND", "Activity route not found."), () =>
      managed.activity.pipe(
        Effect.match({
          onFailure: () => coded(503, "ACTIVITY_UNAVAILABLE", "Activity is unavailable."),
          onSuccess: (body) => HttpServerResponse.jsonUnsafe(body, { headers: noStore }),
        }),
      ),
    );

    const drain = gated(coded(404, "NOT_FOUND", "Drain route not found."), () =>
      managed.drain.pipe(
        Effect.match({
          onFailure: () => coded(503, "DRAIN_UNAVAILABLE", "Drain is unavailable."),
          onSuccess: (body) => HttpServerResponse.jsonUnsafe(body, { headers: noStore }),
        }),
      ),
    );

    const dispatch = gated(coded(404, "NOT_FOUND", "Dispatch route not found."), (request) =>
      request.json.pipe(
        Effect.flatMap(decodeCommand),
        Effect.matchEffect({
          onFailure: (error) => Effect.succeed(coded(400, "INVALID_DISPATCH", error.message)),
          onSuccess: (command) =>
            managed.dispatch(command).pipe(
              Effect.match({
                onFailure: (error) =>
                  error.refused
                    ? coded(400, "INVALID_DISPATCH", error.detail)
                    : coded(503, "DISPATCH_UNAVAILABLE", error.detail),
                onSuccess: (receipt) =>
                  HttpServerResponse.jsonUnsafe(receipt, { status: 202, headers: noStore }),
              }),
            ),
        }),
      ),
    );

    const snapshot = gated(plain(404, "Not found"), (request) => {
      const query = new URL(request.url, "http://localhost").searchParams;
      const rawThreadId = query.get("threadId");
      if (rawThreadId === null) {
        return managed.shellSnapshot.pipe(
          Effect.match({
            onFailure: () => plain(503, "Unavailable"),
            onSuccess: (body) => HttpServerResponse.jsonUnsafe(body, { headers: noStorePrivate }),
          }),
        );
      }
      const threadId = decodeThreadId(rawThreadId);
      const turnLimit = positiveInt(query.get("turnLimit"));
      const beforeCursor = positiveInt(query.get("beforeCursor"));
      if (Option.isNone(threadId)) return Effect.succeed(plain(400, "Invalid thread"));
      if (Option.isNone(turnLimit) || Option.isNone(beforeCursor)) {
        return Effect.succeed(plain(400, "Invalid page"));
      }
      return managed
        .threadSnapshot(threadId.value, {
          turnLimit: turnLimit.value ?? DEFAULT_TURN_LIMIT,
          beforeCursor: beforeCursor.value,
        })
        .pipe(
          Effect.match({
            onFailure: () => plain(503, "Unavailable"),
            onSuccess: Option.match({
              onNone: () => plain(404, "Not found"),
              onSome: ({ snapshotSequence, thread, page }) =>
                HttpServerResponse.jsonUnsafe(
                  {
                    snapshotSequence,
                    thread,
                    ...(page === undefined ? {} : { page: { ...page, snapshotSequence } }),
                  },
                  { headers: paged },
                ),
            }),
          }),
        );
    });

    const providers = gated(plain(404, "Not found"), () =>
      managed.providers.pipe(
        Effect.map((body) => HttpServerResponse.jsonUnsafe(body, { headers: noStorePrivate })),
      ),
    );

    return Layer.mergeAll(
      HttpRouter.add("GET", "/api/_devpc/activity", activity),
      HttpRouter.add("POST", "/api/_devpc/drain", drain),
      HttpRouter.add("POST", "/api/_devpc/dispatch", dispatch),
      HttpRouter.add("GET", "/api/_devpc/agent/snapshot", snapshot),
      HttpRouter.add("GET", "/api/_devpc/agent/providers", providers),
    );
  }),
);
