import type { GrokSettings } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";

import type { CodeReviewRunner } from "./CodeReviewRunner.ts";
import { makeGrokReviewAgent } from "./GrokReviewAgent.ts";
import { runGrokReviewSwarm } from "./GrokReviewSwarm.ts";

export const makeGrokCodeReview = Effect.fn("makeGrokCodeReview")(function* (
  grokSettings: GrokSettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const crypto = yield* Crypto.Crypto;
  const agent = yield* makeGrokReviewAgent(grokSettings, environment);
  return {
    run: (input) =>
      runGrokReviewSwarm({ ...input, agent }).pipe(Effect.provideService(Crypto.Crypto, crypto)),
  } satisfies CodeReviewRunner;
});
