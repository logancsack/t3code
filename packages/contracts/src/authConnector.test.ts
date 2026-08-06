import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { AuthConnectorStartInput } from "./authConnector.ts";

const decodeStartInput = Schema.decodeUnknownSync(AuthConnectorStartInput);

describe("AuthConnectorStartInput", () => {
  it.each(["account", "api-key"] as const)("accepts Muse %s authentication", (method) => {
    expect(decodeStartInput({ connector: "muse", method })).toEqual({
      connector: "muse",
      method,
    });
  });
});
