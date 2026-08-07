import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  authAuthorizeInstruction,
  authVerificationDestination,
  buildAuthConnectorStartInput,
} from "./AuthConnectorDialog";

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

describe("AuthConnectorDialog verification destination", () => {
  const providerUrl =
    "https://auth.openai.com/oauth/authorize?client_id=app&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback";

  it("opens managed Prime OAuth in the shared workspace browser", () => {
    expect(
      authVerificationDestination({
        verificationUrl: providerUrl,
        workspaceBrowser: true,
        workspaceBrowserUrl: "/_devpc/browser?grant=workspace",
      }),
    ).toBe("/_devpc/browser?grant=workspace");
  });

  it("keeps the complete provider URL as the unmanaged fallback", () => {
    expect(
      authVerificationDestination({
        verificationUrl: providerUrl,
        workspaceBrowser: true,
        workspaceBrowserUrl: null,
      }),
    ).toBe(providerUrl);
  });
});

describe("AuthConnectorDialog authorization instruction", () => {
  const option = {
    method: "openai-account" as const,
    label: "ChatGPT subscription OAuth",
    description: "Use a ChatGPT subscription.",
    workspaceBrowser: true,
    authorizeInstruction: "Continue in the workspace browser.",
    manualAuthorizeInstruction: "Continue in this browser and paste the redirect URL.",
  };

  it("uses managed workspace guidance when the viewer is available", () => {
    expect(authAuthorizeInstruction({ option, usesManagedWorkspaceBrowser: true })).toContain(
      "workspace browser",
    );
  });

  it("uses manual callback guidance on standalone servers", () => {
    expect(authAuthorizeInstruction({ option, usesManagedWorkspaceBrowser: false })).toContain(
      "paste the redirect URL",
    );
  });
});
