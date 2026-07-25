import { describe, expect, it } from "@effect/vitest";

import { testHelpers } from "./AuthConnectorManager.ts";

describe("AuthConnectorManager output parsing", () => {
  it("extracts GitHub device authorization details", () => {
    const output = [
      "! First copy your one-time code: ABCD-1234",
      "Open this URL to continue in your web browser: https://github.com/login/device",
    ].join("\n");

    expect(testHelpers.extractUserCode(output)).toBe("ABCD-1234");
    expect(testHelpers.extractUrl(output)).toBe("https://github.com/login/device");
  });

  it("extracts Codex device authorization details after removing terminal styling", () => {
    const output = testHelpers.stripAnsi(
      "\u001b[94mhttps://auth.openai.com/codex/device\u001b[0m\n" +
        "Enter this one-time code:\n\u001b[94mWXYZ-9876\u001b[0m",
    );

    expect(testHelpers.extractUserCode(output)).toBe("WXYZ-9876");
    expect(testHelpers.extractUrl(output)).toBe("https://auth.openai.com/codex/device");
  });

  it("extracts Grok codes from complete verification URLs", () => {
    const output =
      "Open https://accounts.x.ai/oauth2/device?user_code=GROK-4567 and confirm this code";

    expect(testHelpers.extractUserCode(output)).toBe("GROK-4567");
    expect(testHelpers.extractUrl(output)).toBe(
      "https://accounts.x.ai/oauth2/device?user_code=GROK-4567",
    );
  });

  it("keeps Claude authorization query parameters intact", () => {
    const output =
      "If the browser did not open, visit: https://claude.com/cai/oauth/authorize?code=true&state=opaque";

    expect(testHelpers.extractUrl(output)).toBe(
      "https://claude.com/cai/oauth/authorize?code=true&state=opaque",
    );
  });

  it("extracts Microsoft device authorization details for Azure DevOps", () => {
    const output =
      "To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code A1B2C3D4 to authenticate.";

    expect(testHelpers.extractUserCode(output)).toBe("A1B2C3D4");
    expect(testHelpers.extractUrl(output)).toBe("https://microsoft.com/devicelogin");
  });
});
