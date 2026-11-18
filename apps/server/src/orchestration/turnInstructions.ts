import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// Optional operator-supplied context, read afresh for each turn. Keeping it
// outside a provider session lets a running conversation adopt a new format
// without restarting the agent or claiming it has read a replaced file.
const TurnInstructions = Schema.fromJsonString(
  Schema.Struct({
    contract: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,79}$/)),
    version: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 999 })),
    text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(12_000)),
  }),
);

const decode = Schema.decodeOption(TurnInstructions);

export function parseTurnInstructions(value: string) {
  if (value.length > 16_000) return null;
  return Option.getOrNull(decode(value));
}
