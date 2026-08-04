import type { GrokReviewReasoningEffort, GrokSettings } from "@t3tools/contracts";
import { GrokReviewError } from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess } from "effect/unstable/process";

import { parseGenericCliVersion, spawnAndCollect } from "../provider/providerSnapshot.ts";
import { toJsonSchemaObject } from "../textGeneration/TextGenerationUtils.ts";
import { GROK_REVIEW_SENSITIVE_PATH_GLOBS } from "./GrokReviewPrivacy.ts";

const DEFAULT_GROK_REVIEW_MODEL = "grok-4.5";
export const GROK_AGENT_TIMEOUT_MS = 3 * 60 * 1_000;
/**
 * Grok Build intermittently returns `structuredOutputError` or exits nonzero for
 * a prompt it handles correctly on the next sample. A single such blip used to
 * delete an entire lead reviewer from the swarm for the whole run, so every
 * failure that a fresh sample could plausibly fix is retried against a new
 * subprocess. Retries are bounded by the caller's deadline, never by attempts
 * alone, so a degraded run can never outlive its review budget.
 */
export const GROK_AGENT_MAX_ATTEMPTS = 3;
/** Never start an attempt that cannot plausibly finish before the deadline. */
export const GROK_AGENT_MIN_ATTEMPT_MS = 40 * 1_000;
const GROK_AGENT_RETRY_BASE_DELAY_MS = 1_500;
const GROK_AGENT_MAX_OUTPUT_BYTES = 1_000_000;
const GROK_AGENT_MAX_TURNS = 12;
const GROK_REVIEW_TOOLS = "read_file,list_dir,grep";
const GROK_REVIEW_DENY_RULES = ["Read", "Grep"].flatMap((operation) =>
  GROK_REVIEW_SENSITIVE_PATH_GLOBS.map((glob) => `${operation}(${glob})`),
);
const GrokHeadlessEnvelope = Schema.Struct({
  structuredOutput: Schema.optionalKey(Schema.Unknown),
  structuredOutputError: Schema.optionalKey(Schema.String),
});
const decodeGrokHeadlessEnvelope = Schema.decodeEffect(Schema.fromJsonString(GrokHeadlessEnvelope));
const encodeJsonString = Schema.encodeEffect(Schema.UnknownFromJsonString);
const isGrokReviewError = Schema.is(GrokReviewError);

export interface GrokReviewAgentRequest<S extends Schema.Top> {
  readonly cwd: string;
  readonly prompt: string;
  readonly outputSchema: S;
  readonly effort: GrokReviewReasoningEffort;
  readonly allowTools?: boolean;
  /**
   * Absolute epoch milliseconds this reviewer must finish by, including retries.
   * The swarm derives one per stage so a retrying lead can never starve
   * verification. Omitted means a single attempt bounded by the agent timeout.
   */
  readonly deadline?: number;
  readonly maxAttempts?: number;
}

/** A failure plus whether a fresh sample could plausibly produce a different result. */
interface AgentAttemptFailure {
  readonly error: GrokReviewError;
  readonly retryable: boolean;
}

const retryable = (error: GrokReviewError): AgentAttemptFailure => ({ error, retryable: true });
const terminal = (error: GrokReviewError): AgentAttemptFailure => ({ error, retryable: false });

function isAgentAttemptFailure(value: unknown): value is AgentAttemptFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    "retryable" in value &&
    typeof (value as { retryable: unknown }).retryable === "boolean" &&
    "error" in value &&
    isGrokReviewError((value as { error: unknown }).error)
  );
}

function withAttemptCount(error: GrokReviewError, attempts: number): GrokReviewError {
  if (attempts <= 1) return error;
  return new GrokReviewError({
    operation: error.operation,
    detail: `${error.detail} (after ${attempts} attempts)`,
    ...(error.cause === undefined ? {} : { cause: error.cause }),
  });
}

export interface GrokReviewAgent {
  readonly resolvedModel: string;
  readonly grokBuildVersion: string | null;
  readonly supportsHighEffort?: boolean;
  readonly run: <S extends Schema.Top>(
    request: GrokReviewAgentRequest<S>,
  ) => Effect.Effect<S["Type"], GrokReviewError, S["DecodingServices"]>;
}

