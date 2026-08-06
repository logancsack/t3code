import { describe, expect, it } from "vite-plus/test";

import { AGENT_AUTH_METHODS } from "./authConnectorMethods";

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
