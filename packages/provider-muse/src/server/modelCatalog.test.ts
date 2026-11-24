import { describe, expect, it } from "@effect/vitest";

import {
  museModelCapabilities,
  resolveMuseReasoningEffort,
  withPreferredMuseDefault,
} from "./modelCatalog.ts";

describe("Muse model catalog", () => {
  it("normalizes saved and implicit efforts against the selected model before dispatch", () => {
    const fallback = museModelCapabilities();
    expect(resolveMuseReasoningEffort(fallback, undefined)).toBe("high");
    expect(resolveMuseReasoningEffort(fallback, "max")).toBe("max");
    expect(resolveMuseReasoningEffort(fallback, "ultra")).toBe("high");
    const restricted = museModelCapabilities({ variants: ["xhigh"] });
    expect(resolveMuseReasoningEffort(restricted, undefined)).toBe("xhigh");
    expect(resolveMuseReasoningEffort(restricted, "low")).toBe("xhigh");
    expect(
      resolveMuseReasoningEffort(museModelCapabilities({ variants: [] }), "max"),
    ).toBeUndefined();
    expect(resolveMuseReasoningEffort(undefined, "max")).toBe("max");
  });

  it("keeps Muse Spark 1.3 the default over Meta's Contributor default while it is listed", () => {
    const model = (slug: string, isDefault: boolean) => ({
      slug,
      name: slug,
      isCustom: false,
      isDefault,
      capabilities: null,
    });
    const contributor = model("muse-spark-1.3-contributor", true);
    expect(
      withPreferredMuseDefault([contributor, model("muse-spark-1.3", false)]).map(
        (entry) => entry.isDefault,
      ),
    ).toEqual([false, true]);
    expect(withPreferredMuseDefault([contributor])).toEqual([contributor]);
  });
});
