// @effect-diagnostics nodeBuiltinImport:off -- Reads attachment bytes from the hub's own attachment store.
/**
 * RemoteProviderDriver - the hub's provider driver. It runs nothing locally.
 *
 * It wraps each built-in driver's identity (kind, config schema, defaults) so
 * the hub keeps the same instance ids, model selections and session
 * directory rows, while its adapter forwards every call to the runner on the
 * thread's own machine. `ProviderService` above it is unchanged: it still
 * persists resume cursors, mints MCP credentials, recovers sessions and
 * serializes per-thread lifecycle work.
 *
 * Wake semantics (see docs/internals/thread-machines.md):
 * - `startSession`, `sendTurn`, `respondToRequest`, `respondToUserInput`,
 *   `rollbackThread`, `readThread`, and interrupting an active turn wake the
 *   machine.
 * - `hasSession` and `listSessions` answer from the `RemoteSessionRegistry`
 *   and never contact a machine: a session on a sleeping machine is
 *   resumable, so it still exists.
 * - `stopSession` stops a session only on a running machine; a sleeping
 *   machine is left asleep and the hub forgets the session.
 * - `stopAll` does nothing: the sessions run on other machines and outlive
 *   the hub process (`capabilities.sessionsOutliveServer`).
 *
 * A session the runner lost while its machine slept (the machine was
 * recreated) is restarted from the recorded resume cursor before a turn is
 * sent, after boot reconciliation has settled the old one.
 *
 * Provider settings: the hub's effective settings for the instance, sensitive
 * environment values decrypted from the hub's secret store, are pushed to the
 * runner (`runner.provider.configure`, protocol 2) when a thread's runner
 * connects (for the thread's instance), before every session start and before
 * title or branch-name generation. The runner keeps them in memory only.
 *
 * @module hub/RemoteProviderDriver
 */
import * as NodeFS from "node:fs";

