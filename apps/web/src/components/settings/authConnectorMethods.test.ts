import { describe, expect, it } from "vite-plus/test";

import { AGENT_AUTH_METHODS, resolveAgentAuthMethods } from "./authConnectorMethods";

describe("Muse authentication methods", () => {
  it("offers Meta account and API-key connections", () => {
    expect(AGENT_AUTH_METHODS.muse).toMatchObject({
      connector: "muse",
      serviceName: "Muse Code",
      methods: [
        { method: "account" },
        {
          method: "api-key",
          externalHelpUrl: "https://dev.meta.ai/",
          externalHelpLabel: "Create a Meta API key",
        },
      ],
    });
  });
});

describe("Prime Agent authentication methods", () => {
  it("keeps API-key and cloud credential routes available while subscription OAuth is gated off", () => {
    const configured = resolveAgentAuthMethods("primeAgent", false);

    expect(configured).toMatchObject({
      connector: "prime-agent",
      serviceName: "Prime Agent",
    });
    expect(configured?.methods.map((method) => method.method)).toEqual([
      "prime-inference",
      "openai-api-key",
      "anthropic-api-key",
      "azure-openai",
      "google-vertex",
      "amazon-bedrock",
    ]);
    expect(configured?.methods).not.toContainEqual(
      expect.objectContaining({ method: "openai-account" }),
    );
    expect(configured?.methods).not.toContainEqual(
      expect.objectContaining({ method: "anthropic-account" }),
    );
    const azure = configured?.methods.find((method) => method.method === "azure-openai");
    expect(azure?.description).toContain("AZURE_OPENAI_BASE_URL");
    expect(azure?.description).toContain("AZURE_OPENAI_RESOURCE_NAME");
  });

  it("surfaces provider-approved subscription OAuth only behind the server capability", () => {
    const configured = resolveAgentAuthMethods("primeAgent", true);
    const chatGpt = configured?.methods.find((method) => method.method === "openai-account");
    const claude = configured?.methods.find((method) => method.method === "anthropic-account");

    expect(chatGpt).toMatchObject({
      badgeLabel: "Experimental · provider approval required",
      authorizeInstruction: expect.stringContaining("localhost:1455"),
      returnInstruction: expect.stringContaining("redirect URL"),
    });
    expect(chatGpt?.description).toContain("does not copy or reuse Codex credentials");
    expect(claude).toMatchObject({
      badgeLabel: "Experimental · provider approval required",
      externalHelpUrl: "https://claude.ai/settings/usage",
    });
    expect(claude?.description).toContain("draws from Anthropic extra usage");
    expect(claude?.description).toContain("billed per token, not Claude plan limits");
    expect(claude?.description).toContain("does not copy or reuse Claude credentials");
  });
});
