/**
 * Context Aldo supplies with every turn of a managed workspace, read afresh from
 * `<stateDir>/turn-instructions.json` each time so a running conversation adopts a new version
 * without a restart. What each run was given is recorded, because Aldo reads a turn's result
 * by the contract version that turn was actually sent.
 */
import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS, type RunId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fn from "effect/Function";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import { ensureAldoSchema } from "./AldoSchema.ts";

const decode = Schema.decodeOption(
  Schema.fromJsonString(
    Schema.Struct({
      contract: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,79}$/)),
      version: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 999 })),
      text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(12_000)),
    }),
  ),
);

/** The file's instructions, or null when it is malformed or would push the turn over its limit. */
export function parseTurnInstructions(value: string, userTextLength = 0) {
  if (value.length > 16_000) return null;
  const instructions = Option.getOrNull(decode(value));
  return instructions &&
    userTextLength + 2 + instructions.text.length <= PROVIDER_SEND_TURN_MAX_INPUT_CHARS
    ? instructions
    : null;
}

// A provider can read slash input as a native command's arguments; context must not join them.
const isSlashCommand = (text: string) => /^\/[^\s/]+(?:\s|$)/.test(text);

export interface SuppliedTurnInstructions {
  readonly contract: string;
  readonly version: number;
}

export class TurnInstructions extends Context.Service<
  TurnInstructions,
  {
    /** The text to send with this run's message, or "" for none. Records what it answers. */
    readonly supply: (input: {
      readonly runId: RunId;
      readonly userText: string;
    }) => Effect.Effect<string>;
    readonly supplied: (
      runIds: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyMap<string, SuppliedTurnInstructions>>;
  }
>()("t3/managedDevPc/TurnInstructions") {}

const none: TurnInstructions["Service"] = {
  supply: Fn.constant(Effect.succeed("")),
  supplied: Fn.constant(Effect.succeed(new Map())),
};

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  // Only a managed workspace has the file, and only its database gets the table.
  if (!config.managedDevPc) return none;
  const sql = yield* SqlClient.SqlClient;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(config.stateDir, "turn-instructions.json");
  yield* ensureAldoSchema().pipe(Effect.provideService(SqlClient.SqlClient, sql));

  const supply = Effect.fn("TurnInstructions.supply")(
    function* (input: { readonly runId: RunId; readonly userText: string }) {
      if (isSlashCommand(input.userText)) return "";
      const instructions = parseTurnInstructions(
        yield* fileSystem.readFileString(file),
        input.userText.length,
      );
      if (instructions === null) return "";
      yield* sql`
        INSERT INTO aldo_turn_instructions (run_id, contract, version)
        VALUES (${input.runId}, ${instructions.contract}, ${instructions.version})
        ON CONFLICT (run_id) DO UPDATE SET contract = excluded.contract, version = excluded.version
      `;
      return instructions.text;
    },
    // Unrecorded instructions would be read back as never sent, so a failure sends none.
    Effect.orElseSucceed(() => ""),
  );

  const supplied = Effect.fn("TurnInstructions.supplied")(
    function* (runIds: ReadonlyArray<string>) {
      if (runIds.length === 0) return new Map<string, SuppliedTurnInstructions>();
      const rows = yield* sql<{
        readonly run_id: string;
        readonly contract: string;
        readonly version: number;
      }>`
        SELECT run_id, contract, version FROM aldo_turn_instructions
        WHERE run_id IN ${sql.in(runIds)}
      `;
      return new Map(
        rows.map((row) => [row.run_id, { contract: row.contract, version: row.version }]),
      );
    },
    Effect.orElseSucceed(() => new Map<string, SuppliedTurnInstructions>()),
  );

  return TurnInstructions.of({ supply, supplied });
});

export const layer = Layer.effect(TurnInstructions, make.pipe(Effect.orDie));
