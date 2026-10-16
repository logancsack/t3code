import { describe, expect, it } from "vite-plus/test";

import { type AldoPolicyView } from "./homeApi";
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
  optimisticPolicyEdit,
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

describe("optimistic policy changes", () => {
  it("clears before merging without changing other rules or the saved view", () => {
    const next = optimisticPolicyEdit(view, {
      clear: [["spendThreshold"], ["mediaDefaults", "image"]],
      set: { mediaDefaults: { audio: "ElevenLabs" }, onProviderLimit: "wait" },
    });
    expect(next.everywhere).toEqual({
      merge: "auto",
      mediaDefaults: { video: "Runway", audio: "ElevenLabs" },
      onProviderLimit: "wait",
    });
    expect(view.everywhere.spendThreshold).toBe(50);
    expect(view.everywhere.mediaDefaults).toEqual({ video: "Runway", image: null });
  });

  it("restores workspace inheritance and clears workspace merge methods decided everywhere", () => {
    const inherited = optimisticPolicyEdit(view, {
      repos: ["logancsack/t3code", "logancsack/aldo"],
      clear: [["merge"]],
    });
    expect(aldoRuleDifferences(inherited, "merge")).toEqual([]);
    const next = optimisticPolicyEdit(view, {
      set: { mergeMethod: { "logancsack/aldo": "merge" } },
    });
    expect(next.everywhere.mergeMethod).toEqual({ "logancsack/aldo": "merge" });
    expect(next.workspaces[0]?.policy.mergeMethod).toEqual({});
    expect(view.workspaces[0]?.policy.mergeMethod).toEqual({ "logancsack/aldo": "squash" });
  });
});

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

  it("compares with the rule's default where the user hasn't answered", () => {
    const budgets: AldoPolicyView = {
      ...view,
      workspaces: [
        { repos: ["logancsack/site"], policy: { contextBudget: 300_000 } },
        { repos: ["logancsack/aldo"], policy: { contextBudget: 500_000 } },
      ],
    };
    expect(aldoRuleDifferences(budgets, "contextBudget")).toEqual([
      { repos: ["logancsack/aldo"], value: "500000" },
    ]);
  });
});

describe("merge methods", () => {
  it("shows each repository's method, decided ones first", () => {
    expect(aldoMergeMethods(view)).toEqual([
      { repo: "logancsack/aldo", value: "squash", differences: [] },
      { repo: "logancsack/site", value: ALDO_UNDECIDED, differences: [] },
      { repo: "logancsack/t3code", value: ALDO_UNDECIDED, differences: [] },
    ]);
  });

  it("shows the workspaces that recorded another, under the user's own or where they disagree", () => {
    const methods: AldoPolicyView = {
      everywhere: { mergeMethod: { "logancsack/aldo": "squash" } },
      workspaces: [
        {
          repos: ["logancsack/aldo", "logancsack/t3code"],
          policy: { mergeMethod: { "logancsack/aldo": "merge", "logancsack/t3code": "merge" } },
        },
        {
          repos: ["logancsack/t3code"],
          policy: { mergeMethod: { "logancsack/t3code": "rebase" } },
        },
      ],
      repos: ["logancsack/aldo", "logancsack/site", "logancsack/t3code"],
    };
    expect(aldoMergeMethods(methods)).toEqual([
      {
        repo: "logancsack/aldo",
        value: "squash",
        differences: [{ repos: ["logancsack/aldo", "logancsack/t3code"], value: "merge" }],
      },
      {
        repo: "logancsack/t3code",
        value: ALDO_UNDECIDED,
        differences: [
          { repos: ["logancsack/aldo", "logancsack/t3code"], value: "merge" },
          { repos: ["logancsack/t3code"], value: "rebase" },
        ],
      },
      { repo: "logancsack/site", value: ALDO_UNDECIDED, differences: [] },
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

  it("sets one for a workspace, or has it follow the user's own", () => {
    const repos = ["logancsack/aldo", "logancsack/t3code"];
    expect(aldoMergeMethodEdits(view, "logancsack/aldo", "merge", repos)).toEqual([
      { repos, set: { mergeMethod: { "logancsack/aldo": "merge" } } },
    ]);
    expect(aldoMergeMethodEdits(view, "logancsack/aldo", ALDO_SAME_AS_EVERYWHERE, repos)).toEqual([
      { repos, clear: [["mergeMethod", "logancsack/aldo"]] },
    ]);
  });
});

describe("aldoMediaDefaults and aldoWorkspaceLabel", () => {
  it("lists the tools the user named, and names a workspace by its repositories", () => {
    expect(aldoMediaDefaults(view)).toEqual([{ task: "video", label: "Video", tool: "Runway" }]);
    const media: AldoPolicyView = {
      ...view,
      workspaces: [
        { repos: ["logancsack/site"], policy: { mediaDefaults: { video: null, image: "Codex" } } },
        { repos: ["logancsack/aldo"], policy: { mediaDefaults: { video: "Runway", image: null } } },
      ],
    };
    expect(aldoMediaDefaults(media)).toEqual([
      { task: "image", label: "Images", tool: "Codex", repos: ["logancsack/site"] },
      { task: "video", label: "Video", tool: "Runway" },
      { task: "video", label: "Video", tool: null, repos: ["logancsack/site"] },
    ]);
    expect(aldoWorkspaceLabel(["logancsack/aldo", "logancsack/t3code"])).toBe("aldo + t3code");
  });
});
