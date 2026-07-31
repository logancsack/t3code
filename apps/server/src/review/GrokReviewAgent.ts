import type { GrokReviewReasoningEffort, GrokSettings } from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess } from "effect/unstable/process";

import { parseGenericCliVersion, spawnAndCollect } from "../provider/providerSnapshot.ts";
import { toJsonSchemaObject } from "../textGeneration/TextGenerationUtils.ts";
import { GrokReviewError } from "@t3tools/contracts";

const DEFAULT_GROK_REVIEW_MODEL = "grok-4.5";
const GROK_AGENT_TIMEOUT_MS = 4 * 60 * 1_000;
const GROK_AGENT_MAX_TURNS = 8;
const GROK_REVIEW_TOOLS = "read_file,list_dir,grep";
const GROK_REVIEW_DENY_RULES = [
  "Read(**/.grok/**)",
  "Read(**/.env)",
  "Read(**/.env.*)",
  "Read(**/.git-credentials)",
  "Read(**/.netrc)",
  "Read(**/.npmrc)",
  "Read(**/.pypirc)",
  "Read(**/*.key)",
  "Read(**/*.pem)",
  "Grep(**/.grok/**)",
  "Grep(**/.env)",
  "Grep(**/.env.*)",
  "Grep(**/.git-credentials)",
  "Grep(**/.netrc)",
  "Grep(**/.npmrc)",
  "Grep(**/.pypirc)",
  "Grep(**/*.key)",
  "Grep(**/*.pem)",
] as const;
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
}

export interface GrokReviewAgent {
  readonly resolvedModel: string;
  readonly grokBuildVersion: string | null;
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
  ).pipe(
    Effect.timeoutOption("5 seconds"),
    Effect.orElseSucceed(() => Option.none()),
  );
  const grokBuildVersion = Option.isSome(versionResult)
    ? parseGenericCliVersion(`${versionResult.value.stdout}\n${versionResult.value.stderr}`)
    : null;

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
        GROK_REVIEW_TOOLS,
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
      ).pipe(
        Effect.timeoutOption(GROK_AGENT_TIMEOUT_MS),
        Effect.mapError(
          (cause) =>
            new GrokReviewError({
              operation: "GrokReviewAgent.run",
              detail: "Failed to start the configured Grok Build reviewer.",
              cause,
            }),
        ),
      );

      if (Option.isNone(result)) {
        return yield* new GrokReviewError({
          operation: "GrokReviewAgent.run",
          detail: "Grok Build review agent timed out.",
        });
      }
      if (result.value.code !== 0) {
        return yield* new GrokReviewError({
          operation: "GrokReviewAgent.run",
          detail: `Grok Build review agent exited with code ${result.value.code}.`,
          cause: result.value.stderr.trim() || undefined,
        });
      }

      const envelope = yield* decodeGrokHeadlessEnvelope(result.value.stdout);
      if (envelope.structuredOutputError) {
        return yield* new GrokReviewError({
          operation: "GrokReviewAgent.decode",
          detail: "Grok Build could not produce the required structured review output.",
          cause: envelope.structuredOutputError,
        });
      }
      if (envelope.structuredOutput === undefined) {
        return yield* new GrokReviewError({
          operation: "GrokReviewAgent.decode",
          detail: "Grok Build returned no structured review output.",
        });
      }
      const decodeOutput = Schema.decodeEffect(request.outputSchema);
      return yield* decodeOutput(envelope.structuredOutput).pipe(
        Effect.mapError(
          (cause) =>
            new GrokReviewError({
              operation: "GrokReviewAgent.decode",
              detail: "Grok Build review output did not match the required schema.",
              cause,
            }),
        ),
      );
    }).pipe(
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
    run,
  } satisfies GrokReviewAgent;
});
