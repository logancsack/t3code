import { GrokReviewInput, GrokReviewReport, GrokReviewRunError } from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as GrokReviewService from "../../../review/GrokReviewService.ts";

export const GrokReviewTool = Tool.make("grok_review", {
  description:
    "Run Aldo's bounded Grok 4.5 review swarm against a working tree or branch range. The swarm uses medium reasoning by default, escalates ambiguous severe findings to high reasoning, and returns the same canonical report used for pull-request reviews.",
  parameters: GrokReviewInput,
  success: GrokReviewReport,
  failure: GrokReviewRunError,
  dependencies: [McpInvocationContext.McpInvocationContext, GrokReviewService.GrokReviewService],
})
  .annotate(Tool.Title, "Run Grok review swarm")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const GrokReviewToolkit = Toolkit.make(GrokReviewTool);
