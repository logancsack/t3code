// @effect-diagnostics nodeBuiltinImport:off -- The delivery cursor is a tiny synchronous state file.
/**
 * RunnerClient - the hub's connection to a runner (prototype).
 *
 * Owns one supervised WebSocket RPC connection to the configured runner,
 * reconnecting with backoff. Calls wait (bounded) for a live connection.
 *
 * Event delivery: once the hub's ingestion is running (`startDelivery`), the
 * client subscribes to the runner outbox from its durable cursor, drops any
 * sequence it already delivered, and fans events out to the remote adapters.
 * `ackDelivered` persists the cursor and lets the runner compact; the caller
 * invokes it only after ingestion has drained, so an acknowledged event has
 * been projected.
 *
 * In production the hub would route by thread to that thread's machine; the
 * prototype has one runner URL for the whole hub.
 *
 * @module runner/hub/RunnerClient
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { ProviderInstanceId, ProviderRuntimeEvent } from "@t3tools/contracts";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError";
import * as Socket from "effect/unstable/socket/Socket";

import { ServerConfig } from "../../config.ts";
import { type RunnerHello, RunnerRpcGroup } from "../RunnerProtocol.ts";

export type RunnerRpcClient = RpcClient.FromGroup<typeof RunnerRpcGroup, RpcClientError>;

export class RunnerUnavailableError extends Schema.TaggedErrorClass<RunnerUnavailableError>()(
  "RunnerUnavailableError",
  { detail: Schema.String },
) {
  override get message(): string {
    return `Runner unavailable: ${this.detail}`;
  }
}

export interface RunnerDeliveryState {
  readonly runnerId: string | null;
  readonly bootId: string | null;
  readonly deliveredSequence: number;
  readonly ackedSequence: number;
  readonly deliveredCount: number;
  readonly duplicateCount: number;
  readonly connectCount: number;
}

export class RunnerClient extends Context.Service<
  RunnerClient,
  {
    readonly enabled: boolean;
    /** Run one call against the live connection, waiting briefly for one. */
    readonly use: <A, E>(
      f: (client: RunnerRpcClient) => Effect.Effect<A, E>,
    ) => Effect.Effect<A, E | RunnerUnavailableError>;
    readonly hello: Effect.Effect<RunnerHello, RunnerUnavailableError>;
    /** Provider runtime events for one instance, in runner sequence order. */
    readonly eventsFor: (instanceId: ProviderInstanceId) => Stream.Stream<ProviderRuntimeEvent>;
    /** Opens the outbox subscription. Call once hub ingestion is consuming. */
    readonly startDelivery: Effect.Effect<void>;
    readonly deliveryState: Effect.Effect<RunnerDeliveryState>;
    /** Persist the cursor and acknowledge everything delivered so far. */
    readonly ackDelivered: (throughSequence: number) => Effect.Effect<void>;
  }
>()("t3/runner/hub/RunnerClient") {}

const CONNECT_WAIT = Duration.seconds(20);
const RECONNECT_DELAY = Duration.seconds(1);

interface Connection {
  readonly client: RunnerRpcClient;
  readonly hello: RunnerHello;
}

const PersistedCursorJson = Schema.fromJsonString(
  Schema.Struct({ runnerId: Schema.NullOr(Schema.String), ackedSequence: Schema.Number }),
);
type PersistedCursor = typeof PersistedCursorJson.Type;
const decodeCursor = Schema.decodeUnknownSync(PersistedCursorJson);
const encodeCursor = Schema.encodeSync(PersistedCursorJson);

function readCursor(path: string): PersistedCursor {
  try {
    return decodeCursor(NodeFS.readFileSync(path, "utf8"));
  } catch {
    return { runnerId: null, ackedSequence: 0 };
  }
}

function writeCursor(path: string, cursor: PersistedCursor): void {
  const tmp = `${path}.tmp`;
  NodeFS.writeFileSync(tmp, encodeCursor(cursor));
  NodeFS.renameSync(tmp, path);
}