export const makeGrokReviewAgent = Effect.fn("makeGrokReviewAgent")(function* (
  grokSettings: GrokSettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const binaryPath = grokSettings.binaryPath || "grok";
  const processEnvironment = {
    ...environment,
    GROK_DISABLE_AUTOUPDATER: "1",
    GROK_SUBAGENTS: "0",
    GROK_WRITE_FILE: "0",
  };

  const versionCommand = yield* resolveSpawnCommand(binaryPath, ["--version"], {
    env: processEnvironment,
  });
  const versionResult = yield* spawnAndCollect(
    binaryPath,
    ChildProcess.make(versionCommand.command, versionCommand.args, {
      env: processEnvironment,
      shell: versionCommand.shell,
    }),
    { maxOutputBytes: 64_000 },
  ).pipe(
    Effect.timeoutOption("5 seconds"),
    Effect.orElseSucceed(() => Option.none()),
  );
  const grokBuildVersion = Option.isSome(versionResult)
    ? parseGenericCliVersion(`${versionResult.value.stdout}\n${versionResult.value.stderr}`)
    : null;

  const runAttempt = <S extends Schema.Top>(
    request: GrokReviewAgentRequest<S>,
    promptPath: string,
    jsonSchema: string,
    attemptTimeoutMs: number,
  ): Effect.Effect<S["Type"], AgentAttemptFailure, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const args = [
        "--cwd",
        request.cwd,
        "--prompt-file",
        promptPath,
        "--json-schema",
        jsonSchema,
        "--model",
        DEFAULT_GROK_REVIEW_MODEL,
        "--reasoning-effort",
        request.effort,
        "--max-turns",
        String(GROK_AGENT_MAX_TURNS),
        "--sandbox",
        "strict",
        "--permission-mode",
        "dontAsk",
        ...GROK_REVIEW_DENY_RULES.flatMap((rule) => ["--deny", rule]),
        "--tools",
        request.allowTools ? GROK_REVIEW_TOOLS : "",
        "--no-memory",
        "--no-subagents",
        "--no-plan",
        "--disable-web-search",
        "--verbatim",
      ];
      const command = yield* resolveSpawnCommand(binaryPath, args, {
        env: processEnvironment,
      });
      const result = yield* spawnAndCollect(
        binaryPath,
        ChildProcess.make(command.command, command.args, {
          cwd: request.cwd,
          env: processEnvironment,
          shell: command.shell,
        }),
        { maxOutputBytes: GROK_AGENT_MAX_OUTPUT_BYTES },
      ).pipe(
        Effect.timeoutOption(attemptTimeoutMs),
        // Spawn failures are usually transient resource exhaustion when four
        // leads start at once, so a fresh attempt is worth one cheap retry.
        Effect.mapError((cause) =>
          retryable(
            new GrokReviewError({
              operation: "GrokReviewAgent.run",
              detail: "Failed to start the configured Grok Build reviewer.",
              cause,
            }),
          ),
        ),
      );

      if (Option.isNone(result)) {
        return yield* Effect.fail(
          retryable(
            new GrokReviewError({
              operation: "GrokReviewAgent.run",
              detail: "Grok Build review agent timed out.",
            }),
          ),
        );
      }
      if (result.value.stdoutTruncated || result.value.stderrTruncated) {
        // Deterministic for a given prompt: the same diff overflows every time,
        // and each retry would burn a full attempt timeout to learn that again.
        return yield* Effect.fail(
          terminal(
            new GrokReviewError({
              operation: "GrokReviewAgent.run",
              detail: "Grok Build reviewer output exceeded the safe collection limit.",
            }),
          ),
        );
      }
      const decodedEnvelope = yield* decodeGrokHeadlessEnvelope(result.value.stdout).pipe(
        Effect.map(Option.some),
        Effect.orElseSucceed(() => Option.none()),
      );
      if (
        Option.isSome(decodedEnvelope) &&
        decodedEnvelope.value.structuredOutputError !== undefined
      ) {
        return yield* Effect.fail(
          retryable(
            new GrokReviewError({
              operation: "GrokReviewAgent.decode",
              detail: "Grok Build could not produce the required structured review output.",
              cause: decodedEnvelope.value.structuredOutputError,
            }),
          ),
        );
      }
      if (result.value.code !== 0) {
        return yield* Effect.fail(
          retryable(
            new GrokReviewError({
              operation: "GrokReviewAgent.run",
              detail: `Grok Build review agent exited with code ${result.value.code}.`,
              cause: result.value.stderr.trim() || undefined,
            }),
          ),
        );
      }

      if (Option.isNone(decodedEnvelope)) {
        return yield* Effect.fail(
          retryable(
            new GrokReviewError({
              operation: "GrokReviewAgent.decode",
              detail: "Grok Build returned an invalid structured-output envelope.",
            }),
          ),
        );
      }
      const envelope = decodedEnvelope.value;
      if (envelope.structuredOutput === undefined) {
        return yield* Effect.fail(
          retryable(
            new GrokReviewError({
              operation: "GrokReviewAgent.decode",
              detail: "Grok Build returned no structured review output.",
            }),
          ),
        );
      }
      const decodeOutput = Schema.decodeEffect(request.outputSchema);
      return yield* decodeOutput(envelope.structuredOutput).pipe(
        Effect.mapError((cause) =>
          retryable(
            new GrokReviewError({
              operation: "GrokReviewAgent.decode",
              detail: "Grok Build review output did not match the required schema.",
              cause,
            }),
          ),
        ),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isAgentAttemptFailure(cause)
          ? cause
          : terminal(
              isGrokReviewError(cause)
                ? cause
                : new GrokReviewError({
                    operation: "GrokReviewAgent.run",
                    detail: "Grok Build review execution failed.",
                    cause,
                  }),
            ),
      ),
    );

  const run = <S extends Schema.Top>(
    request: GrokReviewAgentRequest<S>,
  ): Effect.Effect<S["Type"], GrokReviewError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const tempDirectory = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-grok-review-",
      });
      const promptPath = path.join(tempDirectory, "prompt.md");
      yield* fileSystem.writeFileString(promptPath, request.prompt);
      const jsonSchema = yield* encodeJsonString(toJsonSchemaObject(request.outputSchema));

      const maxAttempts = Math.max(1, request.maxAttempts ?? GROK_AGENT_MAX_ATTEMPTS);
      let lastFailure: GrokReviewError | undefined;
      let attempts = 0;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const remaining =
          request.deadline === undefined
            ? GROK_AGENT_TIMEOUT_MS
            : request.deadline - (yield* Clock.currentTimeMillis);
        if (remaining < GROK_AGENT_MIN_ATTEMPT_MS) {
          // Out of budget. A real failure from an earlier attempt explains the
          // outcome far better than a generic budget message, so prefer it.
          if (lastFailure !== undefined) break;
          return yield* new GrokReviewError({
            operation: "GrokReviewAgent.run",
            detail: "The review budget was exhausted before this reviewer could start.",
          });
        }

        attempts = attempt;
        const outcome = yield* Effect.result(
          runAttempt(request, promptPath, jsonSchema, Math.min(GROK_AGENT_TIMEOUT_MS, remaining)),
        );
        if (outcome._tag === "Success") return outcome.success;

        lastFailure = outcome.failure.error;
        if (!outcome.failure.retryable || attempt === maxAttempts) break;
        yield* Effect.sleep(GROK_AGENT_RETRY_BASE_DELAY_MS * attempt);
      }

      return yield* withAttemptCount(
        lastFailure ??
          new GrokReviewError({
            operation: "GrokReviewAgent.run",
            detail: "Grok Build review execution failed.",
          }),
        attempts,
      );
    }).pipe(
      // Scope setup (temp directory, prompt file, schema encoding) fails outside
      // the attempt loop, so it still needs the canonical error shape.
      Effect.mapError((cause) =>
        isGrokReviewError(cause)
          ? cause
          : new GrokReviewError({
              operation: "GrokReviewAgent.run",
              detail: "Grok Build review execution failed.",
              cause,
            }),
      ),
      Effect.scoped,
    );

  return {
    resolvedModel: DEFAULT_GROK_REVIEW_MODEL,
    grokBuildVersion,
    supportsHighEffort: true,
    run,
  } satisfies GrokReviewAgent;
});
