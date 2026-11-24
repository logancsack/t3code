// Optional real-model swarm check, five to eight Grok 4.5 calls. Enable with:
// T3_GROK_REVIEW_SWARM_PROBE=1 vp test run src/review/GrokReviewSwarmProbe.test.ts
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { GrokReviewReport } from "@t3tools/contracts";
import { GrokSettings } from "@t3tools/provider-grok/settings";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect } from "vite-plus/test";

import { makeGrokReviewAgent } from "./GrokReviewAgent.ts";
import { runGrokReviewSwarm } from "./GrokReviewSwarm.ts";

const decodeGrokSettings = Schema.decodeSync(GrokSettings);
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
          source: {
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
          },
          agent,
        });

        expect(isReport(report)).toBe(true);
        expect(report.resolvedModel).toBe("grok-4.5");
        expect(report.reasoningEffort).toBe("medium");
        expect(report.usage.agentRuns).toBeGreaterThanOrEqual(5);
        expect(report.usage.agentRuns).toBeLessThanOrEqual(8);
        expect(report.markdown).toContain("## Aldo Review");
      }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
    10 * 60_000,
  );
});
