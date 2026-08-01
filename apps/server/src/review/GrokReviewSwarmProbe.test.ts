/**
 * Optional integration check for a complete, minimal real-model swarm.
 * Enable with:
 * T3_GROK_REVIEW_SWARM_PROBE=1 pnpm exec vp test run apps/server/src/review/GrokReviewSwarmProbe.test.ts
 *
 * This performs at least five Grok 4.5 calls (four leads plus one verifier),
 * with up to three bounded follow-up calls when the coordinator requests them.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { GrokReviewReport, GrokSettings, ReviewDiffPreviewSource } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect } from "vite-plus/test";

import { makeGrokReviewAgent } from "./GrokReviewAgent.ts";
import { runGrokReviewSwarm } from "./GrokReviewSwarm.ts";

const decodeGrokSettings = Schema.decodeSync(GrokSettings);
const decodeSource = Schema.decodeSync(ReviewDiffPreviewSource);
const isReport = Schema.is(GrokReviewReport);

describe.runIf(process.env.T3_GROK_REVIEW_SWARM_PROBE === "1")("Grok review swarm probe", () => {
  it.effect(
    "produces the canonical report with a real bounded swarm",
    () =>
      Effect.gen(function* () {
        const agent = yield* makeGrokReviewAgent(decodeGrokSettings({ binaryPath: "grok" }));
        const report = yield* runGrokReviewSwarm({
          request: {
            cwd: process.cwd(),
            target: "working-tree",
            focus: ["Confirm the structured-output probe is safe and deterministic."],
          },
          source: decodeSource({
            id: "probe",
            kind: "working-tree",
            title: "Minimal Grok review integration probe",
            baseRef: null,
            headRef: null,
            diffHash: "probe-diff",
            truncated: false,
            diff: [
              "diff --git a/apps/server/src/review/GrokReviewCliProbe.test.ts b/apps/server/src/review/GrokReviewCliProbe.test.ts",
              "--- a/apps/server/src/review/GrokReviewCliProbe.test.ts",
              "+++ b/apps/server/src/review/GrokReviewCliProbe.test.ts",
              "@@ -17,0 +18,1 @@",
              "+const ProbeOutput = Schema.Struct({ ok: Schema.Literal(true), message: Schema.String });",
            ].join("\n"),
          }),
          agent,
        });

        expect(isReport(report)).toBe(true);
        expect(report.resolvedModel).toBe("grok-4.5");
        expect(report.reasoningEffort).toBe("medium");
        expect(report.usage.agentRuns).toBeGreaterThanOrEqual(5);
        expect(report.usage.agentRuns).toBeLessThanOrEqual(8);
        expect(report.markdown).toContain("## Aldo Review");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    10 * 60_000,
  );
});
