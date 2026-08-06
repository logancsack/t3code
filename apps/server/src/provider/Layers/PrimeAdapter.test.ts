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
import * as Deferred from "effect/Deferred";
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
  readonly emitPrimeUpdates?: boolean;
  readonly hangFirstPromptForever?: boolean;
  readonly requestLogPath?: string;
}): Promise<string> {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "prime-acp-mock-"));
  const wrapperPath = NodePath.join(directory, "prime-agent");
  const script = `#!/bin/sh
export T3_ACP_SUPPORTS_LOAD_SESSION=0
export T3_ACP_EMIT_PRIME_UPDATES=${input.emitPrimeUpdates === false ? "0" : "1"}
export T3_ACP_EXIT_LOG_PATH=${JSON.stringify(input.exitLogPath)}
export T3_ACP_EXIT_DURING_PROMPT=${input.exitDuringPrompt ? "1" : "0"}
export T3_ACP_EXIT_AFTER_CREATE_SESSION=${input.exitAfterCreateSession ? "1" : "0"}
export T3_ACP_HANG_FIRST_PROMPT_FOREVER=${input.hangFirstPromptForever ? "1" : "0"}
export T3_ACP_REQUEST_LOG_PATH=${JSON.stringify(input.requestLogPath ?? "")}
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function primeSubagentStatuses(events: ReadonlyArray<ProviderRuntimeEvent>): Array<string> {
  return events.flatMap((event) => {
    if (event.type !== "thread.metadata.updated") return [];
    const primeAgent = event.payload.metadata?.primeAgent;
    if (!isRecord(primeAgent) || !Array.isArray(primeAgent.subagents)) return [];
    return primeAgent.subagents.flatMap((subagent) =>
      isRecord(subagent) && typeof subagent.status === "string" ? [subagent.status] : [],
    );
  });
}

const waitForFileContent = Effect.fn("waitForFileContent")(function* (
  filePath: string,
  attempts = 40,
  expectedContent?: string,
) {
  for (let remainingAttempts = attempts; remainingAttempts > 0; remainingAttempts -= 1) {
    const raw = yield* Effect.tryPromise(() => NodeFSP.readFile(filePath, "utf8")).pipe(
      Effect.orElseSucceed(() => ""),
    );
    if (raw.trim().length > 0 && (expectedContent === undefined || raw.includes(expectedContent))) {
      return raw;
    }
    yield* Effect.sleep("25 millis");
  }

  return yield* Effect.die(new Error(`Timed out waiting for file content at ${filePath}`));
});

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
      const subagentDone = yield* Deferred.make<void>();
      const eventFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.gen(function* () {
          events.push(event);
          if (primeSubagentStatuses([event]).includes("done")) {
            yield* Deferred.succeed(subagentDone, undefined).pipe(Effect.ignore);
          }
        }),
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
      for (let index = 0; index < 8; index += 1) yield* Effect.yieldNow;
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
      assert.include(primeSubagentStatuses(events), "running");
      yield* Deferred.await(subagentDone).pipe(Effect.timeout("2 seconds"));
      for (let index = 0; index < 8; index += 1) yield* Effect.yieldNow;
      assert.include(primeSubagentStatuses(events), "done");
      assert.isFalse(hasRunningPrimeAgentSubagentsForThread(threadId, primeInstanceId));

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

  it.effect("settles an interrupted sendTurn once and accepts a follow-up", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("prime-adapter-send-turn-interruption");
      const tempDirectory = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "prime-adapter-send-turn-interruption-")),
      );
      const requestLogPath = NodePath.join(tempDirectory, "requests.ndjson");
      const binaryPath = yield* Effect.promise(() =>
        makeMockPrimeWrapper({
          argsLogPath: NodePath.join(tempDirectory, "args.log"),
          exitLogPath: NodePath.join(tempDirectory, "exit.log"),
          emitPrimeUpdates: false,
          hangFirstPromptForever: true,
          requestLogPath,
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

      yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.make("primeAgent"),
        providerInstanceId: primeInstanceId,
        cwd: process.cwd(),
        runtimeMode: "full-access",
      });
      const firstSendTurnFiber = yield* adapter
        .sendTurn({ threadId, input: "interrupt this prompt", attachments: [] })
        .pipe(Effect.forkChild);
      yield* waitForFileContent(requestLogPath, 80, '"method":"session/prompt"');
      yield* Fiber.interrupt(firstSendTurnFiber);
      for (let index = 0; index < 8; index += 1) yield* Effect.yieldNow;

      const firstTurnStarted = events.find(
        (event) => event.type === "turn.started" && event.threadId === threadId,
      );
      assert.isDefined(firstTurnStarted?.turnId);
      const firstTurnCompleted = events.filter(
        (event): event is Extract<ProviderRuntimeEvent, { type: "turn.completed" }> =>
          event.type === "turn.completed" &&
          event.threadId === threadId &&
          event.turnId === firstTurnStarted?.turnId,
      );
      assert.lengthOf(firstTurnCompleted, 1);
      assert.equal(firstTurnCompleted[0]?.payload.state, "failed");
      const interruptedSession = (yield* adapter.listSessions()).find(
        (session) => session.threadId === threadId,
      );
      assert.equal(interruptedSession?.status, "error");
      assert.isUndefined(interruptedSession?.activeTurnId);

      const followUp = yield* adapter
        .sendTurn({ threadId, input: "complete the follow-up", attachments: [] })
        .pipe(Effect.timeout("2 seconds"));
      for (let index = 0; index < 8; index += 1) yield* Effect.yieldNow;
      assert.notEqual(followUp.turnId, firstTurnStarted?.turnId);
      assert.lengthOf(
        events.filter(
          (event) =>
            event.type === "turn.completed" &&
            event.threadId === threadId &&
            event.turnId === firstTurnStarted?.turnId,
        ),
        1,
      );
      const followUpCompleted = events.filter(
        (event): event is Extract<ProviderRuntimeEvent, { type: "turn.completed" }> =>
          event.type === "turn.completed" &&
          event.threadId === threadId &&
          event.turnId === followUp.turnId,
      );
      assert.lengthOf(followUpCompleted, 1);
      assert.equal(followUpCompleted[0]?.payload.state, "completed");
      const recoveredSession = (yield* adapter.listSessions()).find(
        (session) => session.threadId === threadId,
      );
      assert.equal(recoveredSession?.status, "ready");
      assert.isUndefined(recoveredSession?.lastError);
      const requestMethods = (yield* Effect.promise(() => NodeFSP.readFile(requestLogPath, "utf8")))
        .split(/\r?\n/u)
        .filter(Boolean)
        .flatMap((line) => {
          const message: unknown = JSON.parse(line);
          return isRecord(message) && typeof message.method === "string" ? [message.method] : [];
        })
        .filter((method) => method === "session/prompt" || method === "session/cancel");
      assert.deepEqual(requestMethods, ["session/prompt", "session/cancel", "session/prompt"]);

      yield* Fiber.interrupt(eventFiber);
      yield* adapter.stopSession(threadId);
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
