// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

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
  markdown: "## Aldo Review",
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
  it("prefers the stable Nemotron slug and falls back to the live free variant", () => {
    expect(
      GrokReviewService.selectOpenWeightReviewModel([
        { slug: "opencode/nemotron-3-ultra-free" },
        { slug: "opencode/nemotron-3-ultra" },
      ]),
    ).toBe("opencode/nemotron-3-ultra");
    expect(
      GrokReviewService.selectOpenWeightReviewModel([{ slug: "opencode/nemotron-3-ultra-free" }]),
    ).toBe("opencode/nemotron-3-ultra-free");
  });

  it.effect("provides the authenticated OpenCode Nemotron agent to the primary runner", () => {
    const supplementalModels: Array<string | undefined> = [];
    const primary = {
      instanceId: ProviderInstanceId.make("grok-work"),
      driverKind: ProviderDriverKind.make("grok"),
      enabled: true,
      snapshot: {
        getSnapshot: Effect.succeed({
          installed: true,
          status: "ready",
          auth: { status: "authenticated" },
        }),
      },
      codeReview: {
        run: (input: { readonly supplementalAgent?: { readonly resolvedModel: string } }) =>
          Effect.sync(() => {
            supplementalModels.push(input.supplementalAgent?.resolvedModel);
            return report;
          }),
      },
    } as unknown as ProviderInstance;
    const opencode = {
      instanceId: ProviderInstanceId.make("opencode"),
      driverKind: ProviderDriverKind.make("opencode"),
      enabled: true,
      snapshot: {
        getSnapshot: Effect.succeed({
          installed: true,
          status: "ready",
          auth: { status: "authenticated" },
          displayName: "OpenCode",
          models: [
            {
              slug: "opencode/nemotron-3-ultra-free",
              name: "Nemotron 3 Ultra Free",
              isCustom: false,
              isDefault: false,
              capabilities: null,
            },
          ],
        }),
      },
      textGeneration: { generateStructured: () => Effect.die("not run by this test") },
    } as unknown as ProviderInstance;

    return Effect.gen(function* () {
      const service = yield* GrokReviewService.GrokReviewService;
      yield* service.run({ cwd: preview.cwd });
      expect(supplementalModels).toEqual(["opencode/nemotron-3-ultra-free"]);
    }).pipe(Effect.provide(makeLayer([primary, opencode])));
  });

  it.effect("selects the dirty worktree and routes through an enabled Grok instance", () => {
    const received: Array<string> = [];
    const instance = {
      instanceId: ProviderInstanceId.make("grok-work"),
      driverKind: ProviderDriverKind.make("grok"),
      enabled: true,
      snapshot: {
        getSnapshot: Effect.succeed({
          installed: true,
          status: "ready",
          auth: { status: "authenticated" },
        }),
      },
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
    const unhealthy = {
      ...instance,
      instanceId: ProviderInstanceId.make("grok-broken"),
      snapshot: {
        getSnapshot: Effect.succeed({
          installed: true,
          status: "error",
          auth: { status: "unknown" },
        }),
      },
      codeReview: { run: () => Effect.die("unhealthy instance selected") },
    } as unknown as ProviderInstance;

    return Effect.gen(function* () {
      const service = yield* GrokReviewService.GrokReviewService;
      const result = yield* service.run({ cwd: preview.cwd });
      expect(result.runId).toBe("review-run");
      expect(received).toEqual(["working-hash"]);
    }).pipe(Effect.provide(makeLayer([unhealthy, instance])));
  });

  it.effect("fails clearly when no Grok provider is connected", () =>
    Effect.gen(function* () {
      const service = yield* GrokReviewService.GrokReviewService;
      const error = yield* service.run({ cwd: preview.cwd }).pipe(Effect.flip);
      expect(error._tag).toBe("GrokReviewError");
      expect(error.message).toContain("selected Aldo Review provider is not connected");
    }).pipe(Effect.provide(makeLayer([]))),
  );

  it.effect("routes an explicit connected provider and model through the shared swarm", () => {
    let agentRuns = 0;
    const reviewDirectories: Array<string> = [];
    const instance = {
      instanceId: ProviderInstanceId.make("codex-work"),
      driverKind: ProviderDriverKind.make("codex"),
      enabled: true,
      snapshot: {
        getSnapshot: Effect.succeed({
          installed: true,
          status: "ready",
          auth: { status: "authenticated" },
          displayName: "Codex Work",
          models: [
            {
              slug: "gpt-5.6-sol",
              name: "GPT-5.6 Sol",
              isCustom: false,
              isDefault: true,
              capabilities: null,
            },
          ],
        }),
      },
      textGeneration: {
        generateStructured: (input: { cwd: string; prompt: string }) =>
          Effect.sync(() => {
            agentRuns += 1;
            reviewDirectories.push(input.cwd);
            return input.prompt.includes("verifier")
              ? {
                  summary: "No actionable findings.",
                  findings: [],
                  coverage: ["Diff"],
                  limitations: [],
                  needsHighEffortReview: false,
                }
              : {
                  summary: "No actionable findings.",
                  findings: [],
                  coverage: ["Diff"],
                  limitations: [],
                  delegation: null,
                };
          }),
      },
    } as unknown as ProviderInstance;

    const unrelated = {
      ...instance,
      instanceId: ProviderInstanceId.make("unrelated-provider"),
      driverKind: ProviderDriverKind.make("opencode"),
      snapshot: {
        getSnapshot: Effect.die("explicit selection should not snapshot unrelated providers"),
      },
    } as unknown as ProviderInstance;

    return Effect.gen(function* () {
      const service = yield* GrokReviewService.GrokReviewService;
      const result = yield* service.run({
        cwd: preview.cwd,
        providerInstanceId: instance.instanceId,
        model: "gpt-5.6-sol",
      });
      expect(result.resolvedModel).toBe("gpt-5.6-sol");
      expect(result.markdown).toContain("## Aldo Review");
      expect(agentRuns).toBe(5);
      expect(new Set(reviewDirectories).size).toBe(1);
      expect(reviewDirectories[0]).not.toBe(preview.cwd);
      expect(NodeFS.existsSync(reviewDirectories[0]!)).toBe(false);
    }).pipe(Effect.provide(makeLayer([unrelated, instance])));
  });
});
