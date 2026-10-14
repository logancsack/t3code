import { describe, expect, it } from "vite-plus/test";

import { chooseModel, offeredModels, SUBAGENT_AGENTS, subagentModels } from "./subagents.logic";

const [claude, codex] = SUBAGENT_AGENTS as [
  (typeof SUBAGENT_AGENTS)[number],
  (typeof SUBAGENT_AGENTS)[number],
];

const reasoning = (...ids: string[]) => ({
  optionDescriptors: [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: ids.map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) })),
    },
  ],
});

const providers = [
  {
    instanceId: "claudeAgent",
    driver: "claudeAgent",
    enabled: true,
    models: [
      {
        slug: "claude-opus-5-5",
        name: "Claude Opus 5.5",
        capabilities: {
          optionDescriptors: [
            { id: "effort", label: "Effort", type: "select", options: [{ id: "high" }] },
          ],
        },
      },
      { slug: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", capabilities: null },
    ],
  },
  {
    instanceId: "codex",
    driver: "codex",
    enabled: true,
    models: [
      {
        slug: "gpt-6-astra",
        name: "GPT-6 Astra",
        capabilities: reasoning("low", "medium", "high"),
      },
      { slug: "gpt-6-luna", name: "GPT-6 Luna", capabilities: reasoning("low", "medium") },
    ],
  },
  {
    instanceId: "codex_work",
    driver: "codex",
    enabled: true,
    models: [
      { slug: "gpt-6-luna", name: "GPT-6 Luna (work)", capabilities: reasoning("low") },
      { slug: "gpt-6.1-sol", name: "GPT-6.1 Sol", capabilities: reasoning("xhigh") },
      { slug: "bad slug\n", name: "Not a model id" },
    ],
  },
  {
    instanceId: "codex_off",
    driver: "codex",
    enabled: false,
    models: [{ slug: "gpt-old", name: "Off" }],
  },
];

describe("subagentModels", () => {
  it("lists Claude's models without efforts: its subagents run at the main agent's", () => {
    expect(subagentModels(providers, claude)).toEqual([
      { slug: "claude-opus-5-5", name: "Claude Opus 5.5", efforts: [] },
      { slug: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", efforts: [] },
    ]);
  });

  it("lists each Codex model once, with its reasoning efforts, from enabled instances", () => {
    expect(subagentModels(providers, codex)).toEqual([
      {
        slug: "gpt-6-astra",
        name: "GPT-6 Astra",
        efforts: [
          { id: "low", label: "Low" },
          { id: "medium", label: "Medium" },
          { id: "high", label: "High" },
        ],
      },
      {
        slug: "gpt-6-luna",
        name: "GPT-6 Luna",
        efforts: [
          { id: "low", label: "Low" },
          { id: "medium", label: "Medium" },
        ],
      },
      { slug: "gpt-6.1-sol", name: "GPT-6.1 Sol", efforts: [{ id: "xhigh", label: "Xhigh" }] },
    ]);
  });

  it("lists none before any machine reported its models", () => {
    expect(subagentModels([], codex)).toEqual([]);
  });
});

describe("offeredModels", () => {
  const models = subagentModels(providers, claude);

  it("offers the provider's models", () => {
    expect(offeredModels(models, undefined)).toEqual(models);
    expect(offeredModels(models, { model: "claude-sonnet-5-5" })).toEqual(models);
  });

  it("keeps a saved model the provider no longer lists, by its id", () => {
    expect(offeredModels(models, { model: "claude-haiku-5-5" }).at(-1)).toEqual({
      slug: "claude-haiku-5-5",
      name: "claude-haiku-5-5",
      efforts: [],
    });
  });
});

describe("chooseModel", () => {
  const models = subagentModels(providers, codex);

  it("clears the default for the main agent's model", () => {
    expect(chooseModel(null, models, { model: "gpt-6-luna", reasoning: "low" })).toBeNull();
  });

  it("keeps the effort chosen before when the new model has it", () => {
    expect(
      chooseModel("gpt-6-astra", models, { model: "gpt-6-luna", reasoning: "medium" }),
    ).toEqual({ model: "gpt-6-astra", reasoning: "medium" });
  });

  it("drops an effort the new model doesn't have", () => {
    expect(chooseModel("gpt-6.1-sol", models, { model: "gpt-6-luna", reasoning: "low" })).toEqual({
      model: "gpt-6.1-sol",
    });
  });
});
