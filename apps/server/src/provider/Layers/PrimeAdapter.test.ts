// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  PrimeSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { ServerConfig } from "../../config.ts";
import { hasRunningPrimeAgentSubagentsForThread } from "../PrimeAgentActivity.ts";
import { makePrimeAdapter } from "./PrimeAdapter.ts";

const decodePrimeSettings = Schema.decodeSync(PrimeSettings);
const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../../scripts/acp-mock-agent.ts");
const primeInstanceId = ProviderInstanceId.make("primeAgent");

const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-prime-adapter-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

async function makeMockPrimeWrapper(input: {
  readonly argsLogPath: string;
  readonly exitLogPath: string;
  readonly exitDuringPrompt?: boolean;
  readonly exitAfterCreateSession?: boolean;
}): Promise<string> {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "prime-acp-mock-"));
  const wrapperPath = NodePath.join(directory, "prime-agent");
  const script = `#!/bin/sh
export T3_ACP_SUPPORTS_LOAD_SESSION=0
export T3_ACP_EMIT_PRIME_UPDATES=1
export T3_ACP_EXIT_LOG_PATH=${JSON.stringify(input.exitLogPath)}
export T3_ACP_EXIT_DURING_PROMPT=${input.exitDuringPrompt ? "1" : "0"}
export T3_ACP_EXIT_AFTER_CREATE_SESSION=${input.exitAfterCreateSession ? "1" : "0"}
printf '%s\n' '---' "$@" >> ${JSON.stringify(input.argsLogPath)}
exec ${JSON.stringify(process.execPath)} ${JSON.stringify(mockAgentPath)} "$@"
`;
  await NodeFSP.writeFile(wrapperPath, script, "utf8");
  await NodeFSP.chmod(wrapperPath, 0o755);
  return wrapperPath;
}

function parseInvocations(raw: string): ReadonlyArray<ReadonlyArray<string>> {
  return raw
    .split(/^---$/mu)
    .map((section) =>
      section
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean),
    )
    .filter((args) => args.length > 0);
}

