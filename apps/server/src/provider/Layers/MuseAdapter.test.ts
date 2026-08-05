// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { describe, expect, it } from "@effect/vitest";
import { MuseSettings, ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { ServerConfig } from "../../config.ts";
import type { MuseAdapterShape } from "../Services/MuseAdapter.ts";
import { buildMuseExecArgs, makeMuseAdapter } from "./MuseAdapter.ts";

const MUSE = ProviderDriverKind.make("muse");
const MUSE_INSTANCE = ProviderInstanceId.make("muse");
const MUSE_MODEL = "muse-spark-1.2";
const decodeMuseSettings = Schema.decodeSync(MuseSettings);
const encodeUnknownJson = Schema.encodeUnknownSync(Schema.UnknownFromJsonString);

type CapturedCommand = {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly options: {
    readonly cwd?: string | undefined;
    readonly env?: NodeJS.ProcessEnv | undefined;
    readonly shell?: boolean | string | undefined;
    readonly stdin?: string | undefined;
  };
};

function captureStandardCommand(command: ChildProcess.Command): CapturedCommand {
  if (!ChildProcess.isStandardCommand(command)) {
    throw new Error("Expected Muse to spawn a standard child process.");
  }
  return command as unknown as CapturedCommand;
}

function makeHandle(input?: {
  readonly stdout?: string | undefined;
  readonly stderr?: string | undefined;
  readonly exitCode?: Effect.Effect<ChildProcessSpawner.ExitCode> | undefined;
  readonly onKill?: (() => Effect.Effect<void>) | undefined;
}) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(501),
    exitCode: input?.exitCode ?? Effect.succeed(ChildProcessSpawner.ExitCode(0)),
    isRunning: Effect.succeed(false),
    kill: () => input?.onKill?.() ?? Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.encodeText(Stream.make(input?.stdout ?? "")),
    stderr: Stream.encodeText(Stream.make(input?.stderr ?? "")),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function mockSpawner(
  spawn: (command: CapturedCommand) => Effect.Effect<ChildProcessSpawner.ChildProcessHandle>,
) {
  return ChildProcessSpawner.make((command) => spawn(captureStandardCommand(command)));
}

function provideMuseTestServices<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
) {
  const platformServices = Layer.mergeAll(
    NodeCrypto.layer,
    NodeFileSystem.layer,
    NodePath.layer,
    Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
  );
  const testServices = ServerConfig.layerTest(process.cwd(), {
    prefix: "t3code-muse-adapter-test-",
  }).pipe(Layer.provideMerge(platformServices));
  return effect.pipe(Effect.provide(testServices));
}

function museEvent(
  payloadType: string,
  payload: Record<string, unknown>,
  sequence: number,
): string {
  return encodeUnknownJson({
    schema_version: 1,
    id: `event-${sequence}`,
    stream: { kind: "session", id: "muse-session-test" },
    sequence,
    recorded_at: 1_780_531_400_000_000 + sequence,
    record_type: "status",
    durability: "ephemeral",
    payload_type: payloadType,
    payload_schema_version: 1,
    payload,
  });
}

function completedOutput(text: string): string {
  return [
    museEvent("run.output.delta", { kind: "run_output_delta", text }, 1),
    museEvent(
      "run.terminal.completed",
      { kind: "run_terminal", terminal: "completed", text, reason: null },
      2,
    ),
    "",
  ].join("\n");
}

const startMuseSession = (
  adapter: MuseAdapterShape,
  threadId: ThreadId,
  input?: {
    readonly runtimeMode?: "approval-required" | "auto" | "full-access";
    readonly approvalPolicy?: "on-request" | "never";
    readonly sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
    readonly resumeCursor?: unknown;
  },
) =>
  adapter.startSession({
    threadId,
    provider: MUSE,
    providerInstanceId: MUSE_INSTANCE,
    cwd: process.cwd(),
    runtimeMode: input?.runtimeMode ?? "auto",
    approvalPolicy: input?.approvalPolicy,
    sandboxMode: input?.sandboxMode,
    resumeCursor: input?.resumeCursor,
    modelSelection: { instanceId: MUSE_INSTANCE, model: MUSE_MODEL },
  });

