import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { afterEach, vi } from "vite-plus/test";

import { ServerConfig } from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import { cancel, start, testHelpers } from "./AuthConnectorManager.ts";

const ptySpawn = vi.fn(
  (
    _command: string,
    _args: ReadonlyArray<string>,
    _options: { readonly env?: Readonly<NodeJS.ProcessEnv> },
  ) => ({
    write: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(() => ({ dispose: vi.fn() })),
  }),
);

vi.mock("node-pty", () => ({ spawn: ptySpawn }));

afterEach(() => {
  ptySpawn.mockClear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const authManagerTestLayer = (settings: Parameters<typeof ServerSettings.layerTest>[0] = {}) =>
  Layer.mergeAll(
    ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-auth-connector-test-",
    }).pipe(Layer.provideMerge(NodeServices.layer)),
    ServerSettings.layerTest(settings),
  );

const primeWorkInstanceId = ProviderInstanceId.make("prime_work");

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
    }).pipe(Effect.provide(authManagerTestLayer())),
  );

  it.effect("rejects Prime subscription OAuth unless the server gate is enabled", () =>
    Effect.gen(function* () {
      const defaultConfig = yield* ServerConfig;
      const error = yield* start({ connector: "prime-agent", method: "openai-account" }).pipe(
        Effect.provideService(ServerConfig, {
          ...defaultConfig,
          primeAgentSubscriptionOAuthEnabled: false,
        }),
        Effect.flip,
      );

      expect(error).toMatchObject({
        operation: "start",
        detail: "Prime Agent subscription OAuth is not enabled by this server.",
      });
    }).pipe(Effect.provide(authManagerTestLayer())),
  );

  it.effect("allows Prime subscription OAuth when the server capability is enabled", () =>
    Effect.gen(function* () {
      const defaultConfig = yield* ServerConfig;
      const session = yield* start({ connector: "prime-agent", method: "openai-account" }).pipe(
        Effect.provideService(ServerConfig, {
          ...defaultConfig,
          primeAgentSubscriptionOAuthEnabled: true,
        }),
      );

      expect(ptySpawn).toHaveBeenCalledTimes(1);
      expect(ptySpawn.mock.calls[0]?.[0]).toBe("prime-agent");
      expect(ptySpawn.mock.calls[0]?.[2]?.env).toMatchObject({
        TERM_PROGRAM: "vscode",
        TMUX: "",
      });
      yield* cancel(session.id);
    }).pipe(Effect.provide(authManagerTestLayer())),
  );

  it.effect("uses the derived default Prime instance for authentication", () =>
    Effect.gen(function* () {
      const session = yield* start({ connector: "prime-agent", method: "prime-inference" });

      expect(ptySpawn).toHaveBeenCalledTimes(1);
      expect(ptySpawn.mock.calls[0]?.[0]).toBe("prime-agent");
      yield* cancel(session.id);
    }).pipe(Effect.provide(authManagerTestLayer())),
  );

  it.effect("launches the selected Prime instance with its materialized environment", () =>
    Effect.gen(function* () {
      const session = yield* start({
        connector: "prime-agent",
        method: "prime-inference",
        providerInstanceId: primeWorkInstanceId,
      });

      expect(ptySpawn).toHaveBeenCalledTimes(1);
      const [command, args, options] = ptySpawn.mock.calls[0] ?? [];
      expect(command).toBe("/opt/prime-work/bin/prime-agent");
      expect(args).toEqual([
        "--no-session",
        "--no-context-files",
        "--no-skills",
        "--no-extensions",
        "--no-themes",
      ]);
      expect(options?.env).toMatchObject({
        HOME: "/workspace/accounts/prime-work",
        PRIME_AGENT_CODING_AGENT_DIR: "/workspace/accounts/prime-work/agent",
        PRIME_WORK_SECRET: "materialized-sensitive-value",
        NO_OPEN_BROWSER: "1",
        CI: "0",
      });
      yield* cancel(session.id);
    }).pipe(
      Effect.provide(
        authManagerTestLayer({
          providerInstances: {
            [primeWorkInstanceId]: {
              driver: ProviderDriverKind.make("primeAgent"),
              enabled: true,
              environment: [
                { name: "HOME", value: "/workspace/accounts/prime-work", sensitive: false },
                {
                  name: "PRIME_AGENT_CODING_AGENT_DIR",
                  value: "/workspace/accounts/prime-work/agent",
                  sensitive: false,
                },
                {
                  name: "PRIME_WORK_SECRET",
                  value: "materialized-sensitive-value",
                  sensitive: true,
                },
                { name: "NO_OPEN_BROWSER", value: "0", sensitive: false },
                { name: "CI", value: "1", sensitive: false },
              ],
              config: { binaryPath: "/opt/prime-work/bin/prime-agent" },
            },
          },
        }),
      ),
    ),
  );

  it.effect("rejects missing, wrong-driver, and disabled Prime instances before spawning", () =>
    Effect.gen(function* () {
      const missingId = ProviderInstanceId.make("prime_missing");
      const wrongDriverId = ProviderInstanceId.make("prime_wrong_driver");
      const disabledId = ProviderInstanceId.make("prime_disabled");
      const cases: ReadonlyArray<{
        readonly instanceId: ProviderInstanceId;
        readonly settings: Parameters<typeof ServerSettings.layerTest>[0];
        readonly detail: string;
      }> = [
        { instanceId: missingId, settings: {}, detail: "does not exist" },
        {
          instanceId: wrongDriverId,
          settings: {
            providerInstances: {
              [wrongDriverId]: {
                driver: ProviderDriverKind.make("codex"),
                enabled: true,
              },
            },
          },
          detail: "is not a Prime Agent instance",
        },
        {
          instanceId: disabledId,
          settings: {
            providerInstances: {
              [disabledId]: {
                driver: ProviderDriverKind.make("primeAgent"),
                enabled: false,
              },
            },
          },
          detail: "is disabled",
        },
      ];

      for (const testCase of cases) {
        ptySpawn.mockClear();
        const error = yield* start({
          connector: "prime-agent",
          method: "prime-inference",
          providerInstanceId: testCase.instanceId,
        }).pipe(Effect.flip, Effect.provide(authManagerTestLayer(testCase.settings)));

        expect(error).toMatchObject({
          operation: "start",
          detail: expect.stringContaining(testCase.detail),
        });
        expect(ptySpawn).not.toHaveBeenCalled();
      }
    }),
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

  it("accepts Prime's Anthropic authorize host without allowing lookalikes", () => {
    expect(testHelpers.extractUrl("Open https://claude.ai/oauth/authorize?state=opaque")).toBe(
      "https://claude.ai/oauth/authorize?state=opaque",
    );
    expect(
      testHelpers.extractUrl("Open https://claude.ai.evil.example/oauth/authorize?state=opaque"),
    ).toBeNull();
  });

  it("recovers Prime's complete OAuth URL from an OSC-8 hyperlink", () => {
    const url =
      "https://auth.openai.com/oauth/authorize?client_id=app&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=opaque";
    const rawOutput = `\u001B]8;;${url}\u0007https://auth.openai.com/oauth/authorize?client_id=app\n&redirect_uri=wrapped\u001B]8;;\u0007`;

    expect(testHelpers.extractTerminalHyperlinkUrl(rawOutput)).toBe(url);
  });

  it("preserves the complete OAuth URL when opening the managed workspace browser", () => {
    const url =
      "https://claude.ai/oauth/authorize?client_id=app&redirect_uri=http%3A%2F%2Flocalhost%3A53692%2Fcallback&state=opaque";
    const target = testHelpers.managedBrowserTargetUrl(url, "http://127.0.0.1:9222");

    expect(target).not.toBeNull();
    expect(new URL(target!).pathname).toBe("/json/new");
    expect(decodeURIComponent(new URL(target!).search.slice(1))).toBe(url);
  });

  it("refuses non-loopback managed browser endpoints", () => {
    expect(
      testHelpers.managedBrowserTargetUrl(
        "https://claude.ai/oauth/authorize?state=opaque",
        "http://browser.example.com:9222",
      ),
    ).toBeNull();
  });

  it("opens Prime's complete OAuth URL once in the managed workspace browser", () => {
    const url =
      "https://auth.openai.com/oauth/authorize?client_id=app&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=opaque";
    const openTarget = vi.fn((_target: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    vi.stubEnv("BROWSER_CDP_ENDPOINT", "http://127.0.0.1:9222");
    vi.stubGlobal("fetch", openTarget);

    testHelpers.parseOutputForTest({
      connector: "prime-agent",
      method: "openai-account",
      flow: "code",
      output: "Login to ChatGPT Plus/Pro (Codex Subscription)\nPaste redirect URL below",
      rawOutput: `\u001B]8;;${url}\u0007wrapped link\u001B]8;;\u0007`,
      repetitions: 2,
    });

    expect(openTarget).toHaveBeenCalledTimes(1);
    const [target, init] = openTarget.mock.calls[0] ?? [];
    expect(init).toMatchObject({ method: "PUT", redirect: "error" });
    expect(target).toEqual(expect.any(String));
    expect(decodeURIComponent(new URL(String(target)).search.slice(1))).toBe(url);
  });

  it("retries a managed workspace browser handoff after a non-success response", async () => {
    const url = "https://auth.openai.com/oauth/authorize?state=opaque";
    const state = { workspaceBrowserOpenStarted: false };
    const openTarget = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubEnv("BROWSER_CDP_ENDPOINT", "http://127.0.0.1:9222");
    vi.stubGlobal("fetch", openTarget);

    testHelpers.openInManagedWorkspaceBrowser(state, url);
    await vi.waitFor(() => expect(state.workspaceBrowserOpenStarted).toBe(false));

    testHelpers.openInManagedWorkspaceBrowser(state, url);
    await vi.waitFor(() => expect(state.workspaceBrowserOpenStarted).toBe(true));
    expect(openTarget).toHaveBeenCalledTimes(2);
  });

  it("reports when a managed browser handoff is unavailable", () => {
    vi.stubEnv("BROWSER_CDP_ENDPOINT", "");

    expect(
      testHelpers.openInManagedWorkspaceBrowser(
        { workspaceBrowserOpenStarted: false },
        "https://auth.openai.com/oauth/authorize?state=opaque",
      ),
    ).toBe(false);
  });

  it("keeps reporting an already-started managed browser handoff", () => {
    expect(
      testHelpers.openInManagedWorkspaceBrowser(
        { workspaceBrowserOpenStarted: true },
        "https://auth.openai.com/oauth/authorize?state=opaque",
      ),
    ).toBe(true);
  });

  it("redacts a credential even when its PTY echo is split across chunks", () => {
    const secret = "sk-ant-split-secret";
    const first = testHelpers.redactSensitiveOutputChunk("sk-ant-spl", secret, "");
    const second = testHelpers.redactSensitiveOutputChunk(
      "it-secret\nCredential accepted.",
      secret,
      first.carry,
    );
    const captured = `${first.output}${second.output}`;

    expect(captured).toBe("[redacted]\nCredential accepted.");
    expect(second.carry).toBe("");
    expect(captured).not.toContain(secret);
  });

  it("rejects terminal control characters in PTY credentials", () => {
    expect(testHelpers.hasTerminalControlCharacters("sk-safe-value")).toBe(false);
    expect(testHelpers.hasTerminalControlCharacters("sk-first\r/another-command")).toBe(true);
    expect(testHelpers.hasTerminalControlCharacters("callback\nnext-command")).toBe(true);
    expect(testHelpers.hasTerminalControlCharacters("sk-key\u001B[2K/another-command")).toBe(true);
    expect(testHelpers.hasTerminalControlCharacters("sk-key\u0085next-command")).toBe(true);
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

  it("launches Prime's interactive login at a wide terminal and selects stable provider rows", () => {
    const openAiSpec = testHelpers.launchSpec({
      connector: "prime-agent",
      method: "openai-account",
    });
    expect(openAiSpec).toMatchObject({
      command: "prime-agent",
      args: ["--no-session", "--no-context-files", "--no-skills", "--no-extensions", "--no-themes"],
      flow: "code",
      columns: 512,
      primeAgentProviderQuery: "ChatGPT Plus",
      primeAgentExpectedDialogTitle: "Login to ChatGPT Plus/Pro (Codex Subscription)",
      primeAgentExpectedAuthType: "oauth",
    });
    expect(openAiSpec).not.toHaveProperty("initialInput");
    expect(
      testHelpers.launchSpec({ connector: "prime-agent", method: "anthropic-api-key" }),
    ).toMatchObject({
      flow: "secret",
      fields: [{ key: "secret", label: "Anthropic API key", type: "password" }],
      primeAgentProviderQuery: "anthropic api_key",
      primeAgentExpectedAuthType: "api_key",
    });
  });

  it("waits through delayed first-run onboarding before opening Prime's provider menu", () => {
    const mainPrompt = 'Try "add tests for @<filepath>"';
    const delayedOnboarding = [
      "Welcome to PRIME Agent",
      "Press Enter to login with Prime Intellect",
    ].join("\n");
    const delayedResult = testHelpers.parseOutputForTest({
      connector: "prime-agent",
      method: "openai-account",
      flow: "code",
      output: mainPrompt,
      followupOutputs: [{ output: delayedOnboarding }],
    });

    expect(delayedResult.writes).toEqual(["\u001B"]);

    const dismissedResult = testHelpers.parseOutputForTest({
      connector: "prime-agent",
      method: "openai-account",
      flow: "code",
      output: delayedOnboarding,
      followupOutputs: [{ output: mainPrompt }],
      settlePrimeStartup: true,
    });

    expect(dismissedResult.writes).toEqual(["\u001B", "/login\r"]);
  });

  it("distinguishes Prime's duplicate Anthropic rows by authentication type", () => {
    expect(testHelpers.primeAgentProviderQuery("anthropic-account")).toBe("anthropic oauth");
    expect(testHelpers.primeAgentProviderQuery("anthropic-api-key")).toBe("anthropic api_key");
    expect(testHelpers.primeAgentExpectedDialogTitle("anthropic-account")).toBe(
      "Login to Anthropic (Claude Pro/Max)",
    );
    expect(testHelpers.primeAgentExpectedDialogTitle("anthropic-api-key")).toBe(
      "Login to Anthropic (Claude Pro/Max)",
    );
    expect(testHelpers.primeAgentExpectedAuthType("anthropic-account")).toBe("oauth");
    expect(testHelpers.primeAgentExpectedAuthType("anthropic-api-key")).toBe("api_key");
  });

  it("uses Prime's manual callback field for subscription OAuth submissions", () => {
    expect(
      testHelpers.primeAgentInputValue("openai-account", {
        callback: " http://localhost:1455/auth/callback?code=abc ",
        secret: "wrong-field",
      }),
    ).toBe("http://localhost:1455/auth/callback?code=abc");
    expect(testHelpers.primeAgentInputValue("openai-api-key", { secret: "sk-test" })).toBe(
      "sk-test",
    );
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

  it("moves Prime ChatGPT OAuth to a localhost-aware manual return stage", () => {
    const url =
      "https://auth.openai.com/oauth/authorize?client_id=app&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=opaque";
    const result = testHelpers.parseOutputForTest({
      connector: "prime-agent",
      method: "openai-account",
      flow: "code",
      output: "Login to ChatGPT Plus/Pro (Codex Subscription)\nPaste redirect URL below",
      rawOutput: `\u001B]8;;${url}\u0007wrapped link\u001B]8;;\u0007`,
    });

    expect(result.snapshot).toMatchObject({
      status: "waiting",
      stage: "return",
      verificationUrl: url,
      fields: [
        {
          key: "callback",
          type: "textarea",
          help: expect.stringContaining("localhost:1455"),
        },
      ],
      message: expect.stringContaining("paste the complete localhost:1455 redirect URL"),
    });
  });

  it.each([
    ["openai-account", "ChatGPT Plus\r"],
    ["anthropic-account", "anthropic oauth\r"],
    ["anthropic-api-key", "anthropic api_key\r"],
  ] as const)("selects Prime provider %s exactly once", (method, expectedWrite) => {
    const result = testHelpers.parseOutputForTest({
      connector: "prime-agent",
      method,
      flow: method === "anthropic-api-key" ? "secret" : "code",
      output: "Connect with a subscription or API key\nSearch providers",
      repetitions: 2,
    });

    expect(result.writes).toEqual([expectedWrite]);
  });

  it("fails before submitting a credential when fuzzy search opens the wrong Prime provider", () => {
    const pendingSecret = "sk-must-not-be-retained";
    const result = testHelpers.parseOutputForTest({
      connector: "prime-agent",
      method: "openai-api-key",
      flow: "secret",
      output: "Search providers",
      pendingInput: pendingSecret,
      followupOutputs: [
        {
          output: "Login to OpenCode Zen\nEnter API key:\nPaste value",
        },
      ],
    });

    expect(result.writes).toEqual(["OpenAI\r"]);
    expect(result.snapshot).toMatchObject({
      status: "failed",
      message: expect.stringContaining("opened the wrong provider dialog"),
    });
    expect(result.sensitiveState).toEqual({ pendingInput: null, submittedInput: null });
    expect(JSON.stringify(result.snapshot)).not.toContain(pendingSecret);
  });

  it("fails before submitting an Anthropic API key when the duplicate row opens OAuth", () => {
    const pendingSecret = "sk-ant-must-not-be-submitted";
    const result = testHelpers.parseOutputForTest({
      connector: "prime-agent",
      method: "anthropic-api-key",
      flow: "secret",
      output: "Search providers",
      pendingInput: pendingSecret,
      followupOutputs: [
        {
          output:
            "Login to Anthropic (Claude Pro/Max)\nOpen https://claude.ai/oauth/authorize?state=opaque",
        },
      ],
    });

    expect(result.writes).toEqual(["anthropic api_key\r"]);
    expect(result.snapshot).toMatchObject({
      status: "failed",
      verificationUrl: null,
      userCode: null,
      message: expect.stringContaining("subscription flow instead of the requested API-key flow"),
    });
    expect(result.sensitiveState).toEqual({ pendingInput: null, submittedInput: null });
    expect(JSON.stringify(result.snapshot)).not.toContain(pendingSecret);
  });

  it("fails before submitting an Anthropic callback when the duplicate row opens API-key auth", () => {
    const pendingCallback = "http://localhost:1455/auth/callback?code=must-not-be-submitted";
    const result = testHelpers.parseOutputForTest({
      connector: "prime-agent",
      method: "anthropic-account",
      flow: "code",
      output: "Search providers",
      pendingInput: pendingCallback,
      followupOutputs: [
        {
          output: "Login to Anthropic (Claude Pro/Max)\nEnter API key:\nPaste value",
        },
      ],
    });

    expect(result.writes).toEqual(["anthropic oauth\r"]);
    expect(result.snapshot).toMatchObject({
      status: "failed",
      message: expect.stringContaining("API-key flow instead of the requested subscription flow"),
    });
    expect(result.sensitiveState).toEqual({ pendingInput: null, submittedInput: null });
    expect(JSON.stringify(result.snapshot)).not.toContain(pendingCallback);
  });

  it("submits an API key only after Prime confirms the requested auth surface", () => {
    const pendingSecret = "sk-ant-submit-after-confirmation";
    const result = testHelpers.parseOutputForTest({
      connector: "prime-agent",
      method: "anthropic-api-key",
      flow: "secret",
      output: "Search providers",
      pendingInput: pendingSecret,
      followupOutputs: [
        {
          output: "Login to Anthropic (Claude Pro/Max)\nEnter API key:\nPaste value",
        },
        {
          output:
            "Saved API key for Anthropic. Credentials saved to /home/user/.prime/agent/auth.json",
        },
      ],
    });

    expect(result.writes).toEqual(["anthropic api_key\r", `${pendingSecret}\r`]);
    expect(result.snapshot).toMatchObject({ status: "succeeded", stage: "complete" });
    expect(result.sensitiveState).toEqual({ pendingInput: null, submittedInput: null });
    expect(JSON.stringify(result.snapshot)).not.toContain(pendingSecret);
  });

  it("preserves Prime Inference's existing billing team before awaiting success", () => {
    const pendingSecret = "prime-key-for-team-flow";
    const result = testHelpers.parseOutputForTest({
      connector: "prime-agent",
      method: "prime-inference",
      flow: "browser",
      output: "Search providers",
      pendingInput: pendingSecret,
      followupOutputs: [
        {
          output: "Login to Prime Inference\nEnter API key:\nPaste value",
        },
        {
          output: "Prime Team\nChoose which account pays for Prime Inference usage.",
        },
        {
          output:
            "Logged in to Prime Inference. Credentials saved to /home/user/.prime/agent/auth.json",
        },
      ],
    });

    expect(result.writes).toEqual(["Prime Inference\r", `${pendingSecret}\r`, "\u001B"]);
    expect(result.snapshot).toMatchObject({ status: "succeeded", stage: "complete" });
    expect(result.sensitiveState).toEqual({ pendingInput: null, submittedInput: null });
  });

  it("does not accept a Prime success message before the requested auth surface", () => {
    const result = testHelpers.parseOutputForTest({
      connector: "prime-agent",
      method: "openai-api-key",
      flow: "secret",
      output: "Saved API key for OpenAI. Credentials saved to /tmp/forged-auth.json",
    });

    expect(result.snapshot.status).toBe("starting");
  });

  it("clears OAuth URLs and state when a Prime flow reaches a terminal status", () => {
    const result = testHelpers.parseOutputForTest({
      connector: "prime-agent",
      method: "anthropic-account",
      flow: "code",
      output: "Search providers",
      followupOutputs: [
        {
          output:
            "Login to Anthropic (Claude Pro/Max)\nOpen https://claude.ai/oauth/authorize?state=sensitive-state",
        },
        { output: "authorization failed" },
      ],
    });

    expect(result.snapshot).toMatchObject({
      status: "failed",
      verificationUrl: null,
      userCode: null,
    });
    expect(JSON.stringify(result.snapshot)).not.toContain("sensitive-state");
  });

  it("fails visibly when Prime does not expose the requested provider row", () => {
    const result = testHelpers.parseOutputForTest({
      connector: "prime-agent",
      method: "openai-account",
      flow: "code",
      output: "Search providers",
      followupOutputs: [{ output: "No matching providers" }],
    });

    expect(result.snapshot).toMatchObject({
      status: "failed",
      stage: "error",
      message: expect.stringContaining("did not expose"),
    });
  });

  it("only succeeds after Prime confirms that it saved or detected credentials", () => {
    expect(
      testHelpers.parseOutputForTest({
        connector: "prime-agent",
        method: "anthropic-account",
        flow: "code",
        output: "Search providers",
        followupOutputs: [
          {
            output:
              "Login to Anthropic (Claude Pro/Max)\nOpen https://claude.ai/oauth/authorize?state=opaque",
          },
          {
            output:
              "Logged in to Anthropic. Credentials saved to /home/user/.prime/agent/auth.json",
          },
        ],
      }).snapshot,
    ).toMatchObject({ status: "succeeded", stage: "complete" });

    expect(
      testHelpers.parseOutputForTest({
        connector: "prime-agent",
        method: "amazon-bedrock",
        flow: "browser",
        output:
          "Amazon Bedrock setup\nAmazon Bedrock uses external credentials. Select a model to continue.",
      }).snapshot,
    ).toMatchObject({ status: "succeeded", stage: "complete" });

    expect(
      testHelpers.parseOutputForTest({
        connector: "prime-agent",
        method: "openai-api-key",
        flow: "secret",
        output: "Prime Agent exited without a confirmation",
        exitCode: 0,
      }).snapshot,
    ).toMatchObject({
      status: "failed",
      stage: "error",
      message: expect.stringContaining("closed before it confirmed"),
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