const makeLive = (runnerUrl: string) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const cursorPath = NodePath.join(config.stateDir, "runner-client-cursor.json");
    const persisted = readCursor(cursorPath);
    const url = new URL(runnerUrl);
    if (config.runnerToken) url.searchParams.set("token", config.runnerToken);
    const socketUrl = url.toString();

    const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const readyRef = yield* Ref.make(yield* Deferred.make<Connection>());
    const deliveryEnabled = yield* Deferred.make<void>();
    const state = yield* Ref.make<RunnerDeliveryState>({
      runnerId: persisted.runnerId,
      bootId: null,
      deliveredSequence: persisted.ackedSequence,
      ackedSequence: persisted.ackedSequence,
      deliveredCount: 0,
      duplicateCount: 0,
      connectCount: 0,
    });

    const awaitConnection = Ref.get(readyRef).pipe(
      Effect.flatMap(Deferred.await),
      Effect.timeoutOrElse({
        duration: CONNECT_WAIT,
        orElse: () =>
          Effect.fail(
            new RunnerUnavailableError({
              detail: `no connection to ${runnerUrl} within ${Duration.format(CONNECT_WAIT)}`,
            }),
          ),
      }),
    );

    const pumpEvents = (client: RunnerRpcClient) =>
      Effect.gen(function* () {
        yield* Deferred.await(deliveryEnabled);
        const { deliveredSequence } = yield* Ref.get(state);
        yield* Effect.logInfo("runner event subscription opened", {
          afterSequence: deliveredSequence,
        });
        yield* client["runner.events.subscribe"]({ afterSequence: deliveredSequence }).pipe(
          Stream.runForEach((envelope) =>
            Ref.modify(state, (current) => {
              if (envelope.sequence <= current.deliveredSequence) {
                return [false, { ...current, duplicateCount: current.duplicateCount + 1 }] as const;
              }
              return [
                true,
                {
                  ...current,
                  deliveredSequence: envelope.sequence,
                  deliveredCount: current.deliveredCount + 1,
                },
              ] as const;
            }).pipe(
              Effect.flatMap((fresh) =>
                fresh ? PubSub.publish(events, envelope.event).pipe(Effect.asVoid) : Effect.void,
              ),
            ),
          ),
        );
      });

    const connectOnce = Effect.scoped(
      Effect.gen(function* () {
        const disconnected = yield* Deferred.make<void>();
        const hooks = RpcClient.ConnectionHooks.of({
          onConnect: Effect.void,
          onDisconnect: Deferred.succeed(disconnected, undefined).pipe(Effect.asVoid),
        });
        const protocol = yield* Layer.build(
          Layer.effect(
            RpcClient.Protocol,
            RpcClient.makeProtocolSocket({ retryTransientErrors: false }),
          ).pipe(
            Layer.provide(
              Layer.mergeAll(
                Socket.layerWebSocket(socketUrl, { openTimeout: Duration.seconds(5) }).pipe(
                  Layer.provide(NodeSocket.layerWebSocketConstructor),
                ),
                RpcSerialization.layerJson,
                Layer.succeed(RpcClient.ConnectionHooks, hooks),
              ),
            ),
          ),
        );
        const client = yield* RpcClient.make(RunnerRpcGroup, { disableTracing: true }).pipe(
          Effect.provide(protocol),
        );
        const hello = yield* client["runner.hello"]({}).pipe(Effect.timeout("10 seconds"));
        yield* Ref.update(state, (current) => {
          // A different runner identity means a different outbox; its
          // sequences restart, so the cursor restarts with it.
          const sameRunner = current.runnerId === null || current.runnerId === hello.runnerId;
          return {
            ...current,
            runnerId: hello.runnerId,
            bootId: hello.bootId,
            connectCount: current.connectCount + 1,
            ...(sameRunner ? {} : { deliveredSequence: 0, ackedSequence: 0 }),
          };
        });
        yield* Effect.logInfo("runner connected", {
          runnerId: hello.runnerId,
          bootId: hello.bootId,
          headSequence: hello.headSequence,
          runnerAckedSequence: hello.ackedSequence,
          instances: hello.instances,
        });
        const ready = yield* Ref.get(readyRef);
        yield* Deferred.succeed(ready, { client, hello });
        yield* Effect.raceFirst(Deferred.await(disconnected), pumpEvents(client));
      }),
    ).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          const current = yield* Ref.get(readyRef);
          if (yield* Deferred.isDone(current)) {
            yield* Ref.set(readyRef, yield* Deferred.make<Connection>());
          }
        }),
      ),
    );

    yield* connectOnce.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("runner connection ended", { cause: String(cause).slice(0, 400) }),
      ),
      Effect.andThen(Effect.sleep(RECONNECT_DELAY)),
      Effect.forever,
      Effect.forkScoped,
    );

    const use = <A, E>(f: (client: RunnerRpcClient) => Effect.Effect<A, E>) =>
      awaitConnection.pipe(Effect.flatMap((connection) => f(connection.client)));

    const ackDelivered = (throughSequence: number) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(state);
        if (throughSequence <= current.ackedSequence) return;
        writeCursor(cursorPath, { runnerId: current.runnerId, ackedSequence: throughSequence });
        const latest = yield* Ref.updateAndGet(state, (value) => ({
          ...value,
          ackedSequence: throughSequence,
        }));
        yield* Effect.logInfo("runner events acknowledged", {
          throughSequence,
          deliveredCount: latest.deliveredCount,
          duplicateCount: latest.duplicateCount,
          connectCount: latest.connectCount,
        });
        yield* use((client) => client["runner.events.ack"]({ throughSequence })).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("runner ack failed; it is retried with the next ack", {
              throughSequence,
              cause: String(cause).slice(0, 200),
            }),
          ),
        );
      });

    return RunnerClient.of({
      enabled: true,
      use,
      hello: awaitConnection.pipe(Effect.map((connection) => connection.hello)),
      eventsFor: (instanceId) =>
        Stream.fromPubSub(events).pipe(
          Stream.filter((event) => event.providerInstanceId === instanceId),
        ),
      startDelivery: Deferred.succeed(deliveryEnabled, undefined).pipe(Effect.asVoid),
      deliveryState: Ref.get(state),
      ackDelivered,
    });
  });

const disabled = RunnerClient.of({
  enabled: false,
  use: () => Effect.fail(new RunnerUnavailableError({ detail: "no runner configured" })),
  hello: Effect.fail(new RunnerUnavailableError({ detail: "no runner configured" })),
  eventsFor: () => Stream.empty,
  startDelivery: Effect.void,
  deliveryState: Effect.succeed({
    runnerId: null,
    bootId: null,
    deliveredSequence: 0,
    ackedSequence: 0,
    deliveredCount: 0,
    duplicateCount: 0,
    connectCount: 0,
  }),
  ackDelivered: () => Effect.void,
});

/** Live client in hub mode (`T3CODE_RUNNER_URL`), an inert one otherwise. */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    return config.runnerUrl
      ? Layer.effect(RunnerClient, makeLive(config.runnerUrl))
      : Layer.succeed(RunnerClient, disabled);
  }),
);