import {
  type ChatAttachment,
  PROVIDER_SIGN_IN_THREAD_ID,
  type ProviderDriverKind,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type ProviderSession,
  type ServerProvider,
  TextGenerationError,
  type ThreadId,
} from "@t3tools/contracts";
import {
  parseThreadCheckoutPath,
  RUNNER_PROTOCOL_PROVIDER_SETTINGS,
  type RunnerAttachmentFile,
  type RunnerMcpSession,
  ThreadMachineUnavailableError,
} from "@t3tools/contracts/runner";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import { ServerConfig } from "../config.ts";
import * as McpProviderSession from "../mcp/McpProviderSession.ts";
import { deriveProviderInstanceConfigMap } from "../provider/Layers/ProviderInstanceRegistryHydration.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { hydrateHubAttachment } from "../persistence/Postgres/HubAttachments.ts";
import {
  type ProviderAdapterError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../provider/Errors.ts";
import {
  defaultProviderContinuationIdentity,
  type AnyProviderDriver,
  type ProviderInstance,
} from "../provider/ProviderDriver.ts";
import type {
  ProviderAdapterCapabilities,
  ProviderAdapterShape,
  ProviderThreadSnapshot,
} from "../provider/Services/ProviderAdapter.ts";
import type { ServerProviderShape } from "../provider/Services/ServerProvider.ts";
import type { TextGenerationShape } from "../textGeneration/TextGeneration.ts";
import { fromRunnerRemoteError, ProviderAdapterErrorSchema } from "../runner/remoteErrors.ts";
import {
  HubProviderSnapshots,
  overlayHubIdentity,
  pendingRemoteSnapshot,
  type RemoteInstanceIdentity,
} from "./HubProviderSnapshots.ts";
import { RemoteSessionRegistry } from "./RemoteSessionRegistry.ts";
import { RunnerConnectionPool, type RunnerConnection } from "./RunnerConnectionPool.ts";
import { RunnerEventDelivery } from "./RunnerEventDelivery.ts";

export type RemoteProviderDriverEnv =
  | RunnerConnectionPool
  | RunnerEventDelivery
  | RemoteSessionRegistry
  | HubProviderSnapshots
  | ServerSettingsService
  | ServerConfig
  | FileSystem.FileSystem
  | Path.Path;

const isThreadMachineUnavailable = Schema.is(ThreadMachineUnavailableError);
const isProviderAdapterError = Schema.is(ProviderAdapterErrorSchema);
const isTextGenerationError = Schema.is(TextGenerationError);

const describe = (cause: unknown): string =>
  cause && typeof cause === "object" && "message" in cause
    ? String((cause as { readonly message: unknown }).message)
    : String(cause);

/** Rewrites the hub-minted MCP session to the hub's public endpoint. */
export const mcpSessionForRunner = (
  threadId: ThreadId,
  publicUrl: string | undefined,
): RunnerMcpSession | null => {
  const session = McpProviderSession.readMcpProviderSession(threadId);
  if (!session) return null;
  return {
    ...session,
    endpoint: publicUrl ? `${publicUrl.replace(/\/+$/, "")}/mcp` : session.endpoint,
  };
};

export class RunnerAttachmentReadError extends Schema.TaggedErrorClass<RunnerAttachmentReadError>()(
  "RunnerAttachmentReadError",
  { attachmentId: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Attachment ${this.attachmentId} could not be read from the hub attachment store.`;
  }
}

/**
 * Reads attachment bytes from the hub's attachment store for shipping with a
 * turn. With a hub database the local store is a cache, so each attachment is
 * restored from Postgres first when the cache lost it.
 */
export const attachmentFilesForRunner = (
  attachmentsDir: string,
  attachments: ReadonlyArray<ChatAttachment> | undefined,
) =>
  Effect.forEach(attachments ?? [], (attachment) =>
    Effect.andThen(
      hydrateHubAttachment({ attachmentsDir, attachmentId: attachment.id }),
      Effect.try({
        try: (): ReadonlyArray<RunnerAttachmentFile> => {
          const hubPath = resolveAttachmentPath({ attachmentsDir, attachment });
          if (hubPath === null || !NodeFS.existsSync(hubPath)) return [];
          return [
            { attachment, hubPath, bytesBase64: NodeFS.readFileSync(hubPath).toString("base64") },
          ];
        },
        catch: (cause) => new RunnerAttachmentReadError({ attachmentId: attachment.id, cause }),
      }),
    ),
  ).pipe(Effect.map((files) => files.flat()));

interface InstanceContext {
  readonly driverKind: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly pool: RunnerConnectionPool["Service"];
  readonly delivery: RunnerEventDelivery["Service"];
  readonly registry: RemoteSessionRegistry["Service"];
  readonly readAttachments: (
    attachments: ReadonlyArray<ChatAttachment> | undefined,
  ) => Effect.Effect<ReadonlyArray<RunnerAttachmentFile>, RunnerAttachmentReadError>;
  readonly publicUrl: string | undefined;
  /**
   * Pushes the hub's effective settings for this instance to a runner that
   * speaks protocol 2; returns the instances the runner hosts afterwards, or
   * none when nothing was pushed.
   */
  readonly pushSettings: (
    connection: RunnerConnection,
  ) => Effect.Effect<Option.Option<ReadonlyArray<ProviderInstanceId>>>;
}

/**
 * The hub's effective settings for one instance (explicit `providerInstances`
 * or the legacy `providers.<kind>` mirror), with sensitive values included.
 */
export const effectiveInstanceSettings = (
  serverSettings: ServerSettingsService["Service"],
  instanceId: ProviderInstanceId,
) =>
  serverSettings.getSettings.pipe(
    Effect.map((settings): ProviderInstanceConfig | undefined => {
      const entry = deriveProviderInstanceConfigMap(settings)[instanceId];
      if (entry === undefined) return undefined;
      return entry.environment === undefined
        ? entry
        : {
            ...entry,
            environment: entry.environment.map(
              ({ valueRedacted: _redacted, ...variable }) => variable,
            ),
          };
    }),
  );

export function makeRemoteProviderDriver<R>(
  base: AnyProviderDriver<R>,
): AnyProviderDriver<RemoteProviderDriverEnv> {
  const driverKind: ProviderDriverKind = base.driverKind;
  return {
    driverKind,
    metadata: base.metadata,
    configSchema: base.configSchema,
    defaultConfig: base.defaultConfig,
    create: ({ instanceId, displayName, accentColor, enabled, config: driverConfig }) =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const serverSettings = yield* ServerSettingsService;
        const platform = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
        const pushSettings: InstanceContext["pushSettings"] = (connection) =>
          connection.hello.protocolVersion < RUNNER_PROTOCOL_PROVIDER_SETTINGS
            ? Effect.succeed(Option.none())
            : effectiveInstanceSettings(serverSettings, instanceId).pipe(
                Effect.flatMap((settings) =>
                  settings === undefined
                    ? Effect.succeed(Option.none<ReadonlyArray<ProviderInstanceId>>())
                    : connection.client["runner.provider.configure"]({
                        instances: { [instanceId]: settings },
                      }).pipe(Effect.map((result) => Option.some(result.instances))),
                ),
                Effect.catchCause((cause) =>
                  Effect.logWarning("provider settings were not pushed to the runner", {
                    threadId: connection.threadId,
                    instanceId,
                    detail: Cause.pretty(cause).slice(0, 300),
                  }).pipe(Effect.as(Option.none<ReadonlyArray<ProviderInstanceId>>())),
                ),
              );
        const context: InstanceContext = {
          driverKind,
          instanceId,
          pool: yield* RunnerConnectionPool,
          delivery: yield* RunnerEventDelivery,
          registry: yield* RemoteSessionRegistry,
          readAttachments: (attachments) =>
            attachmentFilesForRunner(config.attachmentsDir, attachments).pipe(
              Effect.provideContext(platform),
            ),
          publicUrl: config.hub?.publicUrl,
          pushSettings,
        };
        const capabilities: {
          current: Omit<ProviderAdapterCapabilities, "sessionsOutliveServer">;
        } = { current: { sessionModelSwitch: "in-session" } };
        const continuationIdentity = defaultProviderContinuationIdentity({
          driverKind,
          instanceId,
        });
        const snapshot = yield* makeRemoteSnapshot({
          context,
          identity: {
            driverKind,
            instanceId,
            displayName,
            accentColor,
            enabled,
            continuationGroupKey: continuationIdentity.continuationKey,
          },
          config: driverConfig,
          onCapabilities: (sessionModelSwitch) =>
            Effect.sync(() => {
              capabilities.current = { ...capabilities.current, sessionModelSwitch };
            }),
        });
        return {
          instanceId,
          driverKind,
          continuationIdentity,
          displayName,
          accentColor,
          enabled,
          snapshot,
          adapter: makeRemoteAdapter(context, () => capabilities.current),
          textGeneration: makeRemoteTextGeneration(context),
        } satisfies ProviderInstance;
      }),
  };
}

function makeRemoteAdapter(
  context: InstanceContext,
  currentCapabilities: () => Omit<ProviderAdapterCapabilities, "sessionsOutliveServer">,
): ProviderAdapterShape<ProviderAdapterError> {
  const { driverKind, instanceId, pool, delivery, registry } = context;

  const toAdapterError =
    (method: string) =>
    (error: unknown): ProviderAdapterError => {
      if (isProviderAdapterError(error)) return error;
      if (
        error &&
        typeof error === "object" &&
        (error as { _tag?: unknown })._tag === "RunnerRemoteError"
      ) {
        return fromRunnerRemoteError(
          ProviderAdapterErrorSchema,
          (remote) =>
            new ProviderAdapterRequestError({
              provider: driverKind,
              method,
              detail: remote.message,
              cause: remote,
            }),
        )(error as never);
      }
      return new ProviderAdapterRequestError({
        provider: driverKind,
        method,
        detail: isThreadMachineUnavailable(error)
          ? error.message
          : `Runner call failed: ${describe(error)}`,
        cause: error,
      });
    };

  /** A call on the thread's runner after boot reconciliation of the connection. */
  const onRunner = <A, E>(
    threadId: ThreadId,
    method: string,
    wake: boolean,
    f: (connection: RunnerConnection) => Effect.Effect<A, E>,
  ): Effect.Effect<A, ProviderAdapterError> =>
    pool
      .use(threadId, { wake, operation: `provider.${method}` }, (connection) =>
        delivery.awaitReconciled(connection).pipe(Effect.andThen(f(connection))),
      )
      .pipe(Effect.mapError(toAdapterError(method)));

  const sessionNotFound = (threadId: ThreadId) =>
    new ProviderAdapterSessionNotFoundError({ provider: driverKind, threadId });

  /** The provider sign-in machine never runs agent sessions. */
  const refuseSignInThread = (threadId: ThreadId, operation: string) =>
    threadId === PROVIDER_SIGN_IN_THREAD_ID
      ? Effect.fail(
          new ProviderAdapterValidationError({
            provider: driverKind,
            operation,
            issue: "The provider sign-in machine does not run agent sessions.",
          }),
        )
      : Effect.void;

  const recordSession = (session: ProviderSession, connection: RunnerConnection) =>
    registry.upsert({
      threadId: session.threadId,
      instanceId,
      provider: driverKind,
      session: { ...session, providerInstanceId: instanceId },
      bootId: connection.hello.bootId,
    });

  const startOnRunner = (
    connection: RunnerConnection,
    input: Parameters<ProviderAdapterShape<ProviderAdapterError>["startSession"]>[0],
  ) =>
    context.pushSettings(connection).pipe(
      Effect.andThen(
        connection.client["runner.provider.startSession"]({
          instanceId,
          input,
          mcp: mcpSessionForRunner(input.threadId, context.publicUrl),
        }),
      ),
      Effect.tap((session) => recordSession(session, connection)),
    );

  const hostedSession = (threadId: ThreadId) =>
    registry
      .get(threadId)
      .pipe(Effect.map(Option.filter((record) => record.instanceId === instanceId)));

  return {
    provider: driverKind,
    get capabilities() {
      return { ...currentCapabilities(), sessionsOutliveServer: true };
    },
    startSession: (input) =>
      refuseSignInThread(input.threadId, "startSession").pipe(
        Effect.andThen(
          onRunner(input.threadId, "startSession", true, (connection) =>
            startOnRunner(connection, input),
          ),
        ),
      ),
    sendTurn: (input) =>
      Effect.gen(function* () {
        yield* refuseSignInThread(input.threadId, "sendTurn");
        // Captured before waking: if the machine was recreated while asleep,
        // reconciliation settles the old session and this restarts it.
        const before = yield* hostedSession(input.threadId);
        const attachments = yield* context
          .readAttachments(input.attachments)
          .pipe(Effect.mapError(toAdapterError("sendTurn")));
        return yield* onRunner(input.threadId, "sendTurn", true, (connection) =>
          Effect.gen(function* () {
            const current = yield* hostedSession(input.threadId);
            if (Option.isNone(current)) {
              if (Option.isNone(before)) return yield* sessionNotFound(input.threadId);
              const previous = before.value.session;
              yield* Effect.logInfo("restarting a session its recreated machine lost", {
                threadId: input.threadId,
                instanceId,
              });
              yield* startOnRunner(connection, {
                threadId: input.threadId,
                provider: driverKind,
                providerInstanceId: instanceId,
                runtimeMode: previous.runtimeMode,
                ...(previous.cwd !== undefined ? { cwd: previous.cwd } : {}),
                ...(previous.resumeCursor !== undefined
                  ? { resumeCursor: previous.resumeCursor }
                  : {}),
                ...(input.modelSelection !== undefined
                  ? { modelSelection: input.modelSelection }
                  : {}),
              });
            }
            return yield* connection.client["runner.provider.sendTurn"]({
              instanceId,
              input,
              attachments,
            });
          }),
        );
      }),
    interruptTurn: (threadId, turnId) =>
      hostedSession(threadId).pipe(
        Effect.flatMap((record) =>
          // Nothing runs on a machine without an active turn; do not wake it.
          Option.isNone(record) || record.value.session.activeTurnId === undefined
            ? Effect.void
            : onRunner(threadId, "interruptTurn", true, (connection) =>
                connection.client["runner.provider.interruptTurn"]({
                  instanceId,
                  threadId,
                  ...(turnId !== undefined ? { turnId } : {}),
                }),
              ),
        ),
      ),
    respondToRequest: (threadId, requestId, decision) =>
      onRunner(threadId, "respondToRequest", true, (connection) =>
        Effect.gen(function* () {
          if (Option.isNone(yield* hostedSession(threadId))) {
            return yield* sessionNotFound(threadId);
          }
          return yield* connection.client["runner.provider.respondToRequest"]({
            instanceId,
            threadId,
            requestId,
            decision,
          });
        }),
      ),
    respondToUserInput: (threadId, requestId, answers) =>
      onRunner(threadId, "respondToUserInput", true, (connection) =>
        Effect.gen(function* () {
          if (Option.isNone(yield* hostedSession(threadId))) {
            return yield* sessionNotFound(threadId);
          }
          return yield* connection.client["runner.provider.respondToUserInput"]({
            instanceId,
            threadId,
            requestId,
            answers,
          });
        }),
      ),
    stopSession: (threadId) =>
      Effect.gen(function* () {
        const connection = yield* pool.current(threadId);
        yield* registry.remove(threadId);
        if (Option.isNone(connection)) return;
        yield* connection.value.client["runner.provider.stopSession"]({
          instanceId,
          threadId,
        }).pipe(Effect.mapError(toAdapterError("stopSession")));
      }),
    listSessions: () =>
      registry
        .listForInstance(instanceId)
        .pipe(Effect.map((records) => records.map((record) => record.session))),
    hasSession: (threadId) => hostedSession(threadId).pipe(Effect.map(Option.isSome)),
    readThread: (threadId) =>
      onRunner(threadId, "readThread", true, (connection) =>
        connection.client["runner.provider.readThread"]({ instanceId, threadId }),
      ).pipe(Effect.map((snapshot) => snapshot as ProviderThreadSnapshot)),
    rollbackThread: (threadId, numTurns) =>
      onRunner(threadId, "rollbackThread", true, (connection) =>
        connection.client["runner.provider.rollbackThread"]({ instanceId, threadId, numTurns }),
      ).pipe(Effect.map((snapshot) => snapshot as ProviderThreadSnapshot)),
    stopAll: () => Effect.void,
    streamEvents: delivery.events.pipe(
      Stream.filter((event) => event.providerInstanceId === instanceId),
    ),
  };
}

/**
 * Provider status and models as the most recent runner reported them,
 * persisted by `HubProviderSnapshots` so they survive hub restarts. Before
 * any runner reported this instance the snapshot is the driver's pending
 * one, installed and ready with auth `unknown` (see `pendingRemoteSnapshot`).
 * Every runner connection reports its hosted instances; `refresh` asks a
 * connected runner to probe again.
 */
const makeRemoteSnapshot = (input: {
  readonly context: InstanceContext;
  readonly identity: RemoteInstanceIdentity;
  readonly config: unknown;
  readonly onCapabilities: (
    sessionModelSwitch: ProviderAdapterCapabilities["sessionModelSwitch"],
  ) => Effect.Effect<void>;
}) =>
  Effect.gen(function* () {
    const { context, identity } = input;
    const snapshots = yield* HubProviderSnapshots;
    const persisted = yield* snapshots.get(context.instanceId);
    const current = yield* Ref.make<ServerProvider>(
      Option.isSome(persisted)
        ? overlayHubIdentity(persisted.value, identity)
        : yield* pendingRemoteSnapshot(identity, input.config),
    );
    const changes = yield* PubSub.unbounded<ServerProvider>();

    // Reports from any runner (or the sign-in flow) arrive through the store.
    yield* snapshots.changes.pipe(
      Stream.filter((snapshot) => snapshot.instanceId === context.instanceId),
      Stream.runForEach((snapshot) => {
        const next = overlayHubIdentity(snapshot, identity);
        return Ref.set(current, next).pipe(Effect.andThen(PubSub.publish(changes, next)));
      }),
      Effect.forkScoped,
    );

    const fetchFrom = (connection: RunnerConnection, refresh: boolean, hosted?: boolean) =>
      (hosted ?? connection.hello.instances.includes(context.instanceId))
        ? connection.client["runner.provider.getCapabilities"]({
            instanceId: context.instanceId,
            ...(refresh ? { refresh } : {}),
          }).pipe(
            Effect.tap((result) => input.onCapabilities(result.sessionModelSwitch)),
            Effect.flatMap((result) =>
              snapshots.put({ ...result.snapshot, instanceId: context.instanceId }),
            ),
            Effect.catchCause((cause) =>
              Effect.logWarning("runner did not report provider capabilities", {
                instanceId: context.instanceId,
                detail: Cause.pretty(cause).slice(0, 400),
              }),
            ),
          )
        : Effect.void;

    /** The instance a thread uses: its live session's, else its model selection's. */
    const threadInstance = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const record = yield* context.registry.get(threadId);
        if (Option.isSome(record)) return record.value.instanceId;
        return (yield* context.pool.contextOf(threadId))?.providerInstanceId ?? null;
      });

    /**
     * Whether a runner's report of this instance reflects the hub's settings:
     * the runner's thread uses the instance (so its settings were pushed), or
     * the runner predates the push and only has its own settings anyway. The
     * provider sign-in machine never reports: it runs no sessions.
     */
    const reportsFor = (connection: RunnerConnection) =>
      Effect.gen(function* () {
        if (connection.threadId === PROVIDER_SIGN_IN_THREAD_ID) return false;
        if (connection.hello.protocolVersion < RUNNER_PROTOCOL_PROVIDER_SETTINGS) {
          return connection.hello.instances.includes(context.instanceId);
        }
        return (yield* threadInstance(connection.threadId)) === context.instanceId;
      });

    // Scoped to the instance: a rebuilt instance (settings changed) replaces it.
    yield* context.pool.onConnectionScoped((connection) =>
      Effect.gen(function* () {
        if (!(yield* reportsFor(connection))) return;
        const pushed = yield* context.pushSettings(connection);
        const hosted = Option.getOrElse(pushed, () => connection.hello.instances);
        if (hosted.includes(context.instanceId)) yield* fetchFrom(connection, false, true);
      }),
    );

    // Refreshing asks a connected runner whose thread uses this instance.
    const refresh = Effect.gen(function* () {
      for (const connection of yield* context.pool.connections) {
        if (!(yield* reportsFor(connection))) continue;
        yield* fetchFrom(connection, true, true);
        break;
      }
      return yield* Ref.get(current);
    });

    return {
      maintenanceCapabilities: { provider: context.driverKind, packageName: null, update: null },
      getSnapshot: Ref.get(current),
      refresh,
      streamChanges: Stream.fromPubSub(changes),
    } satisfies ServerProviderShape;
  });

/**
 * Title and branch-name generation run on the thread's runner (whose cwd the
 * request names). Commit and PR text are generated on the runner inside git
 * actions, so they are never requested from a hub.
 */
function makeRemoteTextGeneration(context: InstanceContext): TextGenerationShape {
  const { pool, instanceId } = context;
  const toTextGenerationError = (operation: string) => (error: unknown) =>
    isTextGenerationError(error)
      ? error
      : new TextGenerationError({
          operation,
          detail: isThreadMachineUnavailable(error)
            ? error.message
            : `Runner call failed: ${describe(error)}`,
          cause: error,
        });
  const onThreadRunner = <A, E>(
    operation: string,
    cwd: string,
    f: (connection: RunnerConnection) => Effect.Effect<A, E>,
  ) => {
    const threadId = parseThreadCheckoutPath(cwd, pool.checkoutRoot);
    return threadId === null
      ? Effect.fail(
          new TextGenerationError({
            operation,
            detail: `${cwd} is not a thread checkout, so no thread machine can generate this text.`,
          }),
        )
      : pool
          .use(threadId, { wake: true, operation: `text.${operation}` }, (connection) =>
            context.pushSettings(connection).pipe(Effect.andThen(f(connection))),
          )
          .pipe(Effect.mapError(toTextGenerationError(operation)));
  };
  const onRunnerOnly = (operation: string) =>
    Effect.fail(
      new TextGenerationError({
        operation,
        detail: "Runs on the thread's runner as part of git actions, never on the hub.",
      }),
    );
  return {
    generateThreadTitle: (request) =>
      context.readAttachments(request.attachments).pipe(
        Effect.mapError(toTextGenerationError("generateThreadTitle")),
        Effect.flatMap((attachments) =>
          onThreadRunner("generateThreadTitle", request.cwd, (connection) =>
            connection.client["runner.text.generateThreadTitle"]({
              instanceId,
              cwd: request.cwd,
              message: request.message,
              attachments,
              modelSelection: request.modelSelection,
              ...(request.previousTitle !== undefined
                ? { previousTitle: request.previousTitle }
                : {}),
            }),
          ),
        ),
      ),
    generateBranchName: (request) =>
      context.readAttachments(request.attachments).pipe(
        Effect.mapError(toTextGenerationError("generateBranchName")),
        Effect.flatMap((attachments) =>
          onThreadRunner("generateBranchName", request.cwd, (connection) =>
            connection.client["runner.text.generateBranchName"]({
              instanceId,
              cwd: request.cwd,
              message: request.message,
              attachments,
              modelSelection: request.modelSelection,
            }),
          ),
        ),
      ),
    generateCommitMessage: () => onRunnerOnly("generateCommitMessage"),
    generatePrContent: () => onRunnerOnly("generatePrContent"),
    generateStructured: () => onRunnerOnly("generateStructured"),
  };
}
