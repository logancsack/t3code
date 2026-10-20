import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveContextWindowModelDisplayName } from "./ContextWindowMeter.logic";

const claude = ProviderInstanceId.make("claudeAgent");
const options = new Map([
  [claude, [{ slug: "claude-opus-5-5", name: "Claude Opus 5.5", shortName: "Opus 5.5" }]],
]);

describe("resolveContextWindowModelDisplayName", () => {
  it("names a listed model by its short name", () => {
    expect(
      resolveContextWindowModelDisplayName(
        { instanceId: claude, model: "claude-opus-5-5" },
        options,
      ),
    ).toBe("Opus 5.5");
  });

  it("shows an unlisted model's id, or what the caller names it", () => {
    const selection = { instanceId: claude, model: "claude-opus-6-0" };
    expect(resolveContextWindowModelDisplayName(selection, options)).toBe("claude-opus-6-0");
    expect(resolveContextWindowModelDisplayName(selection, options, () => "Claude Opus 6")).toBe(
      "Claude Opus 6",
    );
    expect(resolveContextWindowModelDisplayName(null, options)).toBeNull();
  });
});
