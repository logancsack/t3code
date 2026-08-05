import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config.ts";
import { start, testHelpers } from "./AuthConnectorManager.ts";

describe("AuthConnectorManager output parsing", () => {
  it.effect("rejects Muse authentication before spawning a process when Muse is withheld", () =>
    Effect.gen(function* () {
      const defaultConfig = yield* ServerConfig;
      const error = yield* start({ connector: "muse", method: "account" }).pipe(
        Effect.provideService(ServerConfig, {
          ...defaultConfig,
          museCodeEnabled: false,
        }),
        Effect.flip,
      );

      expect(error).toMatchObject({
        operation: "start",
        detail: "Muse Code is not available in this T3 Code environment.",
      });
    }).pipe(
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3-auth-connector-gate-test-",
        }).pipe(Layer.provideMerge(NodeServices.layer)),
      ),
    ),
  );

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

  it("extracts Muse's Meta device authorization details", () => {
    const output = [
      "Open this page to sign in:",
      "  https://auth.meta.com/oauth/device/?code=ZKWQ-XCBZ",
      "confirm this code matches:",
      "  ZKWQ-XCBZ",
      "Waiting for approval…",
    ].join("\n");

    expect(testHelpers.extractUserCode(output)).toBe("ZKWQ-XCBZ");
    expect(testHelpers.extractUrl(output)).toBe(
      "https://auth.meta.com/oauth/device/?code=ZKWQ-XCBZ",
    );
    expect(
      testHelpers.parseOutputForTest({
        connector: "muse",
        method: "account",
        flow: "device",
        output,
      }).snapshot,
    ).toMatchObject({
      status: "waiting",
      stage: "authorize",
      verificationUrl: "https://auth.meta.com/oauth/device/?code=ZKWQ-XCBZ",
      userCode: "ZKWQ-XCBZ",
    });
  });

  it("keeps Claude authorization query parameters intact", () => {
    const output =
      "If the browser did not open, visit: https://claude.com/cai/oauth/authorize?code=true&state=opaque";

    expect(testHelpers.extractUrl(output)).toBe(
      "https://claude.com/cai/oauth/authorize?code=true&state=opaque",
    );
  });

  it("rejects lookalike authentication hosts", () => {
    expect(
      testHelpers.extractUrl("Open https://auth.meta.com.evil.example/oauth/device to continue"),
    ).toBeNull();
    expect(testHelpers.extractUrl("Open http://auth.meta.com/oauth/device to continue")).toBeNull();
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

  it("recognizes GitHub's browser continuation prompt", () => {
    expect(
      testHelpers.hasGitHubBrowserPrompt(
        "Press Enter to open https://github.com/login/device in your browser...",
      ),
    ).toBe(true);
    expect(testHelpers.hasGitHubBrowserPrompt("Waiting for GitHub to approve access.")).toBe(false);
  });

  it("prevents GitHub CLI from opening a browser inside the workspace", () => {
    const spec = testHelpers.launchSpec({
      connector: "github",
      method: "account",
    });

    expect(spec?.env).toEqual({ GH_BROWSER: "true" });
  });

  it("runs GitLab device login without its interactive terminal UI", () => {
    const spec = testHelpers.launchSpec({
      connector: "gitlab",
      method: "account",
    });

    expect(spec?.env).toEqual({ TERM: "dumb" });
    expect(spec?.ptyName).toBe("dumb");
  });

  it("starts Muse account login with its device flow", () => {
    expect(
      testHelpers.launchSpec({
        connector: "muse",
        method: "account",
      }),
    ).toMatchObject({
      command: "muse",
      args: ["login"],
      flow: "device",
    });
  });

  it("starts Muse API-key login through stdin", () => {
    expect(
      testHelpers.launchSpec({
        connector: "muse",
        method: "api-key",
      }),
    ).toMatchObject({
      command: "muse",
      args: ["auth", "set", "--provider", "meta", "--api-key-stdin"],
      flow: "secret",
      fields: [{ key: "secret", type: "password" }],
    });
    expect(testHelpers.secretInputTerminator({ connector: "muse", method: "api-key" })).toBe(
      "\r\u0004",
    );
    expect(testHelpers.secretInputTerminator({ connector: "codex", method: "api-key" })).toBe("\r");
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

  it("supplies GitHub's device page when the CLI only prints a one-time code", () => {
    const result = testHelpers.parseOutputForTest({
      connector: "github",
      method: "account",
      flow: "device",
      output: "! First copy your one-time code: B458-9653",
    });

    expect(result.snapshot).toMatchObject({
      status: "waiting",
      stage: "authorize",
      verificationUrl: "https://github.com/login/device",
      userCode: "B458-9653",
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

  it("advances GitHub into device-code polling exactly once", () => {
    const result = testHelpers.parseOutputForTest({
      connector: "github",
      method: "account",
      flow: "device",
      output: [
        "! First copy your one-time code: EC66-D3F9",
        "Press Enter to open https://github.com/login/device in your browser...",
      ].join("\n"),
      repetitions: 2,
    });

    expect(result.snapshot).toMatchObject({
      status: "waiting",
      stage: "authorize",
      verificationUrl: "https://github.com/login/device",
      userCode: "EC66-D3F9",
    });
    expect(result.writes).toEqual(["\r"]);
  });
});
