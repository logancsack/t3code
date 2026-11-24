/**
 * Speaks to a generation-1 machine through the client the rest of the runtime already uses: the
 * orchestration methods are sent in V1's shapes and answered in V2's. Loaded only when such a
 * machine connects.
 */
import {
  EnvironmentAuthorizationError,
  NonNegativeInt,
  ORCHESTRATION_V2_WS_METHODS as V2,
  OrchestrationGetWorkflowScriptError,
  OrchestrationV2DispatchCommandError,
  OrchestrationV2ForceStopThreadError,
  OrchestrationV2GetNativeChildWorkError,
  OrchestrationV2GetShellSnapshotError,
  OrchestrationV2GetThreadProjectionError,
  OrchestrationV2StopWorkflowError,
  OrchestrationV2ThreadLaunchError,
  WsRpcGroup,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadLaunchInput,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Rpc, RpcClient, RpcGroup } from "effect/rpc";
import * as RpcClientError from "effect/rpc/RpcClientError";
import * as Socket from "effect/socket/Socket";

import type {
  EnvironmentRpcFailure,
  EnvironmentRpcInput,
  EnvironmentRpcStreamFailure,
  EnvironmentRpcStreamValue,
  EnvironmentRpcSuccess,
} from "../rpc/client.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import { launchToV1Command, toV1Commands } from "./commands.ts";
import { stepThreadStream, type ThreadStreamState } from "./stream.ts";
import { mapShellStreamItem, mapThreadProjection, mapThreadShell } from "./toV2.ts";
import {
  V1_WS_METHODS as V1,
  V1ClientCommand,
  V1Failure,
  V1ShellSnapshot,
  V1ShellStreamItem,
  V1SubscribeShellInput,
  V1SubscribeThreadInput,
  V1ThreadStreamItem,
  type V1Thread,
  type V1ThreadShell,
} from "./wire.ts";

const failure = Schema.Union([EnvironmentAuthorizationError, V1Failure]);

const V1Group = RpcGroup.make(
  Rpc.make(V1.dispatchCommand, {
    payload: V1ClientCommand,
    success: Schema.Struct({ sequence: NonNegativeInt }),
    error: failure,
  }),
  Rpc.make(V1.subscribeShell, {
    payload: V1SubscribeShellInput,
    success: V1ShellStreamItem,
    error: failure,
    stream: true,
  }),
  Rpc.make(V1.subscribeThread, {
    payload: V1SubscribeThreadInput,
    success: V1ThreadStreamItem,
    error: failure,
    stream: true,
  }),
  Rpc.make(V1.getArchivedShellSnapshot, {
    payload: Schema.Struct({}),
    success: V1ShellSnapshot,
    error: failure,
  }),
);

const makeV1Client = RpcClient.make(V1Group);
/** The four orchestration methods as a V1 machine answers them. */
export type V1Client =
  typeof makeV1Client extends Effect.Effect<infer Client, any, any> ? Client : never;

const UNSUPPORTED = "This machine runs an older T3 runtime that cannot do this.";

// While an agent streams, events arrive many times a second and each costs a whole-thread map.
const THREAD_BATCH_WINDOW = "50 millis";
const THREAD_BATCH_SIZE = 256;

const TOKEN_MODE = '"responseStreamingMode":"token"';

/**
 * A V1 machine can hold a streaming mode this client no longer has, and its config would fail to
 * decode. Quotes inside JSON strings are escaped, so only the setting itself can match.
 */
export function readLegacySettings(socket: Socket.Socket): Socket.Socket {
  const read = (frame: string | Uint8Array) =>
    typeof frame === "string" && frame.includes(TOKEN_MODE)
      ? frame.replaceAll(TOKEN_MODE, '"responseStreamingMode":"paragraph"')
      : frame;
  return Socket.make({
    reader: Effect.map(socket.reader, (reader) => ({
      upgrade: reader.upgrade,
      pull: Effect.map(reader.pull, Arr.map(read)),
    })),
    writer: socket.writer,
  });
}

type UnaryTag =
  | typeof V2.dispatchCommand
  | typeof V2.launchThread
  | typeof V2.getArchivedShellSnapshot
  | typeof V2.getThreadProjection
  | typeof V2.getThreadTitles
  | typeof V2.getWorktreeThreadIds
  | typeof V2.getTurnItem
  | typeof V2.forceStopThread
  | typeof V2.stopWorkflow
  | typeof V2.getNativeChildWork
  | typeof V2.getWorkflowScript;
type StreamTag =
  | typeof V2.subscribeShell
  | typeof V2.subscribeThread
  | typeof V2.subscribeCommandOutput
  | typeof V2.subscribePromptSuggestion;
type Overrides = {
  readonly [Tag in UnaryTag]: (
    input: EnvironmentRpcInput<Tag>,
  ) => Effect.Effect<EnvironmentRpcSuccess<Tag>, EnvironmentRpcFailure<Tag>>;
} & {
  readonly [Tag in StreamTag]: (
    input: EnvironmentRpcInput<Tag>,
  ) => Stream.Stream<EnvironmentRpcStreamValue<Tag>, EnvironmentRpcStreamFailure<Tag>>;
};

