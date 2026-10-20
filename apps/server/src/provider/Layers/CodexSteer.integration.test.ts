/**
 * A message sent while a Codex turn runs joins that turn (turn/steer), as
 * Codex's own composer steers, so it reaches the agent at its next step
 * rather than after the turn. Boots the real CodexSessionRuntime against the
 * scripted mock app-server peer, which records the turn/start and turn/steer
 * requests it gets.
 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { assert, describe } from "vite-plus/test";

import wireFixture from "../testFixtures/codexMultiAgentWire.json" with { type: "json" };
import { makeCodexSessionRuntime } from "./CodexSessionRuntime.ts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

const ROOT = wireFixture.rootThreadId;
const FIRST_TURN = "019fe3e8-f908-7f31-8d51-283f4a47897a";
const SECOND_TURN = "019fe3eb-8faf-7de3-a85b-ac64c7f9c8c3";
const THIRD_TURN = "019fe3ee-0b52-7a8e-9c4d-5b7f2e1d3a90";

// A script of its own, so it runs alongside the collab tests' file.
const scriptPath = NodePath.join(import.meta.dirname, "../testFixtures/.steer-script.json");
const peerPath = NodePath.join(
  import.meta.dirname,
  `../testFixtures/codexCollabMockPeer.${HostProcessPlatform.defaultValue() === "win32" ? "cmd" : "sh"}`,
);

type Sent = { method: string; text: string | undefined; expectedTurnId: string | undefined };

/** What the peer was sent, oldest first: each turn/start and turn/steer, with its words. */
function sentTurns(): Sent[] {
  return NodeFS.readFileSync(`${scriptPath}.requests`, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const { method, params } = JSON.parse(line) as {
        method: string;
        params: { input?: { text?: string }[]; expectedTurnId?: string };
      };
      return { method, text: params.input?.[0]?.text, expectedTurnId: params.expectedTurnId };
    });
}

const withRuntime = (script: Record<string, unknown>) =>
  Effect.gen(function* () {
    const written = {
      rootThreadId: ROOT,
      recordTurns: true,
      onlyFirstTurnStarts: true,
      turnIds: [FIRST_TURN, SECOND_TURN, THIRD_TURN],
      notifications: [],
      ...script,
    };
    // @effect-diagnostics-next-line preferSchemaOverJson:off
    NodeFS.writeFileSync(scriptPath, JSON.stringify(written), "utf8");
    NodeFS.rmSync(`${scriptPath}.requests`, { force: true });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        NodeFS.rmSync(scriptPath, { force: true });
        NodeFS.rmSync(`${scriptPath}.requests`, { force: true });
      }),
    );
    const runtime = yield* makeCodexSessionRuntime({
      threadId: ThreadId.make("thread-codex-steer"),
      binaryPath: peerPath,
      cwd: NodeOS.tmpdir(),
      runtimeMode: "full-access",
      environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
    });
    yield* Effect.addFinalizer(() => runtime.close);
    yield* runtime.start();
    return runtime;
  });

describe("CodexSessionRuntime steering", () => {
  it.live("a message sent while a turn runs joins that turn", () =>
    Effect.gen(function* () {
      const runtime = yield* withRuntime({ holdTurnOpen: true });
      const first = yield* runtime.sendTurn({ input: "keep working" });
      assert.equal(first.turnId, FIRST_TURN);
      const second = yield* runtime.sendTurn({ input: "the Windows computer is running" });
      assert.equal(second.turnId, FIRST_TURN, "it joined the running turn");
      assert.deepEqual(sentTurns(), [
        { method: "turn/start", text: "keep working", expectedTurnId: undefined },
        {
          method: "turn/steer",
          text: "the Windows computer is running",
          expectedTurnId: FIRST_TURN,
        },
      ]);
      assert.equal((yield* runtime.getSession).activeTurnId, FIRST_TURN);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("one asking for settings the running turn can't take waits behind it", () =>
    Effect.gen(function* () {
      const runtime = yield* withRuntime({ holdTurnOpen: true });
      yield* runtime.sendTurn({ input: "keep working", model: "gpt-5.6-sol", effort: "high" });
      const plan = yield* runtime.sendTurn({
        input: "plan it instead",
        model: "gpt-5.6-sol",
        effort: "high",
        interactionMode: "plan",
      });
      assert.equal(plan.turnId, SECOND_TURN, "a turn of its own");
      const effort = yield* runtime.sendTurn({
        input: "think less",
        model: "gpt-5.6-sol",
        effort: "low",
      });
      assert.equal(effort.turnId, THIRD_TURN, "nor joins the first while one waits behind it");
      assert.deepEqual(
        sentTurns().map((sent) => sent.method),
        ["turn/start", "turn/start", "turn/start"],
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live(
    "messages sent together keep their order: none joins the turn ahead of one queued before it",
    () =>
      Effect.gen(function* () {
        // The plan message's turn/start is answered late, so the next is sent while it's on its way.
        const runtime = yield* withRuntime({ holdTurnOpen: true, queuedTurnStartDelayMs: 300 });
        yield* runtime.sendTurn({ input: "keep working" });
        const [plan, next] = yield* Effect.all(
          [
            runtime.sendTurn({ input: "plan it", interactionMode: "plan" }),
            runtime.sendTurn({ input: "and then this" }),
          ],
          { concurrency: "unbounded" },
        );
        assert.equal(plan.turnId, SECOND_TURN);
        assert.equal(next.turnId, THIRD_TURN, "queued behind the plan, not into the running turn");
        assert.deepEqual(
          sentTurns().map((sent) => [sent.method, sent.text]),
          [
            ["turn/start", "keep working"],
            ["turn/start", "plan it"],
            ["turn/start", "and then this"],
          ],
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("one Codex refuses to take goes as a turn of its own", () =>
    Effect.gen(function* () {
      const runtime = yield* withRuntime({ holdTurnOpen: true, refuseSteer: true });
      yield* runtime.sendTurn({ input: "keep working" });
      const second = yield* runtime.sendTurn({ input: "news" });
      assert.equal(second.turnId, SECOND_TURN);
      assert.deepEqual(sentTurns(), [
        { method: "turn/start", text: "keep working", expectedTurnId: undefined },
        { method: "turn/steer", text: "news", expectedTurnId: FIRST_TURN },
        { method: "turn/start", text: "news", expectedTurnId: undefined },
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("once the turn has ended, a message starts the next", () =>
    Effect.gen(function* () {
      const runtime = yield* withRuntime({ holdTurnOpen: false, onlyFirstTurnStarts: false });
      const completed = yield* runtime.events.pipe(
        Stream.filter((event) => event.method === "turn/completed"),
        Stream.take(1),
        Stream.runDrain,
        Effect.forkScoped,
      );
      yield* runtime.sendTurn({ input: "done soon" });
      yield* Fiber.join(completed);
      const next = yield* runtime.sendTurn({ input: "next" });
      assert.equal(next.turnId, SECOND_TURN);
      assert.deepEqual(
        sentTurns()
          .filter((sent) => sent.method === "turn/start")
          .map((sent) => sent.text),
        ["done soon", "next"],
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
