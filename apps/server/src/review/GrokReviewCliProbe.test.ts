// Optional check of the headless CLI surface the swarm uses: one Grok 4.5 request, needing
// `grok login` or XAI_API_KEY. Enable with:
// T3_GROK_REVIEW_PROBE=1 vp test run src/review/GrokReviewCliProbe.test.ts
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { GrokSettings } from "@t3tools/provider-grok/settings";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect } from "vite-plus/test";

import { makeGrokReviewAgent } from "./GrokReviewAgent.ts";

const ProbeOutput = Schema.Struct({
  ok: Schema.Literal(true),
  message: Schema.String,
});
const decodeGrokSettings = Schema.decodeSync(GrokSettings);

describe.runIf(process.env.T3_GROK_REVIEW_PROBE === "1")("Grok review CLI probe", () => {
  it.effect(
    "returns schema-constrained output from Grok 4.5 at medium effort",
    () =>
      Effect.gen(function* () {
        const agent = yield* makeGrokReviewAgent(decodeGrokSettings({ binaryPath: "grok" }));
        const output = yield* agent.run({
          cwd: process.cwd(),
          prompt:
            'This is a transport probe, not a code review. Return {"ok":true,"message":"ready"} exactly through the required structured output.',
          outputSchema: ProbeOutput,
          effort: "medium",
        });

        expect(output.ok).toBe(true);
        expect(output.message.length).toBeGreaterThan(0);
        expect(agent.resolvedModel).toBe("grok-4.5");
        expect(agent.grokBuildVersion).not.toBeNull();
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    5 * 60_000,
  );
});
