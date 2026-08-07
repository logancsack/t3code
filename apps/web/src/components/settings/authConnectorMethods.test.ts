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

  it("surfaces managed subscription OAuth only behind the server capability", () => {
    const configured = resolveAgentAuthMethods("primeAgent", true);
    const chatGpt = configured?.methods.find((method) => method.method === "openai-account");
    const claude = configured?.methods.find((method) => method.method === "anthropic-account");

    expect(chatGpt).toMatchObject({
      badgeLabel: "Subscription",
      workspaceBrowser: true,
      authorizeInstruction: expect.stringContaining("workspace browser"),
      manualAuthorizeInstruction: expect.stringContaining("this browser"),
      returnInstruction: expect.stringContaining("redirect URL"),
    });
    expect(chatGpt?.description).toContain("does not copy your Codex credentials");
    expect(claude).toMatchObject({
      badgeLabel: "Subscription",
      workspaceBrowser: true,
      manualAuthorizeInstruction: expect.stringContaining("authorization code"),
    });
    expect(claude?.description).toContain("does not copy your Claude Code credentials");
  });
});
