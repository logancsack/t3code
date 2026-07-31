import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type GrokReviewReport,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as GrokReviewService from "../../../review/GrokReviewService.ts";
import { GrokReviewToolkitHandlersLive } from "./handlers.ts";
import { GrokReviewToolkit } from "./tools.ts";

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

const invocation = {
  environmentId: EnvironmentId.make("environment-review-test"),
  threadId: ThreadId.make("thread-review-test"),
  providerSessionId: "provider-session-review-test",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(["review"] as const),
  issuedAt: 1,
  expiresAt: Number.MAX_SAFE_INTEGER,
};

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  initializePayload: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "mcp-review-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

const TestLayer = McpServer.toolkit(GrokReviewToolkit).pipe(
  Layer.provide(GrokReviewToolkitHandlersLive),
  Layer.provideMerge(McpServer.McpServer.layer),
  Layer.provide(
    Layer.mock(GrokReviewService.GrokReviewService)({
      run: () => Effect.succeed(report),
    }),
  ),
);

it.effect("registers a read-only grok_review tool and returns the canonical report", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const registered = server.tools.find(({ tool }) => tool.name === "grok_review");
    expect(registered?.tool.annotations?.readOnlyHint).toBe(true);
    expect(registered?.tool.annotations?.destructiveHint).toBe(false);

    const result = yield* server
      .callTool({
        name: "grok_review",
        arguments: { cwd: "/workspace/project", target: "working-tree" },
      })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
        Effect.provideService(McpSchema.McpServerClient, client),
      );

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      runId: "review-run",
      resolvedModel: "grok-4.5",
      reasoningEffort: "medium",
    });
  }).pipe(Effect.provide(TestLayer)),
);
