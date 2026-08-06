import * as NodeOS from "node:os";
import type { PrimeSettings, ServerProviderModel } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildServerProvider,
  isCommandMissingCause,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import {
  formatPrimeModelSlug,
  parsePrimeModelSlug,
  resolvePrimeAgentDirectory,
} from "../acp/PrimeAcpSupport.ts";

const PRIME_PRESENTATION = {
  displayName: "Prime Agent",
  badgeLabel: "Experimental",
  showInteractionModeToggle: false,
  supportedRuntimeModes: ["full-access"],
  requiresNewThreadForModelChange: true,
} as const;
const EMPTY_CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });
const SUPPORTED_PRIME_AGENT_VERSION = "0.7.0";
const PRIME_AGENT_VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const VERSION_PROBE_TIMEOUT_MS = 4_000;
const VERSION_PROBE_MAX_OUTPUT_BYTES = 64 * 1024;
const MODEL_PROBE_TIMEOUT_MS = 20_000;
const MODEL_PROBE_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const decodeUnknownJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString);

const PRIME_CREDENTIAL_ENV_NAMES = [
  "AI_GATEWAY_API_KEY",
  "ANTHROPIC_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "CEREBRAS_API_KEY",
  "CLOUDFLARE_API_KEY",
  "DEEPSEEK_API_KEY",
  "FIREWORKS_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "HF_TOKEN",
  "KIMI_API_KEY",
  "MINIMAX_API_KEY",
  "MINIMAX_CN_API_KEY",
  "MISTRAL_API_KEY",
  "OPENAI_API_KEY",
  "OPENCODE_API_KEY",
  "OPENROUTER_API_KEY",
  "PRIME_API_KEY",
  "XAI_API_KEY",
  "ZAI_API_KEY",
] as const;

const AUTO_MODEL: ServerProviderModel = {
  slug: "auto",
  name: "Automatic",
  isDefault: true,
  isCustom: false,
  capabilities: EMPTY_CAPABILITIES,
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasConfiguredCredential(value: unknown): boolean {
  if (!isRecord(value)) return false;
  for (const key of ["key", "access", "refresh"] as const) {
    if (typeof value[key] === "string" && value[key].trim().length > 0) return true;
  }
  return false;
}

type StoredPrimeCredentialState = "configured" | "missing" | "unknown";

const storedPrimeCredentialState = Effect.fn("storedPrimeCredentialState")(function* (
  environment: NodeJS.ProcessEnv,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const agentDir = resolvePrimeAgentDirectory(path, environment, NodeOS.homedir());

  const authJson = yield* fileSystem
    .readFileString(path.join(agentDir, "auth.json"))
    .pipe(Effect.result);
  if (Result.isFailure(authJson)) {
    return authJson.failure instanceof PlatformError.PlatformError &&
      authJson.failure.reason._tag === "NotFound"
      ? ("missing" satisfies StoredPrimeCredentialState)
      : ("unknown" satisfies StoredPrimeCredentialState);
  }
  const decoded = Option.getOrUndefined(decodeUnknownJson(authJson.success));
  if (!isRecord(decoded)) return "unknown" satisfies StoredPrimeCredentialState;
  return Object.values(decoded).some(hasConfiguredCredential)
    ? ("configured" satisfies StoredPrimeCredentialState)
    : ("missing" satisfies StoredPrimeCredentialState);
});

function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex -- Prime's table may be colorized on a TTY.
  return input.replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "");
}

function parsePrimeAgentVersion(output: string): string | null {
  for (const token of stripAnsi(output).split(/\s+/u)) {
    const candidate = token.startsWith("v") ? token.slice(1) : token;
    if (PRIME_AGENT_VERSION_PATTERN.test(candidate)) return candidate;
  }
  return null;
}

export function parsePrimeModelListOutput(output: string): ReadonlyArray<ServerProviderModel> {
  const lines = stripAnsi(output)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const models: Array<ServerProviderModel> = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const columns = line.split(/\s{2,}/u);
    if (columns.length < 2) continue;
    const provider = columns[0]?.trim() ?? "";
    const modelId = columns[1]?.trim() ?? "";
    if (!provider || !modelId || provider.toLowerCase() === "provider") continue;
    const slug = formatPrimeModelSlug(provider, modelId);
    if (seen.has(slug)) continue;
    seen.add(slug);
    models.push({
      slug,
      name: modelId,
      subProvider: provider,
      isCustom: false,
      capabilities: EMPTY_CAPABILITIES,
    });
  }
  return models;
}

function primeModelsFromSettings(
  customModels: ReadonlyArray<string>,
  discoveredModels: ReadonlyArray<ServerProviderModel> = [],
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(
    [AUTO_MODEL, ...discoveredModels],
    customModels.filter((model) => parsePrimeModelSlug(model) !== undefined),
    EMPTY_CAPABILITIES,
  );
}