describe("buildMuseExecArgs", () => {
  const base = {
    sessionId: "muse-session-1",
    cwd: "/workspace/project",
    promptFile: "/tmp/prompt.md",
    model: MUSE_MODEL,
    reasoningEffort: "high",
    imagePaths: [] as ReadonlyArray<string>,
  };

  it("maps managed runtime modes to exact Muse safety arguments", () => {
    expect(
      buildMuseExecArgs({
        ...base,
        runtimeMode: "approval-required",
        approvalPolicy: "on-request",
        sandboxMode: "workspace-write",
      }),
    ).toEqual([
      "exec",
      "--json",
      "--provider",
      "meta",
      "--session-id",
      "muse-session-1",
      "--workspace",
      "/workspace/project",
      "--prompt-file",
      "/tmp/prompt.md",
      "--model",
      MUSE_MODEL,
      "--reasoning-effort",
      "high",
      "--parallel-tool-calls",
      "--trust-workspace",
      "--disable-approval",
      "--disable-write",
      "--disable-shell",
    ]);

    expect(
      buildMuseExecArgs({
        ...base,
        runtimeMode: "full-access",
      }).slice(-1),
    ).toEqual(["--yolo"]);

    expect(
      buildMuseExecArgs({
        ...base,
        runtimeMode: "auto",
        sandboxMode: "danger-full-access",
      }).slice(-2),
    ).toEqual(["--trust-workspace", "--disable-approval"]);
  });

  it("makes runtime mode authoritative over contradictory low-level policies", () => {
    const approvalRequiredArgs = buildMuseExecArgs({
      ...base,
      runtimeMode: "approval-required",
      approvalPolicy: "never",
      sandboxMode: "danger-full-access",
    });
    expect(approvalRequiredArgs).toContain("--disable-write");
    expect(approvalRequiredArgs).toContain("--disable-shell");
    expect(approvalRequiredArgs).not.toContain("--disable-sandbox");
    expect(approvalRequiredArgs).not.toContain("--yolo");

    const automaticArgs = buildMuseExecArgs({
      ...base,
      runtimeMode: "auto",
      approvalPolicy: "never",
      sandboxMode: "danger-full-access",
    });
    expect(automaticArgs).toContain("--disable-approval");
    expect(automaticArgs).not.toContain("--disable-sandbox");
    expect(automaticArgs).not.toContain("--yolo");
  });

  it("keeps plan mode read-only even when the session and launch args allow full access", () => {
    const args = buildMuseExecArgs({
      ...base,
      runtimeMode: "full-access",
      interactionMode: "plan",
      sandboxMode: "danger-full-access",
      launchArgs: "--yolo --disable-sandbox --max-model-steps=12",
    });

    expect(args).toContain("--disable-write");
    expect(args).toContain("--disable-shell");
    expect(args).toEqual(expect.arrayContaining(["--max-model-steps", "12"]));
    expect(args).not.toContain("--yolo");
    expect(args).not.toContain("--disable-sandbox");
  });

  it("allowlists tuning args and drops managed, stateful, and unknown launch args", () => {
    const args = buildMuseExecArgs({
      ...base,
      runtimeMode: "approval-required",
      launchArgs: [
        "--max-model-steps 8",
        "--max-tool-output-bytes=4096",
        "--context-compaction-soft-threshold .7",
        "--disable-web-tools",
        "--yolo",
        "--disable-sandbox",
        "--sandbox-network enabled",
        "--worktree create",
        "--base-url https://example.invalid",
        "--workspace /",
        "--prompt-file /tmp/unmanaged-prompt",
        "--future-unsafe-option yes",
      ].join(" "),
    });

    expect(args).toEqual(
      expect.arrayContaining([
        "--max-model-steps",
        "8",
        "--max-tool-output-bytes",
        "4096",
        "--context-compaction-soft-threshold",
        ".7",
        "--disable-web-tools",
      ]),
    );
    expect(args).not.toContain("--yolo");
    expect(args).not.toContain("--disable-sandbox");
    expect(args).not.toContain("--sandbox-network");
    expect(args).not.toContain("--worktree");
    expect(args).not.toContain("--base-url");
    expect(args).not.toContain("--future-unsafe-option");
    expect(args.filter((arg) => arg === "--workspace")).toHaveLength(1);
    expect(args[args.indexOf("--workspace") + 1]).toBe(base.cwd);
    expect(args.filter((arg) => arg === "--prompt-file")).toHaveLength(1);
    expect(args[args.indexOf("--prompt-file") + 1]).toBe(base.promptFile);
  });
});

