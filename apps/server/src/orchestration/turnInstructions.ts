import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@t3tools/contracts";
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

export function parseTurnInstructions(value: string, baseLength = 0) {
  if (value.length > 16_000) return null;
  const instructions = Option.getOrNull(decode(value));
  return instructions &&
    baseLength + 2 + instructions.text.length <= PROVIDER_SEND_TURN_MAX_INPUT_CHARS
    ? instructions
    : null;
}
