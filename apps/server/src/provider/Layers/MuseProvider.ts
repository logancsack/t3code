import {
  type ModelCapabilities,
  type MuseSettings,
  type ServerProviderModel,
  type ServerProviderSkill,
} from "@t3tools/contracts";
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
  buildSelectOptionDescriptor,
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

const MUSE_PRESENTATION = {
  displayName: "Muse Code",
  badgeLabel: "Beta",
  showInteractionModeToggle: true,
} as const;

const VERSION_PROBE_TIMEOUT_MS = 4_000;
const SKILLS_PROBE_TIMEOUT_MS = 4_000;
const SKILLS_PROBE_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const decodeUnknownJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
export const DEFAULT_MUSE_MODEL = "muse-spark-1.3";

// Meta's efforts (Muse Code 1.4.6): it refuses "none"; "ultra" depends on the plan
// (and runs at a model's highest level); "max" is served only by Muse Spark 1.3
// and Muse Wonder.
export const MUSE_REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;

export type MuseReasoningEffort = (typeof MUSE_REASONING_EFFORTS)[number];

/** Whether Meta serves the "max" effort for a model. */
export function museModelOffersMax(model: string): boolean {
  return /^muse-(spark-1\.3|wonder)\b/.test(model);
}

function museModelCapabilities(offersMax: boolean): ModelCapabilities {
  return createModelCapabilities({
    optionDescriptors: [
      buildSelectOptionDescriptor({
        id: "reasoningEffort",
        label: "Reasoning",
        options: MUSE_REASONING_EFFORTS.filter((value) => offersMax || value !== "max").map(
          (value) => ({
            value,
            label:
              value === "xhigh" ? "Extra high" : value.charAt(0).toUpperCase() + value.slice(1),
            ...(value === "high" ? { isDefault: true as const } : {}),
          }),
        ),
      }),
    ],
  });
}

/** Muse Spark 1.2 and custom models: every effort but max. */
export const MUSE_MODEL_CAPABILITIES: ModelCapabilities = museModelCapabilities(false);

const MUSE_SPARK_1_3_CAPABILITIES: ModelCapabilities = museModelCapabilities(true);

const MUSE_BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: DEFAULT_MUSE_MODEL,
    name: "Muse Spark 1.3",
    isDefault: true,
    isCustom: false,
    capabilities: MUSE_SPARK_1_3_CAPABILITIES,
  },
  {
    slug: "muse-spark-1.2",
    name: "Muse Spark 1.2",
    isDefault: false,
    isCustom: false,
    capabilities: MUSE_MODEL_CAPABILITIES,
  },
];

export function makeMuseEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...environment,
    MUSE_NO_AUTO_UPDATE: "1",
  };
}

export function parseMuseCliVersion(output: string): string | null {
  return output.match(/\b(\d+\.\d+\.\d+-R\d+(?:\.\d+)?)\b/)?.[1] ?? parseGenericCliVersion(output);
}

/**
 * The effort to run a model at: one of Meta's, high otherwise, and xhigh for
 * max on a model Meta doesn't serve it for (kept across a model switch, say).
 */