describe("MuseAdapter", () => {
  it.effect("starts and resumes a stable Muse session id", () =>
    Effect.scoped(
      provideMuseTestServices(
        Effect.gen(function* () {
          const adapter = yield* makeMuseAdapter(
            decodeMuseSettings({ binaryPath: process.execPath }),
          );
          const threadId = ThreadId.make("muse-session-id-test");
          const eventsFiber = yield* adapter.streamEvents.pipe(
            Stream.filter((event) => event.threadId === threadId),
            Stream.take(3),
            Stream.runCollect,
            Effect.forkChild,
          );
          yield* Effect.yieldNow;

          const session = yield* startMuseSession(adapter, threadId, {
            resumeCursor: { schemaVersion: 1, sessionId: "resume-session-42" },
          });
          const events = Array.from(yield* Fiber.join(eventsFiber));

          expect(session.provider).toBe("muse");
          expect(session.providerInstanceId).toBe("muse");
          expect(session.resumeCursor).toEqual({
            schemaVersion: 1,
            sessionId: "resume-session-42",
          });
          expect(events.map((event) => event.type)).toEqual([
            "session.started",
            "session.state.changed",
            "thread.started",
          ]);
          expect(events[2]).toMatchObject({
            type: "thread.started",
            payload: { providerThreadId: "resume-session-42" },
          });
        }),
        mockSpawner(() => Effect.die("spawn should not run while starting a session")),
      ),
    ),
  );

  it.effect("spawns managed Muse exec args and streams JSONL as canonical events", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let spawned: CapturedCommand | undefined;
        let prompt = "";
        const stdout = [
          museEvent("run.reasoning.delta", { text: "considering" }, 1),
          museEvent(
            "task.lifecycle.proposed",
            {
              task_id: "shell-1",
              event: { kind: "proposed", task_id: "shell-1", task_kind: "tool.bash" },
            },
            2,
          ),
          museEvent(
            "task.lifecycle.side_effect_intent",
            {
              task_id: "shell-1",
              event: { kind: "side_effect_intent", task_id: "shell-1", operation: "tool.bash" },
            },
            3,
          ),
          museEvent(
            "task.lifecycle.started",
            { task_id: "shell-1", event: { kind: "started", task_id: "shell-1" } },
            4,
          ),
          museEvent(
            "task.lifecycle.output",
            {
              task_id: "shell-1",
              event: {
                kind: "output",
                task_id: "shell-1",
                chunk: encodeUnknownJson({ output: "tests passed" }),
              },
            },
            5,
          ),
          museEvent(
            "task.lifecycle.completed",
            { task_id: "shell-1", event: { kind: "completed", task_id: "shell-1" } },
            6,
          ),
          museEvent(
            "task.lifecycle.proposed",
            {
              task_id: "shell-timeout",
              event: { kind: "proposed", task_id: "shell-timeout", task_kind: "tool.bash" },
            },
            7,
          ),
          museEvent(
            "task.lifecycle.timed_out",
            { task_id: "shell-timeout", event: { kind: "timed_out", task_id: "shell-timeout" } },
            8,
          ),
          museEvent("run.output.delta", { text: "Implemented safely." }, 9),
          museEvent(
            "run.terminal.completed",
            { terminal: "completed", text: "Implemented safely.", reason: null },
            10,
          ),
          "",
        ].join("\n");
        const spawner = mockSpawner((command) =>
          Effect.sync(() => {
            spawned = command;
            const promptIndex = command.args.indexOf("--prompt-file");
            prompt = NodeFS.readFileSync(command.args[promptIndex + 1]!, "utf8");
            return makeHandle({ stdout });
          }),
        );

        yield* provideMuseTestServices(
          Effect.gen(function* () {
            const config = yield* ServerConfig;
            const path = yield* Path.Path;
            const threadId = ThreadId.make("muse-streaming-test");
            const adapter = yield* makeMuseAdapter(
              decodeMuseSettings({
                binaryPath: process.execPath,
                launchArgs: "--disable-web-tools --max-model-steps 12",
              }),
              { environment: { META_API_KEY: "test-secret" } },
            );
            const eventsFiber = yield* adapter.streamEvents.pipe(
              Stream.filter((event) => event.threadId === threadId),
              Stream.takeUntil((event) => event.type === "turn.completed"),
              Stream.runCollect,
              Effect.forkChild,
            );
            yield* Effect.yieldNow;
            yield* startMuseSession(adapter, threadId, {
              runtimeMode: "approval-required",
              approvalPolicy: "on-request",
              sandboxMode: "workspace-write",
              resumeCursor: { schemaVersion: 1, sessionId: "managed-session-7" },
            });

            const imageId = "image-1";
            const fileId = "file-1";
            const result = yield* adapter.sendTurn({
              threadId,
              input: "Inspect these attachments.",
              attachments: [
                {
                  type: "image",
                  id: imageId,
                  name: "screen.png",
                  mimeType: "image/png",
                  sizeBytes: 10,
                },
                {
                  type: "file",
                  id: fileId,
                  name: "notes.md",
                  mimeType: "text/markdown",
                  sizeBytes: 20,
                },
              ],
              modelSelection: {
                instanceId: MUSE_INSTANCE,
                model: MUSE_MODEL,
                options: [{ id: "reasoningEffort", value: "ultra" }],
              },
            });
            const events = Array.from(yield* Fiber.join(eventsFiber));
            const imagePath = path.resolve(config.attachmentsDir, `${imageId}.png`);
            const filePath = path.resolve(config.attachmentsDir, `${fileId}.md`);
            const promptFile = spawned?.args[spawned.args.indexOf("--prompt-file") + 1];

            expect(result.resumeCursor).toEqual({
              schemaVersion: 1,
              sessionId: "managed-session-7",
            });
            expect(spawned?.command).toBe(process.execPath);
            expect(spawned?.args).toEqual([
              "exec",
              "--disable-web-tools",
              "--max-model-steps",
              "12",
              "--json",
              "--provider",
              "meta",
              "--session-id",
              "managed-session-7",
              "--workspace",
              process.cwd(),
              "--prompt-file",
              promptFile,
              "--model",
              MUSE_MODEL,
              "--reasoning-effort",
              "ultra",
              "--parallel-tool-calls",
              "--trust-workspace",
              "--disable-approval",
              "--disable-write",
              "--disable-shell",
              "--image",
              imagePath,
            ]);
            expect(spawned?.options).toMatchObject({
              cwd: process.cwd(),
              shell: false,
              stdin: "ignore",
              env: {
                META_API_KEY: "test-secret",
                MUSE_NO_AUTO_UPDATE: "1",
              },
            });
            expect(prompt).toBe(
              `Inspect these attachments.\n\nThe user attached file "notes.md" at path: ${filePath}`,
            );

            expect(events.map((event) => event.type)).toEqual(
              expect.arrayContaining([
                "session.started",
                "thread.started",
                "turn.started",
                "item.started",
                "item.updated",
                "content.delta",
                "item.completed",
                "turn.completed",
              ]),
            );
            expect(
              events
                .filter((event) => event.type === "content.delta")
                .map((event) => [event.payload.streamKind, event.payload.delta]),
            ).toEqual([
              ["reasoning_text", "considering"],
              ["assistant_text", "Implemented safely."],
            ]);
            expect(
              events.find(
                (event) =>
                  event.type === "item.updated" && event.payload.itemType === "command_execution",
              ),
            ).toMatchObject({ payload: { detail: "tests passed", status: "inProgress" } });
            expect(
              events.find(
                (event) =>
                  event.type === "item.completed" &&
                  event.payload.detail === "Muse tool timed out.",
              ),
            ).toMatchObject({ payload: { status: "failed" } });
            expect(events.find((event) => event.type === "content.delta")?.raw?.source).toBe(
              "muse.exec.event",
            );
            expect(events.at(-1)).toMatchObject({
              type: "turn.completed",
              payload: { state: "completed" },
            });
          }),
          spawner,
        );
      }),
    ),
  );

  it.effect("emits a proposed plan and uses a read-only planning prompt", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let spawned: CapturedCommand | undefined;
        let prompt = "";
        const spawner = mockSpawner((command) =>
          Effect.sync(() => {
            spawned = command;
            const promptIndex = command.args.indexOf("--prompt-file");
            prompt = NodeFS.readFileSync(command.args[promptIndex + 1]!, "utf8");
            return makeHandle({ stdout: completedOutput("1. Inspect\n2. Implement") });
          }),
        );

        yield* provideMuseTestServices(
          Effect.gen(function* () {
            const adapter = yield* makeMuseAdapter(
              decodeMuseSettings({ binaryPath: process.execPath }),
            );
            const threadId = ThreadId.make("muse-plan-test");
            const eventsFiber = yield* adapter.streamEvents.pipe(
              Stream.filter((event) => event.threadId === threadId),
              Stream.takeUntil((event) => event.type === "turn.completed"),
              Stream.runCollect,
              Effect.forkChild,
            );
            yield* Effect.yieldNow;
            yield* startMuseSession(adapter, threadId, {
              runtimeMode: "full-access",
              resumeCursor: { schemaVersion: 1, sessionId: "plan-session" },
            });
            yield* adapter.sendTurn({
              threadId,
              input: "Add the feature",
              attachments: [],
              interactionMode: "plan",
            });
            const events = Array.from(yield* Fiber.join(eventsFiber));

            expect(prompt).toBe(
              [
                "Planning mode is active. Investigate as needed, then return a concrete implementation plan.",
                "Do not modify files or perform other state-changing actions.",
                "",
                "Add the feature",
              ].join("\n"),
            );
            expect(spawned?.args).toContain("--disable-write");
            expect(spawned?.args).toContain("--disable-shell");
            expect(spawned?.args).not.toContain("--yolo");
            expect(
              events
                .filter((event) => event.type === "turn.proposed.delta")
                .map((event) => (event.type === "turn.proposed.delta" ? event.payload.delta : "")),
            ).toEqual(["1. Inspect\n2. Implement"]);
            expect(events.find((event) => event.type === "turn.proposed.completed")).toMatchObject({
              payload: { planMarkdown: "1. Inspect\n2. Implement" },
            });
            expect(
              events.some(
                (event) =>
                  event.type === "content.delta" && event.payload.streamKind === "assistant_text",
              ),
            ).toBe(false);
          }),
          spawner,
        );
      }),
    ),
  );

  it.effect("queues a follow-up turn without overlapping Muse processes for one session", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstExit = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
        const secondExit = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
        const firstSpawned = yield* Deferred.make<void>();
        const secondSpawned = yield* Deferred.make<void>();
        const secondSendStarted = yield* Deferred.make<void>();
        const commands: CapturedCommand[] = [];
        let activeProcesses = 0;
        let maxActiveProcesses = 0;

        const spawner = mockSpawner((command) =>
          Effect.gen(function* () {
            const spawnIndex = commands.length;
            commands.push(command);
            activeProcesses += 1;
            maxActiveProcesses = Math.max(maxActiveProcesses, activeProcesses);
            yield* Deferred.succeed(
              spawnIndex === 0 ? firstSpawned : secondSpawned,
              undefined,
            ).pipe(Effect.ignore);
            const processExit = spawnIndex === 0 ? firstExit : secondExit;
            return makeHandle({
              stdout: completedOutput(spawnIndex === 0 ? "first complete" : "second complete"),
              exitCode: Deferred.await(processExit).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    activeProcesses -= 1;
                  }),
                ),
              ),
            });
          }),
        );

        yield* provideMuseTestServices(
          Effect.gen(function* () {
            const adapter = yield* makeMuseAdapter(
              decodeMuseSettings({ binaryPath: process.execPath }),
            );
            const threadId = ThreadId.make("muse-queued-turn-test");
            yield* startMuseSession(adapter, threadId, {
              resumeCursor: { schemaVersion: 1, sessionId: "serialized-session" },
            });

            const firstTurnFiber = yield* adapter
              .sendTurn({ threadId, input: "first", attachments: [] })
              .pipe(Effect.forkChild);
            yield* Deferred.await(firstSpawned);
            const secondTurnFiber = yield* Effect.gen(function* () {
              yield* Deferred.succeed(secondSendStarted, undefined).pipe(Effect.ignore);
              return yield* adapter.sendTurn({ threadId, input: "second", attachments: [] });
            }).pipe(Effect.forkChild);
            yield* Deferred.await(secondSendStarted);
            for (let attempt = 0; attempt < 4; attempt += 1) {
              yield* Effect.yieldNow;
            }

            expect(commands).toHaveLength(1);
            expect(activeProcesses).toBe(1);

            yield* Deferred.succeed(firstExit, ChildProcessSpawner.ExitCode(0));
            yield* Deferred.await(secondSpawned);

            expect(commands).toHaveLength(2);
            expect(activeProcesses).toBe(1);
            expect(maxActiveProcesses).toBe(1);
            expect(
              commands.map((command) => {
                const sessionIndex = command.args.indexOf("--session-id");
                return command.args[sessionIndex + 1];
              }),
            ).toEqual(["serialized-session", "serialized-session"]);

            yield* Deferred.succeed(secondExit, ChildProcessSpawner.ExitCode(0));
            const [firstTurn, secondTurn] = yield* Effect.all([
              Fiber.join(firstTurnFiber),
              Fiber.join(secondTurnFiber),
            ]);
            expect(firstTurn.turnId).not.toBe(secondTurn.turnId);
            expect(activeProcesses).toBe(0);
            expect((yield* adapter.readThread(threadId)).turns).toHaveLength(2);
          }),
          spawner,
        );
      }),
    ),
  );

  it.effect("maps a non-zero Muse exit and stderr to canonical failure state", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const spawner = mockSpawner(() =>
          Effect.succeed(
            makeHandle({
              stderr: "Meta authentication failed\n",
              exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(7)),
            }),
          ),
        );

        yield* provideMuseTestServices(
          Effect.gen(function* () {
            const adapter = yield* makeMuseAdapter(
              decodeMuseSettings({ binaryPath: process.execPath }),
            );
            const threadId = ThreadId.make("muse-process-failure-test");
            const eventsFiber = yield* adapter.streamEvents.pipe(
              Stream.filter((event) => event.threadId === threadId),
              Stream.takeUntil((event) => event.type === "turn.completed"),
              Stream.runCollect,
              Effect.forkChild,
            );
            yield* Effect.yieldNow;
            yield* startMuseSession(adapter, threadId);
            yield* adapter.sendTurn({ threadId, input: "fail", attachments: [] });
            const events = Array.from(yield* Fiber.join(eventsFiber));
            const sessions = yield* adapter.listSessions();

            expect(events.find((event) => event.type === "runtime.error")).toMatchObject({
              payload: {
                message: "Meta authentication failed",
                class: "provider_error",
              },
            });
            expect(events.at(-1)).toMatchObject({
              type: "turn.completed",
              payload: {
                state: "failed",
                errorMessage: "Meta authentication failed",
              },
            });
            expect(sessions[0]).toMatchObject({
              status: "error",
              lastError: "Meta authentication failed",
            });
          }),
          spawner,
        );
      }),
    ),
  );

  it.effect("kills an active Muse process and completes the turn as interrupted", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const exitCode = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
        const spawned = yield* Deferred.make<void>();
        let killCount = 0;
        const spawner = mockSpawner(() =>
          Effect.succeed(
            makeHandle({
              stdout: [
                museEvent(
                  "task.lifecycle.proposed",
                  {
                    task_id: "interrupted-tool",
                    event: {
                      kind: "proposed",
                      task_id: "interrupted-tool",
                      task_kind: "tool.bash",
                    },
                  },
                  1,
                ),
                museEvent(
                  "task.lifecycle.started",
                  {
                    task_id: "interrupted-tool",
                    event: { kind: "started", task_id: "interrupted-tool" },
                  },
                  2,
                ),
                "",
              ].join("\n"),
              exitCode: Deferred.succeed(spawned, undefined).pipe(
                Effect.andThen(Deferred.await(exitCode)),
              ),
              onKill: () =>
                Effect.sync(() => {
                  killCount += 1;
                }).pipe(
                  Effect.andThen(
                    Deferred.succeed(exitCode, ChildProcessSpawner.ExitCode(130)).pipe(
                      Effect.ignore,
                    ),
                  ),
                ),
            }),
          ),
        );

        yield* provideMuseTestServices(
          Effect.gen(function* () {
            const adapter = yield* makeMuseAdapter(
              decodeMuseSettings({ binaryPath: process.execPath }),
            );
            const threadId = ThreadId.make("muse-interrupt-test");
            const eventsFiber = yield* adapter.streamEvents.pipe(
              Stream.filter((event) => event.threadId === threadId),
              Stream.takeUntil((event) => event.type === "turn.completed"),
              Stream.runCollect,
              Effect.forkChild,
            );
            yield* Effect.yieldNow;
            yield* startMuseSession(adapter, threadId);
            const turnFiber = yield* adapter
              .sendTurn({ threadId, input: "keep running", attachments: [] })
              .pipe(Effect.forkChild);
            yield* Deferred.await(spawned);

            yield* adapter.interruptTurn(threadId);
            yield* Fiber.join(turnFiber);
            const events = Array.from(yield* Fiber.join(eventsFiber));
            const sessions = yield* adapter.listSessions();

            expect(killCount).toBeGreaterThanOrEqual(1);
            expect(events.at(-1)).toMatchObject({
              type: "turn.completed",
              payload: { state: "interrupted" },
            });
            expect(
              events.find(
                (event) =>
                  event.type === "item.completed" && event.payload.itemType === "command_execution",
              ),
            ).toMatchObject({
              payload: {
                status: "failed",
                detail: "Muse Code turn was interrupted.",
              },
            });
            expect(sessions[0]).toMatchObject({ status: "ready" });
            expect(sessions[0]?.activeTurnId).toBeUndefined();
          }),
          spawner,
        );
      }),
    ),
  );

  it.effect("settles the turn and session when the Muse process defects", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const spawner = mockSpawner(() =>
          Effect.succeed(
            makeHandle({
              exitCode: Effect.die("unexpected process defect"),
            }),
          ),
        );

        yield* provideMuseTestServices(
          Effect.gen(function* () {
            const adapter = yield* makeMuseAdapter(
              decodeMuseSettings({ binaryPath: process.execPath }),
            );
            const threadId = ThreadId.make("muse-defect-test");
            const eventsFiber = yield* adapter.streamEvents.pipe(
              Stream.filter((event) => event.threadId === threadId),
              Stream.takeUntil((event) => event.type === "turn.completed"),
              Stream.runCollect,
              Effect.forkChild,
            );
            yield* Effect.yieldNow;
            yield* startMuseSession(adapter, threadId);

            const turnExit = yield* adapter
              .sendTurn({ threadId, input: "trigger a defect", attachments: [] })
              .pipe(Effect.exit);
            const events = Array.from(yield* Fiber.join(eventsFiber));
            const sessions = yield* adapter.listSessions();

            expect(turnExit._tag).toBe("Failure");
            expect(events.find((event) => event.type === "runtime.error")).toMatchObject({
              payload: {
                message: "Muse Code turn ended unexpectedly.",
                class: "provider_error",
              },
            });
            expect(events.at(-1)).toMatchObject({
              type: "turn.completed",
              payload: {
                state: "failed",
                errorMessage: "Muse Code turn ended unexpectedly.",
              },
            });
            expect(sessions[0]).toMatchObject({
              status: "error",
              lastError: "Muse Code turn ended unexpectedly.",
            });
            expect(sessions[0]?.activeTurnId).toBeUndefined();
          }),
          spawner,
        );
      }),
    ),
  );

  it.effect("does not resurrect a session when stop races an active turn", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const exitCode = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
        const spawned = yield* Deferred.make<void>();
        const observedTypes: string[] = [];
        const spawner = mockSpawner(() =>
          Effect.succeed(
            makeHandle({
              stdout: completedOutput("too late"),
              exitCode: Deferred.succeed(spawned, undefined).pipe(
                Effect.andThen(Deferred.await(exitCode)),
              ),
              onKill: () =>
                Deferred.succeed(exitCode, ChildProcessSpawner.ExitCode(143)).pipe(Effect.asVoid),
            }),
          ),
        );

        yield* provideMuseTestServices(
          Effect.gen(function* () {
            const adapter = yield* makeMuseAdapter(
              decodeMuseSettings({ binaryPath: process.execPath }),
            );
            const threadId = ThreadId.make("muse-stop-race-test");
            const eventsFiber = yield* adapter.streamEvents.pipe(
              Stream.filter((event) => event.threadId === threadId),
              Stream.runForEach((event) =>
                Effect.sync(() => {
                  observedTypes.push(event.type);
                }),
              ),
              Effect.forkChild,
            );
            yield* Effect.yieldNow;
            yield* startMuseSession(adapter, threadId);
            const turnFiber = yield* adapter
              .sendTurn({ threadId, input: "keep running", attachments: [] })
              .pipe(Effect.forkChild);
            yield* Deferred.await(spawned);

            yield* adapter.stopSession(threadId);
            const turnExit = yield* Fiber.await(turnFiber);
            for (let attempt = 0; attempt < 4; attempt += 1) {
              yield* Effect.yieldNow;
            }
            yield* Fiber.interrupt(eventsFiber);

            expect(turnExit._tag).toBe("Failure");
            expect(yield* adapter.hasSession(threadId)).toBe(false);
            const exitedIndex = observedTypes.indexOf("session.exited");
            const completedIndex = observedTypes.indexOf("turn.completed");
            expect(exitedIndex).toBeGreaterThanOrEqual(0);
            expect(completedIndex).toBeGreaterThanOrEqual(0);
            expect(completedIndex).toBeLessThan(exitedIndex);
            expect(observedTypes.slice(exitedIndex + 1)).not.toContain("turn.completed");
          }),
          spawner,
        );
      }),
    ),
  );

  it.effect("waits for an in-flight spawn to cancel before the stopped session exits", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const spawnEntered = yield* Deferred.make<void>();
        const releaseSpawn = yield* Deferred.make<void>();
        const childExit = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
        const stopDone = yield* Deferred.make<void>();
        const observedTypes: string[] = [];
        let spawnReturned = 0;
        let killCount = 0;
        let spawnedHandle: ChildProcessSpawner.ChildProcessHandle | undefined;
        const spawner = mockSpawner(() =>
          Effect.uninterruptible(
            Effect.gen(function* () {
              yield* Deferred.succeed(spawnEntered, undefined);
              yield* Deferred.await(releaseSpawn);
              const handle = makeHandle({
                exitCode: Deferred.await(childExit),
                onKill: () =>
                  Effect.sync(() => {
                    killCount += 1;
                  }).pipe(
                    Effect.andThen(
                      Deferred.succeed(childExit, ChildProcessSpawner.ExitCode(143)).pipe(
                        Effect.ignore,
                      ),
                    ),
                  ),
              });
              spawnedHandle = handle;
              spawnReturned += 1;
              return handle;
            }),
          ).pipe(
            Effect.onInterrupt(() =>
              spawnedHandle
                ? spawnedHandle.kill({ forceKillAfter: 2_000 }).pipe(Effect.ignore)
                : Effect.void,
            ),
          ),
        );

        yield* provideMuseTestServices(
          Effect.gen(function* () {
            const adapter = yield* makeMuseAdapter(
              decodeMuseSettings({ binaryPath: process.execPath }),
            );
            const threadId = ThreadId.make("muse-stop-during-spawn-test");
            const eventsFiber = yield* adapter.streamEvents.pipe(
              Stream.filter((event) => event.threadId === threadId),
              Stream.runForEach((event) =>
                Effect.sync(() => {
                  observedTypes.push(event.type);
                }),
              ),
              Effect.forkChild,
            );
            yield* Effect.yieldNow;
            yield* startMuseSession(adapter, threadId);
            const turnFiber = yield* adapter
              .sendTurn({ threadId, input: "stop while spawning", attachments: [] })
              .pipe(Effect.forkChild);
            yield* Deferred.await(spawnEntered);

            const stopFiber = yield* adapter
              .stopSession(threadId)
              .pipe(
                Effect.ensuring(Deferred.succeed(stopDone, undefined).pipe(Effect.ignore)),
                Effect.forkChild,
              );
            yield* Effect.yieldNow;
            expect(yield* Deferred.isDone(stopDone)).toBe(false);

            yield* Deferred.succeed(releaseSpawn, undefined);
            yield* Fiber.join(stopFiber);
            const turnExit = yield* Fiber.await(turnFiber);
            yield* Effect.yieldNow;
            yield* Fiber.interrupt(eventsFiber);

            expect(turnExit._tag).toBe("Failure");
            expect(spawnReturned).toBe(1);
            expect(killCount).toBeGreaterThanOrEqual(1);
            expect(yield* adapter.hasSession(threadId)).toBe(false);
            const exitedIndex = observedTypes.indexOf("session.exited");
            expect(exitedIndex).toBeGreaterThanOrEqual(0);
            expect(observedTypes.filter((type) => type === "turn.completed")).toHaveLength(1);
            expect(observedTypes.slice(exitedIndex + 1)).toEqual([]);
          }),
          spawner,
        );
      }),
    ),
  );
});
