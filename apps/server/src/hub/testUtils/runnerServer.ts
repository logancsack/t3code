// @effect-diagnostics nodeBuiltinImport:off -- Loopback test server.
/**
 * Test helpers: serve `RunnerRpcGroup` handlers on a loopback port, and a fake
 * runner whose handlers default to failing loudly so tests implement exactly
 * the calls they expect.
 *
 * @module hub/testUtils/runnerServer
 */
import * as NodeHttp from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import {
  RUNNER_PROTOCOL_VERSION,
  RUNNER_WS_PATH,
  type RunnerHello,
  RunnerRpcGroup,
} from "@t3tools/contracts/runner";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import type * as Rpc from "effect/unstable/rpc/Rpc";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

type RunnerHandlers = Parameters<typeof RunnerRpcGroup.of>[0];

const STREAM_TAGS = new Set([
  "runner.events.subscribe",
  "runner.vcs.streamStatus",
  "runner.git.runStackedAction",
  "runner.terminal.attach",
  "runner.terminal.events",
  "runner.terminal.metadata",
]);

/** Handlers for every RPC: streams stay open and emit nothing, calls die. */
export const unimplementedRunnerHandlers = (): RunnerHandlers =>
  Object.fromEntries(
    [...RunnerRpcGroup.requests.keys()].map((tag) => [
      tag,
      STREAM_TAGS.has(tag)
        ? () => Stream.never
        : () => Effect.die(new Error(`fake runner: ${tag} is not implemented`)),
    ]),
  ) as unknown as RunnerHandlers;

export const fakeRunnerHello = (overrides: Partial<RunnerHello> & Pick<RunnerHello, "threadId">) =>
  ({
    protocolVersion: RUNNER_PROTOCOL_VERSION,
    runnerId: "runner-test",
    bootId: "boot-1",
    checkout: `/workspace/t/${overrides.threadId}`,
    headSequence: 0,
    ackedSequence: 0,
    firstRetainedSequence: 1,
    instances: [],
    ...overrides,
  }) satisfies RunnerHello;

/**
 * Serves `handlers` at `RUNNER_WS_PATH` on 127.0.0.1 with an OS-assigned port
 * for the lifetime of the scope. Returns the runner's WebSocket URL.
 */
export const serveRunner = <ROut, E, R>(handlers: Layer.Layer<ROut, E, R>) =>
  Effect.gen(function* () {
    const routes = Layer.unwrap(
      Effect.gen(function* () {
        const built = yield* Layer.build(
          handlers.pipe(Layer.provideMerge(RpcSerialization.layerJson)),
        );
        const httpEffect = yield* RpcServer.toHttpEffectWebsocket(RunnerRpcGroup, {
          disableTracing: true,
        }).pipe(Effect.provide(built));
        return HttpRouter.add("GET", RUNNER_WS_PATH, httpEffect);
      }),
    );
    const context = yield* Layer.build(
      HttpRouter.serve(routes, { disableListenLog: true, disableLogger: true }).pipe(
        Layer.provideMerge(
          NodeHttpServer.layer(NodeHttp.createServer, {
            host: "127.0.0.1",
            port: 0,
            // Close open runner sockets at once, like a runner process exiting.
            disablePreemptiveShutdown: true,
          }),
        ),
      ),
    );
    const address = Context.get(context, HttpServer.HttpServer).address as HttpServer.TcpAddress;
    return { url: `ws://127.0.0.1:${address.port}${RUNNER_WS_PATH}` };
  });

/** A runner whose unimplemented calls die; `overrides` supplies the ones a test uses. */
export const fakeRunner = (
  overrides: Partial<RunnerHandlers>,
): Layer.Layer<Rpc.ToHandler<RpcGroup.Rpcs<typeof RunnerRpcGroup>>> =>
  // @effect-diagnostics-next-line anyUnknownInErrorContext:off - handler overrides are loosely typed test doubles.
  RunnerRpcGroup.toLayer(
    Effect.succeed(RunnerRpcGroup.of({ ...unimplementedRunnerHandlers(), ...overrides })),
  ) as Layer.Layer<Rpc.ToHandler<RpcGroup.Rpcs<typeof RunnerRpcGroup>>>;
