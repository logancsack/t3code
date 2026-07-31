import { describe, expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type GrokReviewInput,
  type GrokReviewReport,
  type ReviewDiffPreviewSource,
  type ReviewDiffPreviewResult,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import * as GrokReviewService from "./GrokReviewService.ts";
import * as ReviewService from "./ReviewService.ts";

const preview: ReviewDiffPreviewResult = {
  cwd: "/workspace/project",
  generatedAt: DateTime.nowUnsafe(),
  sources: [
    {
      id: "working-tree",
      kind: "working-tree",
      title: "Dirty worktree",
      baseRef: "HEAD",
      headRef: null,
      diff: "+changed",
      diffHash: "working-hash",
      truncated: false,
    },
    {
      id: "branch-range",
      kind: "branch-range",
      title: "Against main",
      baseRef: "main",
      headRef: "feature",
      diff: "+branch",
      diffHash: "branch-hash",
      truncated: false,
    },
  ],
};

const report: GrokReviewReport = {
  schemaVersion: 1,
  runId: "review-run",
  target: {
    kind: "working-tree",
    baseRef: "HEAD",
    headRef: null,
    diffHash: "working-hash",
  },
  status: "pass",
  resolvedModel: "grok-4.5",
  grokBuildVersion: "0.2.112",
  reasoningEffort: "medium",
  escalatedToHigh: false,
  summary: "No actionable findings.",
  findings: [],
  coverage: ["Diff"],
  limitations: [],
  usage: { agentRuns: 5, mediumEffortRuns: 5, highEffortRuns: 0 },
  markdown: "## Aldo Grok review",
};

function makeLayer(instances: ReadonlyArray<ProviderInstance>) {
  return GrokReviewService.layer.pipe(
    Layer.provide(
      Layer.mock(ReviewService.ReviewService)({
        getDiffPreview: () => Effect.succeed(preview),
      }),
    ),
    Layer.provide(
      Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
        getInstance: (instanceId) =>
          Effect.succeed(instances.find((instance) => instance.instanceId === instanceId)),
        listInstances: Effect.succeed(instances),
      }),
    ),
  );
}

describe("GrokReviewService", () => {
  it.effect("selects the dirty worktree and routes through an enabled Grok instance", () => {
    const received: Array<string> = [];
    const instance = {
      instanceId: ProviderInstanceId.make("grok-work"),
      driverKind: ProviderDriverKind.make("grok"),
      enabled: true,
      codeReview: {
        run: ({
          source,
        }: {
          readonly request: GrokReviewInput;
          readonly source: ReviewDiffPreviewSource;
        }) =>
          Effect.sync(() => {
            received.push(source.diffHash);
            return report;
          }),
      },
    } as unknown as ProviderInstance;

    return Effect.gen(function* () {
      const service = yield* GrokReviewService.GrokReviewService;
      const result = yield* service.run({ cwd: preview.cwd });
      expect(result.runId).toBe("review-run");
      expect(received).toEqual(["working-hash"]);
    }).pipe(Effect.provide(makeLayer([instance])));
  });

  it.effect("fails clearly when no Grok provider is connected", () =>
    Effect.gen(function* () {
      const service = yield* GrokReviewService.GrokReviewService;
      const error = yield* service.run({ cwd: preview.cwd }).pipe(Effect.flip);
      expect(error._tag).toBe("GrokReviewError");
      expect(error.message).toContain("No enabled Grok Build provider");
    }).pipe(Effect.provide(makeLayer([]))),
  );
});
