import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopObservability from "./DesktopObservability.ts";

const DesktopBackendChildLogRecord = Schema.Struct({
  message: Schema.String,
  level: Schema.Literals(["INFO", "ERROR"]),
  timestamp: Schema.String,
  annotations: Schema.Record(Schema.String, Schema.Unknown),
  spans: Schema.Record(Schema.String, Schema.Unknown),
  fiberId: Schema.String,
});

const decodeDesktopBackendChildLogRecord = Schema.decodeEffect(
  Schema.fromJsonString(DesktopBackendChildLogRecord),
);

const environmentInput = (baseDir: string) =>
  ({
    dirname: "/repo/apps/desktop/dist-electron",
    homeDirectory: baseDir,
    platform: "darwin",
    processArch: "arm64",
    appVersion: "1.2.3",
    appPath: "/repo",
    isPackaged: false,
    resourcesPath: "/repo/resources",
    runningUnderArm64Translation: false,
  }) satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const makeEnvironmentLayer = (
  baseDir: string,
  isDevelopment = true,
  env: Readonly<Record<string, string | undefined>> = {},
) =>
  DesktopEnvironment.layer(environmentInput(baseDir)).pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        DesktopConfig.layerTest({
          T3CODE_HOME: baseDir,
          VITE_DEV_SERVER_URL: isDevelopment ? "http://127.0.0.1:5733" : undefined,
          ...env,
        }),
      ),
    ),
  );

const emptyEnv = ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }));

it.effect("retains only the last mebibyte of backend child output", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-desktop-backend-output-bound-test-",
    });
    const environmentLayer = makeEnvironmentLayer(baseDir, false);
    const logPath = yield* Effect.gen(function* () {
      const environment = yield* DesktopEnvironment.DesktopEnvironment;
      return environment.path.join(environment.logDir, "server-child.log");
    }).pipe(Effect.provide(environmentLayer));
    const maxBufferedBytes = 1024 * 1024;
    const discardedPrefixBytes = 128;
    const output = new Uint8Array(maxBufferedBytes + discardedPrefixBytes);
    output.fill("x".charCodeAt(0));
    output.fill("y".charCodeAt(0), 0, discardedPrefixBytes);

    yield* Effect.scoped(
      Effect.gen(function* () {
        const factory = yield* DesktopObservability.DesktopBackendOutputLogFactory;
        const outputLog = yield* factory.forInstance("primary");
        yield* outputLog.beginSession({ details: "pid=123" });
        yield* outputLog.writeOutputChunk("stderr", output);
        yield* outputLog.writeOutputChunk(
          "stdout",
          new TextEncoder().encode("z".repeat(maxBufferedBytes / 2)),
        );
        yield* outputLog.persistFailure({ details: "code=1" });
      }).pipe(
        Effect.provide(DesktopObservability.layer.pipe(Layer.provideMerge(environmentLayer))),
      ),
    );

    const lines = (yield* fileSystem.readFileString(logPath)).trimEnd().split("\n");
    const records = yield* Effect.forEach(lines, (line) =>
      decodeDesktopBackendChildLogRecord(line),
    );
    const retained = records.filter((record) => typeof record.annotations.text === "string");
    assert.deepEqual(
      retained.map((record) => record.annotations.stream),
      ["stderr", "stdout"],
    );
    assert.deepEqual(
      retained.map((record) => record.annotations.text),
      ["x".repeat(maxBufferedBytes / 2), "z".repeat(maxBufferedBytes / 2)],
    );
  }).pipe(
    Effect.scoped,
    Effect.provide(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerUndici, emptyEnv)),
  ),
);
