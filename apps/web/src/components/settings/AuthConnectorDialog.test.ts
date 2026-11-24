import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildAuthConnectorStartInput } from "./AuthConnectorDialog";

describe("AuthConnectorDialog start input", () => {
  it("routes an agent connection to the provider card's instance", () => {
    expect(
      buildAuthConnectorStartInput({
        connector: "prime-agent",
        option: {
          method: "openai-api-key",
          label: "OpenAI API key",
          description: "Use API billing.",
        },
        providerInstanceId: ProviderInstanceId.make("primeAgent_work"),
      }),
    ).toEqual({
      connector: "prime-agent",
      method: "openai-api-key",
      providerInstanceId: "primeAgent_work",
    });
  });

  it("keeps provider instance routing optional for source-control connections", () => {
    expect(
      buildAuthConnectorStartInput({
        connector: "github",
        option: {
          method: "account",
          label: "GitHub",
          description: "Use browser sign-in.",
          hostname: "github.example.com",
        },
      }),
    ).toEqual({
      connector: "github",
      method: "account",
      hostname: "github.example.com",
    });
  });
});
