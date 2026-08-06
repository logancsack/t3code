import type { PrimeSettings } from "@t3tools/contracts";
import { tokenizeCliArgs } from "@t3tools/shared/cliArgs";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

const OWNED_VALUE_FLAGS = new Set([
  "--api-key",
  "--cwd",
  "--fork",
  "--mode",
  "--model",
  "--provider",
  "--resume",
  "-r",
  "--session-dir",
]);
const OWNED_BOOLEAN_FLAGS = new Set(["--continue", "-c", "--no-session", "--print", "-p"]);
const SAFE_BOOLEAN_FLAGS = new Set([
  "--autonomous",
  "--no-builtin-tools",
  "-nbt",
  "--no-context-files",
  "-nc",
  "--no-extensions",
  "-ne",
  "--no-prompt-templates",
  "-np",
  "--no-skills",
  "-ns",
  "--no-themes",
  "--no-tools",
  "-nt",
  "--offline",
  "--verbose",
]);
const SAFE_VALUE_FLAGS = new Set([
  "--append-system-prompt",
  "--autonomous-gate",
  "--autonomous-gate-retries",
  "--autonomous-gate-timeout-ms",
  "--autonomous-max-continuations",
  "--autonomous-max-tokens",
  "--autonomous-max-turns",
  "--autonomous-timeout-ms",
  "--extension",
  "-e",
  "--goal",
  "--goal-token-budget",
  "--models",
  "--prompt-template",
  "--skill",
  "--system-prompt",
  "--theme",
  "--thinking",
  "--tools",
  "-t",
]);

type PrimeAcpRuntimeSettings = Pick<PrimeSettings, "binaryPath" | "launchArgs">;

const PrimeResumeCursor = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  sessionKey: Schema.String,
});
const decodePrimeResumeCursor = Schema.decodeUnknownOption(PrimeResumeCursor);

export type PrimeResumeCursor = typeof PrimeResumeCursor.Type;

export interface PrimeAcpPersistentSession {
  readonly directory: string;
  readonly continueSession: boolean;
}

export type PrimeAcpExecutionProfile = "agentic-session" | "text-generation";

export interface PrimeModelTarget {
  readonly provider: string;
  readonly modelId: string;
}

export interface PrimeAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "resumeSessionId" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly primeSettings: PrimeAcpRuntimeSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
  readonly model?: string | null;
  readonly executionProfile: PrimeAcpExecutionProfile;
  readonly persistentSession?: PrimeAcpPersistentSession;
}

export const makePrimeSessionKey = Effect.fn("makePrimeSessionKey")(function* (
  instanceId: string,
  threadId: string,
) {
  const crypto = yield* Crypto.Crypto;
  const identity = new TextEncoder().encode(`${instanceId}\u0000${threadId}`);
  return Encoding.encodeHex(yield* crypto.digest("SHA-256", identity));
});

export function makePrimeResumeCursor(sessionKey: string): PrimeResumeCursor {
  return { schemaVersion: 1, sessionKey };
}

export function parsePrimeResumeCursor(value: unknown): PrimeResumeCursor | undefined {
  const decoded = Option.getOrUndefined(decodePrimeResumeCursor(value));
  return decoded && /^[a-f0-9]{64}$/u.test(decoded.sessionKey) ? decoded : undefined;
}

export function resolvePrimeAgentDirectory(
  path: Path.Path,
  environment: NodeJS.ProcessEnv,
  fallbackHome: string,
): string {
  const configured = environment.PRIME_AGENT_CODING_AGENT_DIR?.trim();
  if (configured) {
    if (configured === "~" || configured.startsWith("~/")) {
      const home = environment.HOME?.trim() || fallbackHome;
      return configured === "~" ? path.resolve(home) : path.resolve(home, configured.slice(2));
    }
    return path.resolve(configured);
  }
  return path.resolve(environment.HOME?.trim() || fallbackHome, ".prime", "agent");
}

