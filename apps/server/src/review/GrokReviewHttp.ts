import * as NodeCrypto from "node:crypto";

import { GrokReviewInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import * as ServerConfig from "../config.ts";
import * as GrokReviewService from "./GrokReviewService.ts";

export const GROK_REVIEW_HTTP_PATH = "/api/review/grok";
const MANAGED_REVIEW_HEADER = "x-devpc-review-token";

export function managedReviewTokenMatches(
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

export const grokReviewHttpRouteLayer = HttpRouter.add(
  "POST",
  GROK_REVIEW_HTTP_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig.ServerConfig;
    if (
      !config.managedDevPc ||
      !managedReviewTokenMatches(request.headers[MANAGED_REVIEW_HEADER], config.managedGatewayToken)
    ) {
      return HttpServerResponse.jsonUnsafe(
        { error: { code: "NOT_FOUND", message: "Review route not found." } },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    }

    const decoded = yield* request.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(GrokReviewInput)),
      Effect.match({
        onFailure: () => undefined,
        onSuccess: (input) => input,
      }),
    );
    if (!decoded) {
      return HttpServerResponse.jsonUnsafe(
        { error: { code: "INVALID_REQUEST", message: "The review request was not valid." } },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }

    const reviews = yield* GrokReviewService.GrokReviewService;
    return yield* reviews.run(decoded).pipe(
      Effect.match({
        onFailure: (error) =>
          HttpServerResponse.jsonUnsafe(
            {
              error: {
                code: "_tag" in error ? error._tag : "GrokReviewError",
                message: error.message,
              },
            },
            { status: 422, headers: { "cache-control": "no-store" } },
          ),
        onSuccess: (report) =>
          HttpServerResponse.jsonUnsafe(report, {
            status: 200,
            headers: { "cache-control": "no-store" },
          }),
      }),
    );
  }),
);
