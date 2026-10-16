import * as NodeCrypto from "node:crypto";
import * as NodeUtil from "node:util";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as References from "effect/References";

import * as ServerConfig from "../config.ts";
import * as Identify from "./Identify.ts";

interface CapturedLog {
  readonly message: unknown;
  readonly annotations: Readonly<Record<string, unknown>>;
}

const sha256 = (value: string) =>
  NodeCrypto.createHash("sha256").update(value, "utf8").digest("hex");

const makeCaptureLogger = (logs: CapturedLog[]) =>
  Logger.make(({ fiber, message }) => {
    logs.push({
      message,
      annotations: fiber.getRef(References.CurrentLogAnnotations),
    });
  });

it.layer(NodeServices.layer)("telemetry identity", (it) => {
  it.effect("logs structured decode context and falls back from malformed Codex auth", () => {
    const logs: CapturedLog[] = [];
    const logger = makeCaptureLogger(logs);

    return Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homeDirectory = path.join(config.baseDir, "home");
      const codexAuthPath = path.join(homeDirectory, ".codex", "auth.json");
      const anonymousId = "decode-fallback-anonymous-id";
      const privateAccessToken = "private-codex-access-token";

      yield* fileSystem.makeDirectory(path.dirname(codexAuthPath), { recursive: true });
      yield* fileSystem.writeFileString(
        codexAuthPath,
        `{"tokens":{"access_token":"${privateAccessToken}"}}`,
      );
      yield* fileSystem.writeFileString(config.anonymousIdPath, anonymousId);

      const identifier = yield* Identify.getTelemetryIdentifierForHome(homeDirectory);

      assert.equal(identifier, sha256(anonymousId));
      const decodeLog = logs.find(
        (log) =>
          log.annotations.source === "codex" &&
          log.annotations.errorTag === "TelemetryIdentityDecodeError",
      );
      assert.isDefined(decodeLog);
      assert.equal(
        decodeLog?.message,
        `Failed to decode codex telemetry identity at '${codexAuthPath}'.`,
      );

      assert.equal(decodeLog?.annotations.filePath, codexAuthPath);
      assert.equal(decodeLog?.annotations.causeKind, "schema");
      assert.notProperty(decodeLog?.annotations ?? {}, "cause");
      const errorStack = decodeLog?.annotations.errorStack;
      assert.isString(errorStack);
      assert.include(errorStack, "Failed to decode codex telemetry identity");
      assert.notInclude(NodeUtil.inspect(logs, { depth: null }), privateAccessToken);
    }).pipe(
      Effect.provide(
        Layer.merge(
          ServerConfig.layerTest(process.cwd(), {
            prefix: "t3-telemetry-identify-decode-",
          }),
          Logger.layer([logger], { mergeWithExisting: false }),
        ),
      ),
    );
  });
});
