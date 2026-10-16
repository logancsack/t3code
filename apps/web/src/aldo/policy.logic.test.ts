import { describe, expect, it } from "vite-plus/test";

import type { AldoPolicyView } from "./cloud";
import {
  ALDO_SAME_AS_EVERYWHERE,
  ALDO_UNDECIDED,
  aldoMediaDefaults,
  aldoMergeMethodEdits,
  aldoMergeMethods,
  aldoRuleDifferences,
  aldoRuleEdit,
  aldoRuleLabel,
  aldoRuleOptions,
  aldoRuleValue,
  aldoWorkspaceLabel,
} from "./policy.logic";

const view: AldoPolicyView = {
  everywhere: {
    merge: "auto",
    spendThreshold: 50,
    mediaDefaults: { video: "Runway", image: null },
  },
  workspaces: [
    {
      repos: ["logancsack/aldo", "logancsack/t3code"],
      policy: {
        merge: "approve",
        mergeMethod: { "logancsack/aldo": "squash" },
        reviews: "important",
      },
    },
    { repos: ["logancsack/site"], policy: { merge: "auto", spendThreshold: 37 } },
  ],
  repos: ["logancsack/aldo", "logancsack/site", "logancsack/t3code"],
};

describe("aldoRuleValue", () => {
  it("reads the user's answer, a rule's default, or undecided", () => {
    expect(aldoRuleValue("merge", view.everywhere)).toBe("auto");
    expect(aldoRuleValue("spendThreshold", view.everywhere)).toBe("50");
    expect(aldoRuleValue("reviews", view.everywhere)).toBe(ALDO_UNDECIDED);
    expect(aldoRuleValue("paidFallback", view.everywhere)).toBe("never");
    expect(aldoRuleValue("contextBudget", view.everywhere)).toBe("300000");
    expect(aldoRuleValue("contextBudget", { contextBudget: 500_000 })).toBe("500000");
  });
});

describe("aldoRuleOptions", () => {
  it("offers undecided only for a rule without a default, and following the user's own for a workspace", () => {
    expect(aldoRuleOptions("merge", "auto")[0]).toEqual({
      value: ALDO_UNDECIDED,
      label: "Not decided",
    });
    expect(aldoRuleOptions("paidFallback", "never").map((o) => o.value)).toEqual([
      "never",
      "authorized",
    ]);
    expect(aldoRuleOptions("merge", "auto", { workspace: true })[0]?.value).toBe(
      ALDO_SAME_AS_EVERYWHERE,
    );
  });

  it("keeps an amount an agent recorded, in order", () => {
    const values = aldoRuleOptions("spendThreshold", "37").map((o) => o.value);
    expect(values).toEqual([ALDO_UNDECIDED, "0", "5", "20", "37", "50", "100", "250"]);
    expect(aldoRuleLabel("spendThreshold", "37")).toBe("Up to $37");
    expect(aldoRuleLabel("spendThreshold", "0")).toBe("Always ask");
    expect(aldoRuleLabel("contextBudget", "250000")).toBe("250k tokens");
    expect(aldoRuleLabel("contextBudget", "1000000")).toBe("1M tokens");
    expect(aldoRuleLabel("merge", ALDO_SAME_AS_EVERYWHERE)).toBe("Same as everywhere");
  });
});

describe("aldoRuleEdit", () => {
  it("sets an answer, or clears it so an agent asks (or the workspace follows the user's own)", () => {
    expect(aldoRuleEdit("merge", "approve")).toEqual({ set: { merge: "approve" } });
    expect(aldoRuleEdit("spendThreshold", "0")).toEqual({ set: { spendThreshold: 0 } });
    expect(aldoRuleEdit("paidFallback", "authorized")).toEqual({
      set: { modelRouting: { paidFallback: "authorized" } },
    });
    expect(aldoRuleEdit("reviews", ALDO_UNDECIDED)).toEqual({ clear: [["reviews"]] });
    expect(aldoRuleEdit("merge", ALDO_SAME_AS_EVERYWHERE, ["logancsack/site"])).toEqual({
      repos: ["logancsack/site"],
      clear: [["merge"]],
    });
    expect(aldoRuleEdit("contextBudget", "50")).toBeNull();
  });
});

describe("aldoRuleDifferences", () => {
  it("lists the workspaces that answered otherwise", () => {
    expect(aldoRuleDifferences(view, "merge")).toEqual([
      { repos: ["logancsack/aldo", "logancsack/t3code"], value: "approve" },
    ]);
    expect(aldoRuleDifferences(view, "spendThreshold")).toEqual([
      { repos: ["logancsack/site"], value: "37" },
    ]);
    expect(aldoRuleDifferences(view, "mediaRouting")).toEqual([]);
  });
});

describe("merge methods", () => {
  it("shows each repository's method, decided ones first", () => {
    expect(aldoMergeMethods(view)).toEqual([
      { repo: "logancsack/aldo", value: "squash" },
      { repo: "logancsack/site", value: ALDO_UNDECIDED },
      { repo: "logancsack/t3code", value: ALDO_UNDECIDED },
    ]);
  });

  it("sets one for every workspace, or clears it everywhere it was recorded", () => {
    expect(aldoMergeMethodEdits(view, "logancsack/site", "rebase")).toEqual([
      { set: { mergeMethod: { "logancsack/site": "rebase" } } },
    ]);
    expect(aldoMergeMethodEdits(view, "logancsack/aldo", ALDO_UNDECIDED)).toEqual([
      {
        repos: ["logancsack/aldo", "logancsack/t3code"],
        clear: [["mergeMethod", "logancsack/aldo"]],
      },
    ]);
    expect(aldoMergeMethodEdits(view, "logancsack/aldo", "fast-forward")).toEqual([]);
  });
});

describe("aldoMediaDefaults and aldoWorkspaceLabel", () => {
  it("lists the tools the user named, and names a workspace by its repositories", () => {
    expect(aldoMediaDefaults(view)).toEqual([{ task: "video", label: "Video", tool: "Runway" }]);
    expect(aldoWorkspaceLabel(["logancsack/aldo", "logancsack/t3code"])).toBe("aldo + t3code");
  });
});
