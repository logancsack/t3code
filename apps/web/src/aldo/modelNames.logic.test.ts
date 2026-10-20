import { describe, expect, it } from "vite-plus/test";

import {
  listedModelName,
  modelDisplayName,
  modelNameFromId,
  reportedModelName,
  splitConversationModel,
  type ModelNameSource,
} from "./modelNames.logic";

describe("modelNameFromId", () => {
  it.each([
    ["claude-opus-5-5", "Claude Opus 5.5"],
    ["claude-opus-4-1", "Claude Opus 4.1"],
    ["claude-sonnet-4-5-20250929", "Claude Sonnet 4.5"],
    ["claude-3-5-sonnet-latest", "Claude 3.5 Sonnet"],
    ["gpt-6.1-sol", "GPT-6.1 Sol"],
    ["gpt-5.1-codex-max", "GPT-5.1 Codex Max"],
    ["gpt-5-mini", "GPT-5 mini"],
    ["gpt-4o-2024-08-06", "GPT-4o"],
    ["o3", "o3"],
    ["grok-code-fast-1", "Grok Code Fast 1"],
    ["gemini-3.1-pro-high", "Gemini 3.1 Pro High"],
    ["deepseek-v4.1-flash", "DeepSeek V4.1 Flash"],
    ["muse-spark-1.3", "Muse Spark 1.3"],
    ["anthropic/claude-sonnet-4-5", "Claude Sonnet 4.5"],
    ["openai.gpt-5.6-sol", "GPT-5.6 Sol"],
  ])("reads %s as %s", (id, name) => {
    expect(modelNameFromId(id)).toBe(name);
  });

  it("names Aldo's own models as Aldo does", () => {
    expect(modelNameFromId("aldo/glm-5.3-flash")).toBe("GLM 5.3 Flash");
    expect(modelNameFromId("aldo/claude-haiku-5.5")).toBe("Claude Haiku 5.5");
    expect(modelNameFromId("aldo/gpt-6.1-sol")).toBe("GPT-6.1 Sol (think harder)");
    // One Aldo adds later still reads as a name.
    expect(modelNameFromId("aldo/kimi-k3")).toBe("Kimi K3");
  });

  it("says what a planned thread's default is", () => {
    expect(modelNameFromId("default")).toBe("Default model");
  });

  it("keeps what it can't read", () => {
    expect(modelNameFromId("")).toBe("");
    expect(modelNameFromId("  ")).toBe("  ");
    expect(modelNameFromId("---")).toBe("---");
  });
});

const sources: ModelNameSource[] = [
  {
    instanceId: "claudeAgent",
    models: [
      { slug: "claude-opus-5-5", name: "Claude Opus 5.5", isDefault: true },
      { slug: "claude-haiku-5-5", name: "Claude Haiku 5.5", shortName: "Haiku 5.5" },
    ],
  },
  {
    instanceId: "opencode",
    models: [
      { slug: "aldo/glm-5.3-flash", name: "GLM 5.3 Flash", subProvider: "Aldo" },
      { slug: "anthropic/claude-opus-5-5", name: "Claude Opus 5.5 (OpenCode)" },
    ],
  },
  {
    instanceId: "codex",
    models: [{ slug: "gpt-6.1-sol", name: "GPT-6.1 Sol", aliases: ["gpt-6.1"] }],
  },
];

describe("reportedModelName", () => {
  it("takes the name the instance reported, short when it has one", () => {
    expect(reportedModelName(sources, "claudeAgent", "claude-haiku-5-5")).toBe("Haiku 5.5");
    expect(reportedModelName(sources, "opencode", "aldo/glm-5.3-flash")).toBe("GLM 5.3 Flash");
  });

  it("prefers the instance's own name for a slug two providers list", () => {
    const both: ModelNameSource[] = [
      { instanceId: "other", models: [{ slug: "shared", name: "From other" }] },
      { instanceId: "mine", models: [{ slug: "shared", name: "From mine" }] },
    ];
    expect(reportedModelName(both, "mine", "shared")).toBe("From mine");
    expect(reportedModelName(both, null, "shared")).toBe("From other");
  });

  it("finds a model another provider lists, or by an alias", () => {
    expect(reportedModelName(sources, "claudeAgent_work", "claude-opus-5-5")).toBe(
      "Claude Opus 5.5",
    );
    expect(reportedModelName(sources, "codex", "gpt-6.1")).toBe("GPT-6.1 Sol");
  });

  it("reads a planned thread's default as the instance's own default model", () => {
    expect(reportedModelName(sources, "claudeAgent", "default")).toBe("Claude Opus 5.5");
    // Another provider's default isn't this one's.
    expect(reportedModelName(sources, "grok", "default")).toBeNull();
    expect(reportedModelName(sources, null, "default")).toBeNull();
  });

  it("is null when nothing reported it", () => {
    expect(reportedModelName(sources, "claudeAgent", "claude-opus-6")).toBeNull();
    expect(reportedModelName([], null, "claude-opus-6")).toBeNull();
  });
});

describe("listedModelName", () => {
  it('names a model one provider lists, its default for "default"', () => {
    const models = sources[0]!.models;
    expect(listedModelName(models, "claude-haiku-5-5")).toBe("Haiku 5.5");
    expect(listedModelName(models, "default")).toBe("Claude Opus 5.5");
    expect(listedModelName(models, "claude-opus-6-0")).toBeNull();
    expect(listedModelName([], "default")).toBeNull();
  });
});

describe("modelDisplayName", () => {
  it("falls back to the name read from the id", () => {
    expect(modelDisplayName(sources, "claudeAgent", "claude-opus-5-5")).toBe("Claude Opus 5.5");
    expect(modelDisplayName(sources, "claudeAgent", "claude-opus-6-0")).toBe("Claude Opus 6.0");
    expect(modelDisplayName([], "opencode", "aldo/gpt-6.1-sol")).toBe("GPT-6.1 Sol (think harder)");
    expect(modelDisplayName([], "claudeAgent", "default")).toBe("Default model");
  });
});

describe("splitConversationModel", () => {
  it("splits Home's model into its instance and its id", () => {
    expect(splitConversationModel("claudeAgent/claude-opus-5-5")).toEqual({
      instanceId: "claudeAgent",
      slug: "claude-opus-5-5",
    });
    expect(splitConversationModel("opencode/aldo/glm-5.3-flash")).toEqual({
      instanceId: "opencode",
      slug: "aldo/glm-5.3-flash",
    });
  });

  it("leaves a bare id whole", () => {
    expect(splitConversationModel("claude-opus-5-5")).toEqual({
      instanceId: null,
      slug: "claude-opus-5-5",
    });
    expect(splitConversationModel("/x")).toEqual({ instanceId: null, slug: "/x" });
    expect(splitConversationModel("x/")).toEqual({ instanceId: null, slug: "x/" });
  });
});
