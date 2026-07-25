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
      "1. Open this URL in your browser\n" +
        "   \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m\n\n" +
        "2. Enter this one-time code (expires in 15 minutes)\n" +
        "   \u001b[94mWXYZ-9876\u001b[0m",
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

  it("recognizes the GitHub CLI credential confirmation before device login", () => {
    expect(
      testHelpers.hasGitHubCredentialPrompt(
        "? Authenticate Git with your GitHub credentials? (Y/n)",
      ),
    ).toBe(true);
    expect(testHelpers.hasGitHubCredentialPrompt("Authenticate with a browser?")).toBe(false);
  });

  it("runs GitLab device login without its interactive terminal UI", () => {
    const spec = testHelpers.launchSpec({
      connector: "gitlab",
      method: "account",
    });

    expect(spec?.env).toEqual({ TERM: "dumb" });
    expect(spec?.ptyName).toBe("dumb");
  });

  it("accepts Claude's full callback URL or short authorization code", () => {
    expect(testHelpers.claudeCallbackField()).toMatchObject({
      key: "callback",
      label: "Authorization URL or code",
      type: "textarea",
    });
  });

  it("moves a device flow to authorize with the parsed URL and code", () => {
    const result = testHelpers.parseOutputForTest({
      connector: "codex",
      method: "account",
      flow: "device",
      output: [
        "1. Open this URL in your browser",
        "   https://auth.openai.com/codex/device",
        "2. Enter this one-time code (expires in 15 minutes)",
        "   WXYZ-9876",
      ].join("\n"),
    });

    expect(result.snapshot).toMatchObject({
      status: "waiting",
      stage: "authorize",
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "WXYZ-9876",
    });
  });

  it("moves Claude to the return stage with its callback field", () => {
    const result = testHelpers.parseOutputForTest({
      connector: "claude",
      method: "account",
      flow: "code",
      output:
        "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?state=opaque",
    });

    expect(result.snapshot).toMatchObject({
      status: "waiting",
      stage: "return",
      verificationUrl: "https://claude.com/cai/oauth/authorize?state=opaque",
      fields: [
        {
          key: "callback",
          type: "textarea",
        },
      ],
    });
  });

  it("answers the GitHub credential prompt exactly once", () => {
    const result = testHelpers.parseOutputForTest({
      connector: "github",
      method: "account",
      flow: "device",
      output: "? Authenticate Git with your GitHub credentials? (Y/n)",
      repetitions: 2,
    });

    expect(result.writes).toEqual(["y\r"]);
  });
});