const isAuthorizationError = Schema.is(EnvironmentAuthorizationError);

type V1Error = EnvironmentAuthorizationError | V1Failure | RpcClientError.RpcClientError;

const isRpcClientError = Schema.is(RpcClientError.RpcClientError);

const failWith =
  <E>(make: (message: string) => E) =>
  (error: V1Error): E | EnvironmentAuthorizationError | RpcClientError.RpcClientError =>
    isAuthorizationError(error) || isRpcClientError(error) ? error : make(error.message);

type KnownThread = Pick<
  V1ThreadShell,
  "title" | "runtimeMode" | "interactionMode" | "worktreePath" | "archivedAt"
>;

/** Replaces the orchestration methods of `client` with ones that speak V1 through `v1`. */
export function wrapLegacyClient(client: WsRpcProtocolClient, v1: V1Client): WsRpcProtocolClient {
  // V1 commands need what V2 leaves to the server: a thread's modes and a project's folder.
  const threads = new Map<ThreadId, KnownThread>();
  const projectRoots = new Map<ProjectId, string>();
  const rememberShell = (item: V1ShellStreamItem) => {
    switch (item.kind) {
      case "snapshot":
        threads.clear();
        projectRoots.clear();
        for (const thread of item.snapshot.threads) threads.set(thread.id, thread);
        for (const project of item.snapshot.projects) {
          projectRoots.set(project.id, project.workspaceRoot);
        }
        break;
      case "thread-upserted":
        threads.set(item.thread.id, item.thread);
        break;
      case "thread-removed":
        threads.delete(item.threadId);
        break;
      case "project-upserted":
        projectRoots.set(item.project.id, item.project.workspaceRoot);
        break;
      case "project-removed":
        projectRoots.delete(item.projectId);
        break;
    }
  };
  const now = Effect.map(DateTime.now, DateTime.formatIso);
  const shellFailure = failWith((message) => new OrchestrationV2GetShellSnapshotError({ message }));
  const readThread = (threadId: ThreadId) =>
    v1[V1.subscribeThread]({ threadId, reasoningMessages: true, requestCompletionMarker: true });
  const threadSnapshot = (threadId: ThreadId) =>
    readThread(threadId).pipe(
      Stream.filter((item) => item.kind === "snapshot"),
      Stream.runHead,
    );
  const threadFailure = (threadId: ThreadId) =>
    failWith((message) => new OrchestrationV2GetThreadProjectionError({ threadId, message }));

  const overrides: Overrides = {
    [V2.dispatchCommand]: Effect.fn("LegacyV1.dispatchCommand")(function* (command) {
      const reject = (message: string) =>
        new OrchestrationV2DispatchCommandError({
          commandId: command.commandId,
          commandType: command.type,
          message,
        });
      // The method's input type is the payload's constructor form; the value is the command.
      const result = toV1Commands(command as OrchestrationV2Command, {
        now: yield* now,
        thread: (threadId) => threads.get(threadId),
      });
      if (result.kind === "skip") return { sequence: 0 };
      if (result.kind === "unsupported") return yield* reject(UNSUPPORTED);
      let sequence = 0;
      for (const v1Command of result.commands) {
        ({ sequence } = yield* v1[V1.dispatchCommand](v1Command).pipe(
          Effect.mapError(failWith(reject)),
        ));
      }
      // The next message must carry the new mode even if it leaves before the list says so.
      const known = "threadId" in command ? threads.get(command.threadId) : undefined;
      if (known !== undefined && command.type === "thread.runtime-mode.set") {
        threads.set(command.threadId, { ...known, runtimeMode: command.runtimeMode });
      }
      if (known !== undefined && command.type === "thread.interaction-mode.set") {
        threads.set(command.threadId, { ...known, interactionMode: command.interactionMode });
      }
      return { sequence };
    }),

    [V2.launchThread]: Effect.fn("LegacyV1.launchThread")(function* (input) {
      const reject = (message: string) =>
        new OrchestrationV2ThreadLaunchError({
          commandId: input.commandId,
          projectId: input.projectId,
          message,
        });
      const { threadId, initialMessage, workspaceStrategy } = input;
      const createdAt = yield* now;
      const command =
        threadId === undefined
          ? null
          : launchToV1Command(
              { ...(input as OrchestrationV2ThreadLaunchInput), threadId },
              createdAt,
              projectRoots.get(input.projectId),
            );
      if (threadId === undefined || command === null || initialMessage?.messageId === undefined) {
        return yield* reject(UNSUPPORTED);
      }
      const { sequence } = yield* v1[V1.dispatchCommand](command).pipe(
        Effect.mapError(failWith(reject)),
      );
      // What the machine will hold once it has applied the command; its stream replaces this.
      const thread: V1Thread = {
        id: threadId,
        projectId: input.projectId,
        title: input.title,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: input.interactionMode,
        branch: workspaceStrategy.branch ?? null,
        worktreePath:
          workspaceStrategy.type === "existing_worktree" ? workspaceStrategy.worktreePath : null,
        latestTurn: null,
        createdAt,
        updatedAt: createdAt,
        session: null,
        deletedAt: null,
        messages: [
          {
            id: initialMessage.messageId,
            role: "user",
            text: initialMessage.text,
            attachments: initialMessage.attachments,
            turnId: null,
            streaming: false,
            createdAt,
            updatedAt: createdAt,
          },
        ],
        activities: [],
        checkpoints: [],
      };
      threads.set(threadId, { ...thread, archivedAt: null });
      return {
        threadId,
        projection: mapThreadProjection(thread),
        resumed: input.reuseExistingThread === true,
        sequence,
      };
    }),

    // Always the whole list: the folders and modes above come from it.
    [V2.subscribeShell]: (input) =>
      v1[V1.subscribeShell](
        input.requestCompletionMarker === undefined
          ? {}
          : { requestCompletionMarker: input.requestCompletionMarker },
      ).pipe(
        Stream.map((item) => {
          rememberShell(item);
          return mapShellStreamItem(item);
        }),
        Stream.mapError(shellFailure),
      ),

    // Always the whole thread: a V2 cursor means nothing to a V1 machine's events.
    [V2.subscribeThread]: ({ threadId }) =>
      readThread(threadId).pipe(
        Stream.groupedWithin(THREAD_BATCH_SIZE, THREAD_BATCH_WINDOW),
        Stream.mapAccumEffect(
          (): ThreadStreamState => ({ thread: null, sequence: 0 }),
          Effect.fnUntraced(function* (state, batch) {
            const step = stepThreadStream(state, batch);
            const reloaded = step.reload ? yield* threadSnapshot(threadId) : Option.none();
            const next = Option.isSome(reloaded)
              ? stepThreadStream(step.state, reloaded.value)
              : step;
            if (next.state.thread !== null) threads.set(threadId, next.state.thread);
            return [
              next.state,
              Option.isSome(reloaded) ? [...next.items, ...step.items] : step.items,
            ] as const;
          }),
        ),
        Stream.mapError(threadFailure(threadId)),
      ),

    [V2.getArchivedShellSnapshot]: () =>
      v1[V1.getArchivedShellSnapshot]({}).pipe(
        Effect.map((snapshot) => ({
          schemaVersion: 1,
          snapshotSequence: snapshot.snapshotSequence,
          projects: snapshot.projects,
          threads: snapshot.threads.map(mapThreadShell),
        })),
        Effect.mapError(shellFailure),
      ),

    [V2.getThreadProjection]: ({ threadId }) =>
      threadSnapshot(threadId).pipe(
        Effect.mapError(threadFailure(threadId)),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new OrchestrationV2GetThreadProjectionError({
                  threadId,
                  message: "The machine did not send this thread.",
                }),
              ),
            onSome: (item) => Effect.succeed(mapThreadProjection(item.snapshot.thread)),
          }),
        ),
      ),

    [V2.getThreadTitles]: ({ threadIds }) =>
      Effect.sync(() =>
        Object.fromEntries(
          threadIds.flatMap((threadId) => {
            const thread = threads.get(threadId);
            return thread === undefined ? [] : [[threadId, thread.title] as const];
          }),
        ),
      ),

    [V2.getWorktreeThreadIds]: ({ worktreePath }) =>
      Effect.sync(() => ({
        threadIds: [...threads].flatMap(([threadId, thread]) =>
          thread.worktreePath === worktreePath && !thread.archivedAt ? [threadId] : [],
        ),
      })),

    // These exist only on V2 machines, and nothing a V1 thread maps to asks for them.
    [V2.getTurnItem]: ({ threadId }) =>
      Effect.fail(new OrchestrationV2GetThreadProjectionError({ threadId, message: UNSUPPORTED })),
    [V2.forceStopThread]: ({ threadId }) =>
      Effect.fail(new OrchestrationV2ForceStopThreadError({ threadId })),
    [V2.stopWorkflow]: ({ threadId, subagentId }) =>
      Effect.fail(
        new OrchestrationV2StopWorkflowError({ threadId, subagentId, reason: "unsupported" }),
      ),
    [V2.getNativeChildWork]: ({ threadId }) =>
      Effect.fail(new OrchestrationV2GetNativeChildWorkError({ threadId })),
    [V2.getWorkflowScript]: ({ scriptPath }) =>
      Effect.fail(
        new OrchestrationGetWorkflowScriptError({ reason: "root-unavailable", scriptPath }),
      ),
    [V2.subscribeCommandOutput]: () => Stream.never,
    [V2.subscribePromptSuggestion]: () => Stream.never,
  };
  // The client's own method types are generic in their call options; these take none.
  return { ...client, ...(overrides as unknown as Pick<WsRpcProtocolClient, keyof Overrides>) };
}

export const makeLegacyClient = RpcClient.make(WsRpcGroup.add(...V1Group.requests.values())).pipe(
  Effect.map((client) =>
    wrapLegacyClient(client as unknown as WsRpcProtocolClient, client as unknown as V1Client),
  ),
);
