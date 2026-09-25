/**
 * RunnerDelivery - starts runner event delivery once hub ingestion runs, and
 * acknowledges delivered events only after ingestion has drained them.
 *
 * Prototype semantics: at-least-once across hub restarts with a window of one
 * ack interval (an event ingested but not yet acked is re-delivered after a
 * crash). Production should persist the runner cursor in the same database
 * transaction as the projection writes the event produced.
 *
 * @module runner/hub/RunnerDelivery
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProviderRuntimeIngestionService } from "../../orchestration/Services/ProviderRuntimeIngestion.ts";
import { forkParked } from "../../serverActivation.ts";
import { RunnerClient } from "./RunnerClient.ts";

const ACK_INTERVAL = "500 millis";

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const runner = yield* RunnerClient;
    if (!runner.enabled) return;
    const ingestion = yield* ProviderRuntimeIngestionService;
    yield* forkParked(
      Effect.gen(function* () {
        // Ingestion's stream consumers are parked at the same activation
        // gate; give them a moment to subscribe before replay starts.
        yield* Effect.sleep("500 millis");
        yield* runner.startDelivery;
        return yield* Effect.gen(function* () {
          const { deliveredSequence, ackedSequence } = yield* runner.deliveryState;
          if (deliveredSequence <= ackedSequence) return;
          // Two async hops separate delivery from the ingestion queue
          // (adapter stream -> ProviderService PubSub -> ingestion worker).
          yield* Effect.sleep("50 millis");
          yield* ingestion.drain;
          yield* runner.ackDelivered(deliveredSequence);
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("runner delivery ack failed", { cause: String(cause) }),
          ),
          Effect.andThen(Effect.sleep(ACK_INTERVAL)),
          Effect.forever,
        );
      }),
    );
  }),
);
