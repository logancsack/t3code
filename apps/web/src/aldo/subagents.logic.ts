// What each agent's subagents can run on when it names no model (Settings →
// Providers, AldoSubagentsPanel): the models the newest server config lists
// for its provider, and for Codex each model's reasoning efforts. Claude Code
// has no default effort for subagents: they run at the main agent's.

import type { AldoSubagentDefault, AldoSubagentProvider } from "./cloud";

export interface SubagentAgent {
  readonly kind: AldoSubagentProvider;
  /** The T3 provider driver whose models it lists. */
  readonly driver: string;
  readonly title: string;
  readonly description: string;
  /** Whether a reasoning effort can be chosen with the model. */
  readonly efforts: boolean;
}

export const SUBAGENT_AGENTS: ReadonlyArray<SubagentAgent> = [
  {
    kind: "claude",
    driver: "claudeAgent",
    title: "Claude Code",
    description:
      "What its subagents run on when Claude doesn't pick a model, Explore and Plan included. They keep the main agent's effort.",
    efforts: false,
  },
  {
    kind: "codex",
    driver: "codex",
    title: "Codex",
    description:
      "What its subagents run on when Codex doesn't pick a model, and at what reasoning.",
    efforts: true,
  },
];

export interface SubagentEffort {
  readonly id: string;
  readonly label: string;
}

export interface SubagentModel {
  readonly slug: string;
  readonly name: string;
  readonly efforts: ReadonlyArray<SubagentEffort>;
}

/** Codex's reasoning option, as its models describe it. */
const REASONING_OPTION = "reasoningEffort";
/** What Aldo writes into an agent's config: an id as the providers list them (Aldo checks the same). */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const EFFORT_ID = /^[a-z]{1,20}$/;

type EncodedModel = {
  slug?: unknown;
  name?: unknown;
  capabilities?: { optionDescriptors?: ReadonlyArray<Record<string, unknown>> } | null;
};

function effortsOf(model: EncodedModel): SubagentEffort[] {
  const option = model.capabilities?.optionDescriptors?.find(
    (descriptor) => descriptor.id === REASONING_OPTION && descriptor.type === "select",
  );
  const choices = Array.isArray(option?.options)
    ? (option.options as ReadonlyArray<{ id?: unknown; label?: unknown }>)
    : [];
  return choices.flatMap((choice) =>
    typeof choice.id === "string" && EFFORT_ID.test(choice.id)
      ? [{ id: choice.id, label: typeof choice.label === "string" ? choice.label : choice.id }]
      : [],
  );
}

/**
 * The models an agent's subagents can run on: every model its provider's
 * instances list (once each), in their order. One Aldo couldn't write into
 * a config file is left out.
 */
export function subagentModels(
  providers: ReadonlyArray<Record<string, unknown>>,
  agent: SubagentAgent,
): SubagentModel[] {
  const out = new Map<string, SubagentModel>();
  for (const provider of providers) {
    if (provider.driver !== agent.driver || provider.enabled === false) continue;
    const models = Array.isArray(provider.models) ? (provider.models as EncodedModel[]) : [];
    for (const model of models) {
      if (typeof model.slug !== "string" || !MODEL_ID.test(model.slug) || out.has(model.slug)) {
        continue;
      }
      out.set(model.slug, {
        slug: model.slug,
        name: typeof model.name === "string" ? model.name : model.slug,
        efforts: agent.efforts ? effortsOf(model) : [],
      });
    }
  }
  return [...out.values()];
}

/**
 * The models to offer: the provider's, and the one saved if it no longer
 * lists it (so the choice still shows, by its id).
 */
export function offeredModels(
  models: ReadonlyArray<SubagentModel>,
  saved: AldoSubagentDefault | undefined,
): SubagentModel[] {
  if (!saved || models.some((model) => model.slug === saved.model)) return [...models];
  return [...models, { slug: saved.model, name: saved.model, efforts: [] }];
}

/**
 * What choosing `slug` saves: null for the agent's own model; otherwise the
 * model, keeping the effort chosen before when the new model has it.
 */
export function chooseModel(
  slug: string | null,
  models: ReadonlyArray<SubagentModel>,
  saved: AldoSubagentDefault | undefined,
): AldoSubagentDefault | null {
  if (!slug) return null;
  const reasoning = saved?.reasoning;
  const model = models.find((candidate) => candidate.slug === slug);
  return reasoning && model?.efforts.some((effort) => effort.id === reasoning)
    ? { model: slug, reasoning }
    : { model: slug };
}
