/**
 * RemoteProviderDriver - hub-side provider driver that runs nothing locally.
 *
 * Wraps a built-in driver's identity (driver kind, config schema, defaults) so
 * the hub keeps the same instance ids, model selections and session directory
 * rows, while the adapter forwards every call to the runner that owns the
 * checkout. `ProviderService` above it is unchanged: it still persists resume
 * cursors, recovers sessions and serializes per-thread lifecycle work.
 *
 * `listSessions`/`hasSession` ask the runner so that a hub restart adopts the
 * runner's still-running sessions instead of marking them orphaned; when the
 * runner is unreachable they report nothing and `ProviderService` recovers
 * through the persisted resume cursor on the next turn.
 *
 * @module runner/hub/RemoteProviderDriver
 */
import {
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
  TextGenerationError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import {
  type ProviderAdapterError,
  ProviderAdapterRequestError,
  ProviderDriverError,
} from "../../provider/Errors.ts";
import {
  defaultProviderContinuationIdentity,
  type AnyProviderDriver,
  type ProviderInstance,
} from "../../provider/ProviderDriver.ts";
import type {
  ProviderAdapterShape,
  ProviderThreadSnapshot,
} from "../../provider/Services/ProviderAdapter.ts";
import type { ServerProviderShape } from "../../provider/Services/ServerProvider.ts";
import type { TextGenerationShape } from "../../textGeneration/TextGeneration.ts";
import { buildUnavailableProviderSnapshot } from "../../provider/unavailableProviderSnapshot.ts";
import { RunnerClient, type RunnerRpcClient } from "./RunnerClient.ts";

const describe = (cause: unknown): string => {
  if (cause && typeof cause === "object" && "message" in cause) {
    return String((cause as { message: unknown }).message);
  }
  return String(cause);
};

export function makeRemoteProviderDriver<Config, R>(
  base: AnyProviderDriver<R>,
): AnyProviderDriver<R> {
  const driverKind: ProviderDriverKind = base.driverKind;
  return {
    driverKind,
    metadata: base.metadata,
    configSchema: base.configSchema,
    defaultConfig: base.defaultConfig as () => Config,
    create: ({ instanceId, displayName, accentColor, enabled }) =>
      Effect.gen(function* () {
        const runnerOption = yield* Effect.serviceOption(RunnerClient);
        if (Option.isNone(runnerOption) || !runnerOption.value.enabled) {
          return yield* new ProviderDriverError({
            driver: driverKind,
            instanceId,
            detail: "Hub mode requires a configured runner.",
          });
        }
        const runner = runnerOption.value;
        const adapter = makeRemoteAdapter({ runner, driverKind, instanceId });
        const snapshot = yield* makeRemoteSnapshot({
          runner,
          driverKind,
          instanceId,
          displayName,
          accentColor,
        });
        const textGeneration = makeRemoteTextGeneration({ runner, instanceId });
        return {
          instanceId,
          driverKind,
          continuationIdentity: defaultProviderContinuationIdentity({ driverKind, instanceId }),
          displayName,
          accentColor,
          enabled,
          snapshot,
          adapter,
          textGeneration,
        } satisfies ProviderInstance;
      }),
  };
}

function makeRemoteAdapter(input: {
  readonly runner: RunnerClient["Service"];
  readonly driverKind: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
}): ProviderAdapterShape<ProviderAdapterError> {
  const { runner, driverKind, instanceId } = input;

  const call = <A>(
    method: string,
    f: (client: RunnerRpcClient) => Effect.Effect<A, ProviderAdapterError | { _tag: string }>,
  ): Effect.Effect<A, ProviderAdapterError> =>
    runner.use(f).pipe(
      Effect.mapError((error): ProviderAdapterError => {
        switch (error._tag) {
          case "ProviderAdapterValidationError":
          case "ProviderAdapterSessionNotFoundError":
          case "ProviderAdapterSessionClosedError":
          case "ProviderAdapterRequestError":
          case "ProviderAdapterProcessError":
            return error as ProviderAdapterError;
          default:
            return new ProviderAdapterRequestError({
              provider: driverKind,
              method,
              detail: `runner call failed: ${describe(error)}`,
              cause: error,
            });
        }
      }),
    );

  const listSessions = () =>
    runner.hello
      .pipe(
        Effect.map((hello) => hello.instances.includes(instanceId)),
        Effect.orElseSucceed(() => true),
        Effect.flatMap((hosted) =>
          hosted
            ? call("listSessions", (client) =>
                client["runner.provider.listSessions"]({ instanceId }),
              )
            : Effect.succeed([]),
        ),
      )
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("remote listSessions unavailable; reporting none", {
            instanceId,
            detail: error.message,
          }).pipe(Effect.as([])),
        ),
      );

  const toThreadSnapshot = (snapshot: {
    readonly threadId: ProviderThreadSnapshot["threadId"];
    readonly turns: ReadonlyArray<{ readonly id: string; readonly items: ReadonlyArray<unknown> }>;
  }): ProviderThreadSnapshot => snapshot as ProviderThreadSnapshot;

  return {
    provider: driverKind,
    // Model switching is a property of the runner's real adapter; the hub
    // treats it as in-session and lets the runner reject when unsupported.
    capabilities: { sessionModelSwitch: "in-session" },
    startSession: (sessionInput) =>
      call("startSession", (client) =>
        client["runner.provider.startSession"]({ instanceId, input: sessionInput }),
      ),
    sendTurn: (turnInput) =>
      call("sendTurn", (client) =>
        client["runner.provider.sendTurn"]({ instanceId, input: turnInput }),
      ),
    interruptTurn: (threadId, turnId) =>
      call("interruptTurn", (client) =>
        client["runner.provider.interruptTurn"]({
          instanceId,
          threadId,
          ...(turnId !== undefined ? { turnId } : {}),
        }),
      ),
    respondToRequest: (threadId, requestId, decision) =>
      call("respondToRequest", (client) =>
        client["runner.provider.respondToRequest"]({ instanceId, threadId, requestId, decision }),
      ),
    respondToUserInput: (threadId, requestId, answers) =>
      call("respondToUserInput", (client) =>
        client["runner.provider.respondToUserInput"]({ instanceId, threadId, requestId, answers }),
      ),
    stopSession: (threadId) =>
      call("stopSession", (client) =>
        client["runner.provider.stopSession"]({ instanceId, threadId }),
      ),
    listSessions,
    hasSession: (threadId) =>
      listSessions().pipe(
        Effect.map((sessions) => sessions.some((session) => session.threadId === threadId)),
      ),
    readThread: (threadId) =>
      call("readThread", (client) =>
        client["runner.provider.readThread"]({ instanceId, threadId }),
      ).pipe(Effect.map(toThreadSnapshot)),
    rollbackThread: (threadId, numTurns) =>
      call("rollbackThread", (client) =>
        client["runner.provider.rollbackThread"]({ instanceId, threadId, numTurns }),
      ).pipe(Effect.map(toThreadSnapshot)),
    // A hub shutting down must not stop sessions it does not host; the runner
    // keeps them running and outboxes their events until the hub returns.
    stopAll: () => Effect.void,
    streamEvents: runner.eventsFor(instanceId),
  };
}

