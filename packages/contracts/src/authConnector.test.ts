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

  it.each([
    "prime-inference",
    "openai-api-key",
    "anthropic-api-key",
    "azure-openai",
    "amazon-bedrock",
    "google-vertex",
    "openai-account",
    "anthropic-account",
  ] as const)("accepts Prime Agent %s authentication", (method) => {
    expect(decodeStartInput({ connector: "prime-agent", method })).toEqual({
      connector: "prime-agent",
      method,
    });
  });

  it("routes provider authentication to an optional provider instance", () => {
    expect(
      decodeStartInput({
        connector: "prime-agent",
        method: "openai-api-key",
        providerInstanceId: "primeAgent_work",
      }),
    ).toEqual({
      connector: "prime-agent",
      method: "openai-api-key",
      providerInstanceId: "primeAgent_work",
    });
  });

  it("rejects invalid provider instance identifiers", () => {
    expect(() =>
      decodeStartInput({
        connector: "prime-agent",
        method: "openai-api-key",
        providerInstanceId: "Prime Agent work",
      }),
    ).toThrow();
  });
});
