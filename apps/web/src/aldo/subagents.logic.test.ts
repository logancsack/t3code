import { describe, expect, it } from "vite-plus/test";

import {
  chooseModel,
  MODELS_DEFAULT,
  offeredEfforts,
  offeredModels,
  SAME_AS_MAIN,
  SUBAGENT_AGENTS,
  subagentModels,
  withSubagentDefault,
} from "./subagents.logic";

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

  it("leaves out a model the user hid from an instance's picker, as the picker does", () => {
    const hidden = { codex: { hiddenModels: ["gpt-6-astra", "gpt-6-luna"] } };
    // Luna is still listed by codex_work, which doesn't hide it.
    expect(subagentModels(providers, codex, hidden).map((model) => model.slug)).toEqual([
      "gpt-6-luna",
      "gpt-6.1-sol",
    ]);
    const custom = [
      { ...providers[1], models: [{ slug: "my-model", name: "Mine", isCustom: true }] },
    ];
    expect(
      subagentModels(custom, codex, { codex: { hiddenModels: ["my-model"] } }).map((m) => m.slug),
    ).toEqual(["my-model"]);
  });
});

describe("the choices that aren't a model or an effort", () => {
  it("can't be a model's or an effort's id", () => {
    const listed = [
      {
        ...providers[1],
        models: [
          { slug: SAME_AS_MAIN, name: "x", capabilities: reasoning("low") },
          { slug: "main", name: "Main", capabilities: reasoning("default", MODELS_DEFAULT) },
        ],
      },
    ];
    expect(subagentModels(listed, codex)).toEqual([
      { slug: "main", name: "Main", efforts: [{ id: "default", label: "Default" }] },
    ]);
  });
});

describe("offeredEfforts", () => {
  const models = subagentModels(providers, codex);

  it("offers the saved model's efforts", () => {
    expect(offeredEfforts(models, { model: "gpt-6-luna" }).map((effort) => effort.id)).toEqual([
      "low",
      "medium",
    ]);
    expect(offeredEfforts(models, undefined)).toEqual([]);
  });

  it("keeps a saved effort the model no longer lists, so it shows and can be reset", () => {
    expect(
      offeredEfforts(models, { model: "gpt-6.1-sol", reasoning: "low" }).map((effort) => effort.id),
    ).toEqual(["xhigh", "low"]);
    expect(offeredEfforts(models, { model: "gpt-gone", reasoning: "high" })).toEqual([
      { id: "high", label: "high" },
    ]);
  });
});

describe("withSubagentDefault", () => {
  it("changes one agent's and keeps the other's", () => {
    const both = { claude: { model: "claude-sonnet-5-5" }, codex: { model: "gpt-6-luna" } };
    expect(
      withSubagentDefault(both, "codex", { model: "gpt-6.1-sol", reasoning: "xhigh" }),
    ).toEqual({
      claude: { model: "claude-sonnet-5-5" },
      codex: { model: "gpt-6.1-sol", reasoning: "xhigh" },
    });
    expect(withSubagentDefault(both, "claude", null)).toEqual({ codex: { model: "gpt-6-luna" } });
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
