// Model names people know ("Claude Opus 5.5"), for the places that only have a
// model's id: a thread whose machine hasn't reported its models yet, the
// default Aldo keeps, Home's list. A name a provider reported always wins
// (reportedModelName); modelNameFromId is the fallback, and reads the id the
// way its maker writes the name.

import { getTriggerDisplayModelName, type ModelEsque } from "../components/chat/providerIconUtils";

/** Words model ids spell in lower case, as their makers write them. Others get a capital. */
const WORDS: Record<string, string> = {
  claude: "Claude",
  deepseek: "DeepSeek",
  gemini: "Gemini",
  glm: "GLM",
  gpt: "GPT",
  grok: "Grok",
  kimi: "Kimi",
  llama: "Llama",
  minimax: "MiniMax",
  mini: "mini",
  nano: "nano",
  oss: "OSS",
  qwen: "Qwen",
};

/**
 * Aldo's own models by the names Aldo gives them (AI_MODELS in aldo's
 * src/lib/ai-models.ts, which its OpenCode reports), by their id under the
 * `aldo` provider: for the moments before a machine has reported them.
 */
const ALDO_MODELS: Record<string, string> = {
  "glm-5.3-flash": "GLM 5.3 Flash",
  "claude-haiku-5.5": "Claude Haiku 5.5",
  "gpt-6.1-sol": "GPT-6.1 Sol (think harder)",
};

const SHORT_NUMBER = /^\d{1,2}$/;
const VERSION = /^\d+(?:\.\d+)*[a-z]?$/i;

function word(token: string): string {
  const lower = token.toLowerCase();
  const known = WORDS[lower];
  if (known) return known;
  // OpenAI's reasoning models keep their small o: o3, o4.
  if (/^o\d/.test(lower)) return lower;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * A readable name for a model id no provider named:
 * "claude-opus-5-5" → "Claude Opus 5.5", "aldo/glm-5.3-flash" → "GLM 5.3 Flash",
 * "gpt-6.1-sol" → "GPT-6.1 Sol". A date stamp and any provider prefix go.
 */
export function modelNameFromId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return id;
  const segments = trimmed.split("/").filter(Boolean);
  const last = segments.at(-1) ?? trimmed;
  if (segments.at(-2) === "aldo" && ALDO_MODELS[last]) return ALDO_MODELS[last];

  const base = last
    // A provider written before a dot: "openai.gpt-5.6-sol".
    .replace(/^[a-z][a-z-]*\.(?=[a-z])/i, "")
    // A date stamp or an alias for the newest: "-20250929", "-2024-08-06", "-latest".
    .replace(/[-_@](?:\d{8}|\d{4}-\d{2}-\d{2}|latest)$/i, "");
  if (base.toLowerCase() === "default") return "Default model";

  const tokens = base.split(/[-_\s]+/).filter(Boolean);
  const words: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    let version: string | null = null;
    if (SHORT_NUMBER.test(token)) {
      // "opus-5-5": a version's parts as separate tokens.
      version = token;
      while (index + 1 < tokens.length && SHORT_NUMBER.test(tokens[index + 1]!)) {
        index += 1;
        version += `.${tokens[index]}`;
      }
    } else if (VERSION.test(token)) {
      version = token.toLowerCase();
    }
    if (version !== null) {
      // GPT joins its version with a hyphen: "GPT-6.1".
      if (words.at(-1) === "GPT") words[words.length - 1] = `GPT-${version}`;
      else words.push(version);
      continue;
    }
    words.push(word(token));
  }
  return words.join(" ") || trimmed;
}

/** What a provider reports that names its models: a server config's provider entry. */
export interface ModelNameSource {
  readonly instanceId: string;
  readonly models: ReadonlyArray<ModelEsque>;
}

/**
 * The name one provider's list gives `slug` (by id or alias), null when it
 * doesn't list it. "default", which a thread Aldo plans before its machine
 * reports runs on, is the model the list marks as its default.
 */
export function listedModelName(models: ReadonlyArray<ModelEsque>, slug: string): string | null {
  const model =
    slug === "default"
      ? models.find((candidate) => candidate.isDefault)
      : (models.find((candidate) => candidate.slug === slug) ??
        models.find((candidate) => candidate.aliases?.includes(slug)));
  return model ? getTriggerDisplayModelName(model) : null;
}

/**
 * The name a provider reported for `slug`: on `instanceId` first, then on any
 * provider that lists the same id (every machine of the user's runs the same
 * agents). A provider's "default" is its own. Null when none does.
 */
export function reportedModelName(
  sources: Iterable<ModelNameSource>,
  instanceId: string | null,
  slug: string,
): string | null {
  const list = [...sources];
  for (const source of list) {
    if (source.instanceId !== instanceId) continue;
    const name = listedModelName(source.models, slug);
    if (name) return name;
  }
  if (slug === "default") return null;
  for (const source of list) {
    const name = listedModelName(source.models, slug);
    if (name) return name;
  }
  return null;
}

/** A model's name for people: the one a provider reported, else one read from its id. */
export function modelDisplayName(
  sources: Iterable<ModelNameSource>,
  instanceId: string | null,
  slug: string,
): string {
  return reportedModelName(sources, instanceId, slug) ?? modelNameFromId(slug);
}

/**
 * Home's model of a conversation, "<instance>/<model>" ("claudeAgent/claude-opus-5-5",
 * "opencode/aldo/glm-5.3-flash"), split into the two. A bare id has no instance.
 */
export function splitConversationModel(model: string): {
  readonly instanceId: string | null;
  readonly slug: string;
} {
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) return { instanceId: null, slug: model };
  return { instanceId: model.slice(0, slash), slug: model.slice(slash + 1) };
}
