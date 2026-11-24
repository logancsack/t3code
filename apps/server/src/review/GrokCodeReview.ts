import type { GrokSettings } from "@t3tools/provider-grok/settings";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";

import type { CodeReviewRunner } from "@t3tools/provider-core/server/codeReview";
import { makeGrokReviewAgent } from "./GrokReviewAgent.ts";
import { runGrokReviewSwarm } from "./GrokReviewSwarm.ts";

export const makeGrokCodeReview = Effect.fn("makeGrokCodeReview")(function* (
  grokSettings: GrokSettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const digest = yield* Digest.Digest;
  const random = yield* SecureRandom.SecureRandom;
  const agent = yield* makeGrokReviewAgent(grokSettings, environment);
  return {
    run: (input) =>
      runGrokReviewSwarm({ ...input, agent }).pipe(
        Effect.provideService(Digest.Digest, digest),
        Effect.provideService(SecureRandom.SecureRandom, random),
      ),
  } satisfies CodeReviewRunner;
});