export function resolveMuseReasoningEffort(
  value: string | undefined,
  model: string,
): MuseReasoningEffort {
  const effort = MUSE_REASONING_EFFORTS.find((candidate) => candidate === value) ?? "high";
  return effort === "max" && !museModelOffersMax(model) ? "xhigh" : effort;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Map Muse's native skills inventory into the provider snapshot contract. */
export function parseMuseSkillsListOutput(output: string): ReadonlyArray<ServerProviderSkill> {
  const decoded = Option.getOrUndefined(decodeUnknownJson(output));
  if (!isRecord(decoded) || !Array.isArray(decoded.skills)) return [];

  const skills: Array<ServerProviderSkill> = [];
  for (const value of decoded.skills) {
    if (!isRecord(value)) continue;
    const name = nonEmptyString(value.name);
    const skillPath = nonEmptyString(value.path);
    if (!name || !skillPath) continue;

    const activation = nonEmptyString(value.activation);
    const description = nonEmptyString(value.description);
    const scope = nonEmptyString(value.scope);
    const displayName = nonEmptyString(value.display_name);
    const shortDescription = nonEmptyString(value.short_description);
    skills.push({
      name,
      path: skillPath,
      enabled: activation === "on" || activation === "user-invocable-only",
      ...(description ? { description } : {}),
      ...(scope ? { scope } : {}),
      ...(displayName ? { displayName } : {}),
      ...(shortDescription ? { shortDescription } : {}),
    });
  }
  return skills;
}

function hasCredentialValue(value: unknown): boolean {
  if (!isRecord(value)) return false;
  for (const key of ["api_key", "access_token", "refresh_token"] as const) {
    if (typeof value[key] === "string" && value[key].trim().length > 0) {
      return true;
    }
  }
  return Object.values(value).some((nested) => isRecord(nested) && hasCredentialValue(nested));
}

type StoredMuseCredentialState = "configured" | "missing" | "unknown";

/**
 * Muse does not expose an auth-status command. Inspect only the shape of its
 * local credential record and never retain or surface any credential value.
 * A missing credential is distinct from an unreadable or unfamiliar record:
 * only the former is enough evidence to mark the provider unauthenticated.
 */
const storedMuseCredentialState = Effect.fn("storedMuseCredentialState")(function* (
  environment: NodeJS.ProcessEnv,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configHome = environment.XDG_CONFIG_HOME?.trim()
    ? path.resolve(environment.XDG_CONFIG_HOME)
    : environment.HOME?.trim()
      ? path.join(path.resolve(environment.HOME), ".config")
      : undefined;
  if (!configHome) return "unknown" satisfies StoredMuseCredentialState;

  const authJson = yield* fileSystem
    .readFileString(path.join(configHome, "muse", "auth.json"))
    .pipe(Effect.result);
  if (Result.isFailure(authJson)) {
    return authJson.failure instanceof PlatformError.PlatformError &&
      authJson.failure.reason._tag === "NotFound"
      ? ("missing" satisfies StoredMuseCredentialState)
      : ("unknown" satisfies StoredMuseCredentialState);
  }

  const decoded = Option.getOrUndefined(decodeUnknownJson(authJson.success));
  if (!isRecord(decoded) || decoded.schema_version !== 1 || !isRecord(decoded.providers)) {
    return "unknown" satisfies StoredMuseCredentialState;
  }
  return hasCredentialValue(decoded.providers.meta)
    ? ("configured" satisfies StoredMuseCredentialState)
    : ("missing" satisfies StoredMuseCredentialState);
});

export const hasStoredMuseCredential = Effect.fn("hasStoredMuseCredential")(function* (
  environment: NodeJS.ProcessEnv,
) {
  return (yield* storedMuseCredentialState(environment)) === "configured";
});

function museModelsFromSettings(
  customModels: ReadonlyArray<string>,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(MUSE_BUILT_IN_MODELS, customModels, MUSE_MODEL_CAPABILITIES);
}

export const buildInitialMuseProviderSnapshot = Effect.fn("buildInitialMuseProviderSnapshot")(
  function* (museSettings: MuseSettings): Effect.fn.Return<ServerProviderDraft> {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const models = museModelsFromSettings(museSettings.customModels);

    if (!museSettings.enabled) {
      return buildServerProvider({
        presentation: MUSE_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Muse Code is disabled in T3 Code settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: MUSE_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Checking Muse Code availability...",
      },
    });
  },
);

const runMuseVersionCommand = Effect.fn("runMuseVersionCommand")(function* (
  museSettings: MuseSettings,
  environment: NodeJS.ProcessEnv,
) {
  const command = museSettings.binaryPath || "muse";
  const spawnCommand = yield* resolveSpawnCommand(command, ["--version"], { env: environment });
  return yield* spawnAndCollect(
    command,
    ChildProcess.make(spawnCommand.command, spawnCommand.args, {
      env: environment,
      shell: spawnCommand.shell,
    }),
  );
});

const discoverMuseSkills = Effect.fn("discoverMuseSkills")(function* (
  museSettings: MuseSettings,
  environment: NodeJS.ProcessEnv,
  cwd: string,
): Effect.fn.Return<
  ReadonlyArray<ServerProviderSkill>,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> {
  const command = museSettings.binaryPath || "muse";
  const args = [
    "skills",
    "list",
    "--json",
    "--source",
    "all",
    "--workspace",
    cwd,
    "--trust-workspace",
  ];
  const probe = yield* resolveSpawnCommand(command, args, { env: environment }).pipe(
    Effect.flatMap((spawnCommand) =>
      spawnAndCollect(
        command,
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          cwd,
          env: environment,
          shell: spawnCommand.shell,
        }),
        { maxOutputBytes: SKILLS_PROBE_MAX_OUTPUT_BYTES },
      ),
    ),
    Effect.timeoutOption(SKILLS_PROBE_TIMEOUT_MS),
    Effect.result,
  );
  if (Result.isFailure(probe) || Option.isNone(probe.success)) return [];

  const output = probe.success.value;
  if (output.code !== 0 || output.stdoutTruncated) return [];
  return parseMuseSkillsListOutput(output.stdout);
});

