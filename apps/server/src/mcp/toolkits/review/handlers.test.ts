import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  type GrokReviewReport,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as GrokReviewService from "../../../review/GrokReviewService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as ReviewHandlers from "./handlers.ts";
import { ReviewToolkit } from "./tools.ts";

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

const caller = {
  environmentId: EnvironmentId.make("environment:review"),
  requestNamespace: "provider:review",
  thread: {
    threadId: ThreadId.make("thread:review"),
    providerSessionId: "provider:review",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(["orchestration" as const]),
  issuedAt: 0,
};

const review = (
  name: "aldo_review" | "grok_review",
  scope: McpInvocationContext.McpInvocationScope,
) =>
  Effect.gen(function* () {
    const toolkit = yield* ReviewToolkit;
    return yield* toolkit.handle(name, { cwd: "/workspace/project", target: "working-tree" }).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map((parts) => parts.at(-1)?.result),
    );
  }).pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(ReviewHandlers.layer).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            Layer.succeed(McpInvocationContext.McpInvocationContext, scope),
            Layer.mock(GrokReviewService.GrokReviewService)({
              run: () => Effect.succeed(report),
            }),
          ),
        ),
      ),
    ),
  );

it.effect("both review tools return the canonical report to a thread's agent only", () =>
  Effect.gen(function* () {
    expect(yield* review("aldo_review", caller)).toEqual(report);
    expect(yield* review("grok_review", caller)).toEqual(report);
    expect(
      yield* Effect.flip(review("aldo_review", { ...caller, thread: undefined })),
    ).toMatchObject({ code: "thread_credential_required" });
  }),
);
