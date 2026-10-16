import { TextGenerationError } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { normalizeCliError } from "./TextGenerationUtils.ts";

it("keeps CLI credentials out of the public text-generation error", () => {
  const cause = new Error("request failed with access_token=private-regression-token");
  const fallback = "Failed to generate a commit message";
  const result = normalizeCliError("codex", "generateCommitMessage", cause, fallback);
  expect(result).toBeInstanceOf(TextGenerationError);
  expect(result.detail).toBe(fallback);
  expect(result.message).not.toContain("private-regression-token");
});
