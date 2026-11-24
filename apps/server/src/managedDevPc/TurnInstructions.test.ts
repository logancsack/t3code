// @effect-diagnostics nodeBuiltinImport:off - the test writes the file Aldo writes.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { RunId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as TurnInstructions from "./TurnInstructions.ts";

const base = ServerConfig.layerTest(process.cwd(), { prefix: "t3-turn-instructions-" }).pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
);

/** The service as a server started with (or without) `T3CODE_MANAGED_DEVPC` builds it. */
const withService = <A, E>(
  managedDevPc: boolean,
  body: (service: TurnInstructions.TurnInstructions["Service"]) => Effect.Effect<A, E, never>,
) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    NodeFS.mkdirSync(config.stateDir, { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(config.stateDir, "turn-instructions.json"),
      JSON.stringify({ contract: "aldo-result", version: 7, text: "End with the result block." }),
    );
    const sql = yield* SqlClient.SqlClient;
    const service = yield* TurnInstructions.make.pipe(
      Effect.provideService(ServerConfig.ServerConfig, { ...config, managedDevPc }),
    );
    const tables = () =>
      sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'aldo_%' ORDER BY name
      `.pipe(Effect.map((rows) => rows.map((row) => row.name)));
    return { result: yield* body(service), tables: yield* tables() };
  }).pipe(Effect.provide(base));

it.effect("gives a managed turn the file's text and records which version it was given", () =>
  Effect.gen(function* () {
    const sent = RunId.make("run-sent");
    const command = RunId.make("run-command");
    const { result } = yield* withService(true, (service) =>
      Effect.gen(function* () {
        const text = yield* service.supply({ runId: sent, userText: "Fix the bug" });
        // A slash command's arguments must stay the user's own.
        const none = yield* service.supply({ runId: command, userText: "/compact now" });
        return { text, none, supplied: yield* service.supplied([sent, command]) };
      }),
    );
    assert.strictEqual(result.text, "End with the result block.");
    assert.strictEqual(result.none, "");
    assert.deepStrictEqual([...result.supplied], [[sent, { contract: "aldo-result", version: 7 }]]);
  }),
);

it.effect("leaves a server that is not managed alone: no text, no tables", () =>
  Effect.gen(function* () {
    const { result, tables } = yield* withService(false, (service) =>
      service.supply({ runId: RunId.make("run-1"), userText: "Fix the bug" }),
    );
    assert.strictEqual(result, "");
    assert.deepStrictEqual(tables, []);
  }),
);

it.effect("keeps its own ledger, so building it twice changes nothing", () =>
  Effect.gen(function* () {
    const { tables } = yield* withService(true, () =>
      TurnInstructions.make.pipe(
        Effect.provideServiceEffect(
          ServerConfig.ServerConfig,
          Effect.map(ServerConfig.ServerConfig, (config) => ({ ...config, managedDevPc: true })),
        ),
        Effect.provide(base),
        Effect.asVoid,
      ),
    );
    assert.deepStrictEqual(tables, ["aldo_schema_migrations", "aldo_turn_instructions"]);
  }),
);

it("drops instructions that are malformed or would push the turn past its limit", () => {
  const file = JSON.stringify({ contract: "aldo-result", version: 1, text: "x".repeat(100) });
  assert.strictEqual(TurnInstructions.parseTurnInstructions(file)?.version, 1);
  assert.isNull(TurnInstructions.parseTurnInstructions(file, 119_950));
  assert.isNull(
    TurnInstructions.parseTurnInstructions('{"contract":"Bad Name","version":1,"text":"x"}'),
  );
  assert.isNull(TurnInstructions.parseTurnInstructions("not json"));
});