export function resolvePrimeSessionDirectory(
  path: Path.Path,
  agentDirectory: string,
  sessionKey: string,
): string {
  if (!/^[a-f0-9]{64}$/u.test(sessionKey)) {
    throw new TypeError("Prime Agent session keys must be lowercase SHA-256 digests.");
  }
  const sessionRoot = path.resolve(agentDirectory, "t3-sessions");
  const sessionDirectory = path.resolve(sessionRoot, sessionKey);
  if (!sessionDirectory.startsWith(`${sessionRoot}${path.sep}`)) {
    throw new TypeError("Prime Agent session directory escaped its private root.");
  }
  return sessionDirectory;
}

export function parsePrimeModelSlug(
  model: string | null | undefined,
): PrimeModelTarget | undefined {
  const slug = model?.trim();
  if (!slug || slug === "auto") return undefined;
  const separator = slug.indexOf("/");
  if (separator <= 0 || separator === slug.length - 1) return undefined;
  return {
    provider: slug.slice(0, separator),
    modelId: slug.slice(separator + 1),
  };
}

export function formatPrimeModelSlug(provider: string, modelId: string): string {
  return `${provider.trim()}/${modelId.trim()}`;
}

/**
 * Keep instance launch customization while reserving connection-, credential-,
 * cwd-, and model-selection flags for T3. In particular, API keys are never
 * accepted through persisted launch arguments.
 */
export function filterPrimeLaunchArgs(
  launchArgs: string | null | undefined,
): ReadonlyArray<string> {
  const tokens = tokenizeCliArgs(launchArgs ?? "");
  const filtered: Array<string> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    // A positional separator would let later tokens escape T3's owned flag
    // filtering and can inject a startup prompt into an ACP process.
    if (token === "--") break;
    if (OWNED_BOOLEAN_FLAGS.has(token)) continue;
    if (OWNED_VALUE_FLAGS.has(token)) {
      index += 1;
      continue;
    }
    if (
      Array.from(OWNED_VALUE_FLAGS).some((flag) => token.startsWith(`${flag}=`)) ||
      token.startsWith("--api-key=")
    ) {
      continue;
    }
    if (SAFE_BOOLEAN_FLAGS.has(token)) {
      filtered.push(token);
      continue;
    }
    if (SAFE_VALUE_FLAGS.has(token)) {
      const value = tokens[index + 1];
      if (value !== undefined && value !== "--") {
        filtered.push(token, value);
        index += 1;
      }
      continue;
    }
    // Preserve extension-defined long flags without allowing their value to
    // become a positional startup prompt. Public commands, @files, and other
    // bare positional tokens are discarded.
    if (token.startsWith("--")) {
      filtered.push(token);
      if (!token.includes("=")) {
        const value = tokens[index + 1];
        if (value !== undefined && value !== "--" && !value.startsWith("-")) {
          filtered.push(value);
          index += 1;
        }
      }
    }
  }
  return filtered;
}

export function buildPrimeAcpSpawnInput(
  settings: PrimeAcpRuntimeSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
  model?: string | null,
  executionProfile: PrimeAcpExecutionProfile = "agentic-session",
  persistentSession?: PrimeAcpPersistentSession,
): AcpSessionRuntime.AcpSpawnInput {
  const target = parsePrimeModelSlug(model);
  const requestedModel = model?.trim();
  if (requestedModel && requestedModel !== "auto" && !target) {
    throw new TypeError("Prime Agent models must use a provider/model slug.");
  }
  return {
    command: settings?.binaryPath || "prime-agent",
    args: [
      ...(executionProfile === "text-generation"
        ? []
        : filterPrimeLaunchArgs(settings?.launchArgs)),
      "--mode",
      "acp",
      "--cwd",
      cwd,
      ...(executionProfile === "text-generation"
        ? [
            "--no-session",
            "--no-tools",
            "--no-extensions",
            "--no-skills",
            "--no-context-files",
            "--no-themes",
          ]
        : persistentSession
          ? [
              ...(persistentSession.continueSession ? ["--continue"] : []),
              "--session-dir",
              persistentSession.directory,
            ]
          : []),
      ...(target ? ["--provider", target.provider, "--model", target.modelId] : []),
    ],
    cwd,
    ...(environment ? { env: environment } : {}),
  };
}

export const makePrimeAcpRuntime = (
  input: PrimeAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildPrimeAcpSpawnInput(
          input.primeSettings,
          input.cwd,
          input.environment,
          input.model,
          input.executionProfile,
          input.persistentSession,
        ),
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
  });