const makeRemoteSnapshot = (input: {
  readonly runner: RunnerClient["Service"];
  readonly driverKind: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly displayName: string | undefined;
  readonly accentColor: string | undefined;
}) =>
  Effect.gen(function* () {
    const { runner, driverKind, instanceId } = input;
    const pending = yield* buildUnavailableProviderSnapshot({
      driverKind,
      instanceId,
      displayName: input.displayName,
      accentColor: input.accentColor,
      reason: "Waiting for the thread machine to report this provider.",
    });
    const current = yield* Ref.make<ServerProvider>(pending);
    const changes = yield* PubSub.unbounded<ServerProvider>();

    const fetch = (refresh: boolean) =>
      runner
        .use((client) =>
          client["runner.provider.getCapabilities"]({
            instanceId,
            ...(refresh ? { refresh } : {}),
          }),
        )
        .pipe(
          Effect.map((result) => result.snapshot),
          Effect.catch((error) =>
            buildUnavailableProviderSnapshot({
              driverKind,
              instanceId,
              displayName: input.displayName,
              accentColor: input.accentColor,
              reason: `Runner did not report this provider: ${describe(error)}`,
            }),
          ),
          Effect.tap((snapshot) => Ref.set(current, snapshot)),
          Effect.tap((snapshot) => PubSub.publish(changes, snapshot)),
        );

    // Populate in the background so hub startup never waits on a machine.
    yield* fetch(false).pipe(Effect.forkScoped);

    return {
      maintenanceCapabilities: { provider: driverKind, packageName: null, update: null },
      getSnapshot: Ref.get(current),
      refresh: fetch(true),
      streamChanges: Stream.fromPubSub(changes),
    } satisfies ServerProviderShape;
  });

function makeRemoteTextGeneration(input: {
  readonly runner: RunnerClient["Service"];
  readonly instanceId: ProviderInstanceId;
}): TextGenerationShape {
  const { runner, instanceId } = input;
  const toTextGenerationError = (operation: string) => (error: { readonly _tag: string }) =>
    error._tag === "TextGenerationError"
      ? (error as TextGenerationError)
      : new TextGenerationError({
          operation,
          detail: `runner call failed: ${describe(error)}`,
        });
  const unsupported = (operation: string) =>
    Effect.fail(
      new TextGenerationError({
        operation,
        detail: "Not delegated to the runner in prototype 2.",
      }),
    );
  return {
    generateThreadTitle: (request) =>
      runner
        .use((client) =>
          client["runner.text.generateThreadTitle"]({
            instanceId,
            cwd: request.cwd,
            message: request.message,
            ...(request.previousTitle !== undefined
              ? { previousTitle: request.previousTitle }
              : {}),
            ...(request.attachments !== undefined ? { attachments: request.attachments } : {}),
            modelSelection: request.modelSelection,
          }),
        )
        .pipe(Effect.mapError(toTextGenerationError("generateThreadTitle"))),
    generateBranchName: (request) =>
      runner
        .use((client) =>
          client["runner.text.generateBranchName"]({
            instanceId,
            cwd: request.cwd,
            message: request.message,
            ...(request.attachments !== undefined ? { attachments: request.attachments } : {}),
            modelSelection: request.modelSelection,
          }),
        )
        .pipe(Effect.mapError(toTextGenerationError("generateBranchName"))),
    generateCommitMessage: () => unsupported("generateCommitMessage"),
    generatePrContent: () => unsupported("generatePrContent"),
    generateStructured: () => unsupported("generateStructured"),
  };
}