export const checkMuseProviderStatus = Effect.fn("checkMuseProviderStatus")(function* (
  museSettings: MuseSettings,
  environment: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): Effect.fn.Return<
  ServerProviderDraft,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const models = museModelsFromSettings(museSettings.customModels);

  if (!museSettings.enabled) {
    return yield* buildInitialMuseProviderSnapshot(museSettings);
  }

  const resolvedEnvironment = makeMuseEnvironment(environment);
  const versionResult = yield* runMuseVersionCommand(museSettings, resolvedEnvironment).pipe(
    Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionResult)) {
    return buildServerProvider({
      presentation: MUSE_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: !isCommandMissingCause(versionResult.failure),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(versionResult.failure)
          ? "Muse Code CLI (`muse`) is not installed or not on PATH."
          : "Failed to execute the Muse Code CLI health check.",
      },
    });
  }

  if (Option.isNone(versionResult.success)) {
    return buildServerProvider({
      presentation: MUSE_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Muse Code is installed but timed out while running `muse --version`.",
      },
    });
  }

  const output = versionResult.success.value;
  const version = parseMuseCliVersion(`${output.stdout}\n${output.stderr}`);
  if (output.code !== 0) {
    return buildServerProvider({
      presentation: MUSE_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: "Muse Code is installed but failed to run.",
      },
    });
  }

  const skills = yield* discoverMuseSkills(museSettings, resolvedEnvironment, cwd);
  const hasApiKey = Boolean(resolvedEnvironment.META_API_KEY?.trim());
  const storedCredential = hasApiKey
    ? ("missing" as const)
    : yield* storedMuseCredentialState(resolvedEnvironment).pipe(
        Effect.orElseSucceed(() => "unknown" as const),
      );
  const isUnauthenticated = !hasApiKey && storedCredential === "missing";
  return buildServerProvider({
    presentation: MUSE_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    skills,
    probe: {
      installed: true,
      version,
      status: isUnauthenticated ? "error" : version ? "ready" : "warning",
      auth: hasApiKey
        ? { status: "authenticated", type: "meta", label: "Meta API key" }
        : storedCredential === "configured"
          ? { status: "authenticated", type: "meta", label: "Meta credentials" }
          : storedCredential === "missing"
            ? { status: "unauthenticated" }
            : { status: "unknown" },
      ...(isUnauthenticated
        ? {
            message:
              "Muse Code is not authenticated. Use Connect to sign in with Meta or enter a Meta API key.",
          }
        : version
          ? {}
          : { message: "Muse Code is installed but its version could not be read." }),
    },
  });
});