export const buildInitialPrimeProviderSnapshot = Effect.fn("buildInitialPrimeProviderSnapshot")(
  function* (settings: PrimeSettings): Effect.fn.Return<ServerProviderDraft> {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const models = primeModelsFromSettings(settings.customModels);
    if (!settings.enabled) {
      return buildServerProvider({
        presentation: PRIME_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Prime Agent is disabled in T3 Code settings.",
        },
      });
    }
    return buildServerProvider({
      presentation: PRIME_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Checking Prime Agent availability...",
      },
    });
  },
);

const runPrimeCommand = Effect.fn("runPrimeCommand")(function* (
  settings: PrimeSettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv,
  maxOutputBytes?: number,
) {
  const command = settings.binaryPath || "prime-agent";
  const spawnCommand = yield* resolveSpawnCommand(command, args, { env: environment });
  return yield* spawnAndCollect(
    command,
    ChildProcess.make(spawnCommand.command, spawnCommand.args, {
      env: environment,
      shell: spawnCommand.shell,
    }),
    maxOutputBytes === undefined ? undefined : { maxOutputBytes },
  );
});

export const checkPrimeProviderStatus = Effect.fn("checkPrimeProviderStatus")(function* (
  settings: PrimeSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<
  ServerProviderDraft,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> {
  if (!settings.enabled) return yield* buildInitialPrimeProviderSnapshot(settings);
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fallbackModels = primeModelsFromSettings(settings.customModels);
  const versionResult = yield* runPrimeCommand(
    settings,
    ["--version"],
    environment,
    VERSION_PROBE_MAX_OUTPUT_BYTES,
  ).pipe(Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS), Effect.result);
  if (Result.isFailure(versionResult)) {
    return buildServerProvider({
      presentation: PRIME_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: !isCommandMissingCause(versionResult.failure),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(versionResult.failure)
          ? "Prime Agent CLI (`prime-agent`) is not installed or not on PATH."
          : "Failed to execute the Prime Agent CLI health check.",
      },
    });
  }
  if (Option.isNone(versionResult.success)) {
    return buildServerProvider({
      presentation: PRIME_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Prime Agent is installed but timed out while running `prime-agent --version`.",
      },
    });
  }
  const versionOutput = versionResult.success.value;
  const version = parsePrimeAgentVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`);
  if (versionOutput.code !== 0) {
    return buildServerProvider({
      presentation: PRIME_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: "Prime Agent is installed but failed to run.",
      },
    });
  }
  if (version !== SUPPORTED_PRIME_AGENT_VERSION) {
    return buildServerProvider({
      presentation: PRIME_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message:
          version === null
            ? `Prime Agent is installed, but its version could not be verified. T3 Code supports Prime Agent v${SUPPORTED_PRIME_AGENT_VERSION}.`
            : `Prime Agent v${version} is not supported. Install Prime Agent v${SUPPORTED_PRIME_AGENT_VERSION}.`,
      },
    });
  }

  const modelResult = yield* runPrimeCommand(
    settings,
    ["model", "list"],
    environment,
    MODEL_PROBE_MAX_OUTPUT_BYTES,
  ).pipe(Effect.timeoutOption(MODEL_PROBE_TIMEOUT_MS), Effect.result);
  const modelProbeOutput =
    Result.isSuccess(modelResult) &&
    Option.isSome(modelResult.success) &&
    modelResult.success.value.code === 0 &&
    !modelResult.success.value.stdoutTruncated &&
    !modelResult.success.value.stderrTruncated
      ? modelResult.success.value
      : undefined;
  const modelProbeFailed = modelProbeOutput === undefined;
  const discoveredModels = modelProbeOutput
    ? parsePrimeModelListOutput(`${modelProbeOutput.stdout}\n${modelProbeOutput.stderr}`)
    : [];
  const models = primeModelsFromSettings(settings.customModels, discoveredModels);
  const hasEnvironmentCredential = PRIME_CREDENTIAL_ENV_NAMES.some((name) =>
    Boolean(environment[name]?.trim()),
  );
  const storedCredential = hasEnvironmentCredential
    ? ("missing" as const)
    : yield* storedPrimeCredentialState(environment).pipe(
        Effect.orElseSucceed(() => "unknown" as const),
      );
  const authenticated =
    discoveredModels.length > 0 || hasEnvironmentCredential || storedCredential === "configured";
  return buildServerProvider({
    presentation: PRIME_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version,
      status: modelProbeFailed ? "error" : discoveredModels.length > 0 ? "ready" : "warning",
      auth: authenticated
        ? {
            status: "authenticated",
            type: "prime-agent",
            label: hasEnvironmentCredential
              ? "Provider environment"
              : storedCredential === "configured"
                ? "Prime Agent credentials"
                : "Prime Agent model access",
          }
        : storedCredential === "missing" && !modelProbeFailed
          ? { status: "unauthenticated" }
          : { status: "unknown" },
      message: modelProbeFailed
        ? "Prime Agent is installed, but model discovery failed. It runs model-generated code with workspace-user permissions and does not support per-tool approvals over ACP."
        : !authenticated
          ? "Prime Agent has no usable authenticated models. Connect a provider or configure an API/cloud credential."
          : "Prime Agent runs model-generated code with workspace-user permissions and does not support per-tool approvals over ACP.",
    },
  });
});
