import {
  GrokReviewInput,
  GrokReviewReport,
  GrokReviewRunError,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import { McpSchema, Tool, Toolkit } from "effect/ai";
import * as Schema from "effect/Schema";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as GrokReviewService from "../../../review/GrokReviewService.ts";

const ReviewToolFailure = Schema.Union([GrokReviewRunError, OrchestratorMcpFailure]);
const dependencies = [
  McpInvocationContext.McpInvocationContext,
  GrokReviewService.GrokReviewService,
];

const AldoReviewTool = Tool.make("aldo_review", {
  description:
    "Run Aldo's bounded multi-agent review swarm with a connected provider and model. The swarm uses medium reasoning by default, escalates ambiguous severe findings to high reasoning when supported, and returns the same canonical report used for pull-request reviews.",
  parameters: GrokReviewInput,
  success: GrokReviewReport,
  failure: ReviewToolFailure,
  dependencies,
})
  .annotate(Tool.Title, "Run Aldo Review swarm")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const GrokReviewTool = Tool.make("grok_review", {
  description:
    "Backward-compatible alias for aldo_review. Run Aldo's multi-agent code-review swarm.",
  parameters: GrokReviewInput,
  success: GrokReviewReport,
  failure: ReviewToolFailure,
  dependencies,
})
  .annotate(Tool.Title, "Run Aldo Review swarm")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const ReviewToolkit = Toolkit.make(AldoReviewTool, GrokReviewTool);