it.layer(testLayer)("PrimeAdapter", (it) => {
  it.effect("maps Prime ACP events and continues the stable per-thread session", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("prime-adapter-lifecycle");
      const tempDirectory = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "prime-adapter-lifecycle-")),
      );
      const argsLogPath = NodePath.join(tempDirectory, "args.log");
      const exitLogPath = NodePath.join(tempDirectory, "exit.log");
      const agentDirectory = NodePath.join(tempDirectory, "prime-home");
      const binaryPath = yield* Effect.promise(() =>
        makeMockPrimeWrapper({ argsLogPath, exitLogPath }),
      );
      const adapter = yield* makePrimeAdapter(decodePrimeSettings({ binaryPath }), {
        instanceId: primeInstanceId,
        environment: {
          ...process.env,
          PRIME_AGENT_CODING_AGENT_DIR: agentDirectory,
        },
      }).pipe(Effect.orDie);
      const events: ProviderRuntimeEvent[] = [];
      const eventFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)),
      ).pipe(Effect.forkChild);

      const firstSession = yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.make("primeAgent"),
        providerInstanceId: primeInstanceId,
        cwd: process.cwd(),
        runtimeMode: "full-access",
        modelSelection: { instanceId: primeInstanceId, model: "openai/gpt-prime-mock" },
      });
      const resumeCursor = firstSession.resumeCursor as
        | { readonly schemaVersion: 1; readonly sessionKey: string }
        | undefined;
      assert.equal(resumeCursor?.schemaVersion, 1);
      assert.match(resumeCursor?.sessionKey ?? "", /^[a-f0-9]{64}$/u);

      const invalidReplacement = yield* Effect.flip(
        adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("primeAgent"),
          providerInstanceId: primeInstanceId,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          modelSelection: { instanceId: primeInstanceId, model: "unqualified-model" },
        }),
      );
      assert.equal(invalidReplacement._tag, "ProviderAdapterValidationError");
      assert.isTrue(yield* adapter.hasSession(threadId));

      yield* adapter.sendTurn({ threadId, input: "exercise prime", attachments: [] });
      const eventTypes = events.map((event) => event.type);
      assert.includeMembers(eventTypes, [
        "turn.started",
        "item.started",
        "item.updated",
        "item.completed",
        "content.delta",
        "thread.metadata.updated",
        "turn.completed",
      ]);
      assert.isTrue(
        events.some(
          (event) =>
            event.type === "content.delta" &&
            event.payload.streamKind === "reasoning_text" &&
            event.payload.delta === "prime mock reasoning",
        ),
      );
      assert.isTrue(
        events.some(
          (event) =>
            event.type === "content.delta" && event.payload.delta === "hello from prime mock",
        ),
      );

      const stopped = yield* adapter.stopSession(threadId).pipe(Effect.timeoutOption("3 seconds"));
      assert.equal(stopped._tag, "Some");
      assert.isFalse(hasRunningPrimeAgentSubagentsForThread(threadId, primeInstanceId));

      const resumed = yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.make("primeAgent"),
        providerInstanceId: primeInstanceId,
        cwd: process.cwd(),
        runtimeMode: "full-access",
        modelSelection: { instanceId: primeInstanceId, model: "openai/gpt-prime-mock" },
        resumeCursor,
      });
      assert.deepEqual(resumed.resumeCursor, resumeCursor);
      yield* adapter.stopSession(threadId);
      yield* Fiber.interrupt(eventFiber);

      const invocations = parseInvocations(
        yield* Effect.promise(() => NodeFSP.readFile(argsLogPath, "utf8")),
      );
      assert.lengthOf(invocations, 2);
      const firstArgs = invocations[0] ?? [];
      const secondArgs = invocations[1] ?? [];
      const firstSessionDirectory = firstArgs[firstArgs.indexOf("--session-dir") + 1];
      const secondSessionDirectory = secondArgs[secondArgs.indexOf("--session-dir") + 1];
      assert.include(firstArgs, "--session-dir");
      assert.notInclude(firstArgs, "--continue");
      assert.notInclude(firstArgs, "--resume");
      assert.include(secondArgs, "--continue");
      assert.notInclude(secondArgs, "--resume");
      assert.equal(firstSessionDirectory, secondSessionDirectory);
      assert.equal(
        firstSessionDirectory,
        NodePath.join(agentDirectory, "t3-sessions", resumeCursor?.sessionKey ?? "missing"),
      );
      assert.include(yield* Effect.promise(() => NodeFSP.readFile(exitLogPath, "utf8")), "SIGTERM");
    }).pipe(TestClock.withLive),
  );

  it.effect("rejects supervised runtime modes that Prime ACP cannot honor", () =>
    Effect.gen(function* () {
      const binaryPath = "/unused/prime-agent";
      const adapter = yield* makePrimeAdapter(decodePrimeSettings({ binaryPath }), {
        instanceId: primeInstanceId,
      }).pipe(Effect.orDie);
      const error = yield* Effect.flip(
        adapter.startSession({
          threadId: ThreadId.make("prime-adapter-supervised-mode"),
          provider: ProviderDriverKind.make("primeAgent"),
          providerInstanceId: primeInstanceId,
          cwd: process.cwd(),
          runtimeMode: "approval-required",
        }),
      );
      assert.equal(error._tag, "ProviderAdapterValidationError");
      assert.match(error.message, /requires full-access/u);

      const invalidModelError = yield* Effect.flip(
        adapter.startSession({
          threadId: ThreadId.make("prime-adapter-invalid-model"),
          provider: ProviderDriverKind.make("primeAgent"),
          providerInstanceId: primeInstanceId,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          modelSelection: { instanceId: primeInstanceId, model: "unqualified-model" },
        }),
      );
      assert.equal(invalidModelError._tag, "ProviderAdapterValidationError");
      assert.match(invalidModelError.message, /provider\/model/u);
    }).pipe(TestClock.withLive),
  );

  it.effect("does not advertise ready when the ACP child exits during startup", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("prime-adapter-startup-exit");
      const tempDirectory = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "prime-adapter-startup-exit-")),
      );
      const binaryPath = yield* Effect.promise(() =>
        makeMockPrimeWrapper({
          argsLogPath: NodePath.join(tempDirectory, "args.log"),
          exitLogPath: NodePath.join(tempDirectory, "exit.log"),
          exitAfterCreateSession: true,
        }),
      );
      const adapter = yield* makePrimeAdapter(decodePrimeSettings({ binaryPath }), {
        instanceId: primeInstanceId,
        environment: {
          ...process.env,
          PRIME_AGENT_CODING_AGENT_DIR: NodePath.join(tempDirectory, "prime-home"),
        },
      }).pipe(Effect.orDie);
      const events: ProviderRuntimeEvent[] = [];
      const eventFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)),
      ).pipe(Effect.forkChild);

      const result = yield* adapter
        .startSession({
          threadId,
          provider: ProviderDriverKind.make("primeAgent"),
          providerInstanceId: primeInstanceId,
          cwd: process.cwd(),
          runtimeMode: "full-access",
        })
        .pipe(Effect.exit, Effect.timeoutOption("3 seconds"));
      assert.equal(result._tag, "Some");
      if (result._tag === "Some") assert.equal(result.value._tag, "Failure");
      assert.notInclude(
        events.map((event) => event.type),
        "session.started",
      );
      assert.isFalse(yield* adapter.hasSession(threadId));
      yield* Fiber.interrupt(eventFiber);
    }).pipe(TestClock.withLive),
  );

  it.effect("settles a turn and removes the session when the ACP child dies", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("prime-adapter-process-death");
      const tempDirectory = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "prime-adapter-process-death-")),
      );
      const binaryPath = yield* Effect.promise(() =>
        makeMockPrimeWrapper({
          argsLogPath: NodePath.join(tempDirectory, "args.log"),
          exitLogPath: NodePath.join(tempDirectory, "exit.log"),
          exitDuringPrompt: true,
        }),
      );
      const adapter = yield* makePrimeAdapter(decodePrimeSettings({ binaryPath }), {
        instanceId: primeInstanceId,
        environment: {
          ...process.env,
          PRIME_AGENT_CODING_AGENT_DIR: NodePath.join(tempDirectory, "prime-home"),
        },
      }).pipe(Effect.orDie);
      yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.make("primeAgent"),
        providerInstanceId: primeInstanceId,
        cwd: process.cwd(),
        runtimeMode: "full-access",
      });

      const result = yield* adapter
        .sendTurn({ threadId, input: "exit now", attachments: [] })
        .pipe(Effect.exit, Effect.timeoutOption("3 seconds"));
      assert.isTrue(result._tag === "Some");
      if (result._tag === "Some") assert.isTrue(result.value._tag === "Failure");
      for (let index = 0; index < 8; index += 1) yield* Effect.yieldNow;
      assert.isFalse(yield* adapter.hasSession(threadId));
      assert.isFalse(hasRunningPrimeAgentSubagentsForThread(threadId, primeInstanceId));
    }).pipe(TestClock.withLive),
  );
});
