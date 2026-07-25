// @effect-diagnostics nodeBuiltinImport:off - Native auth is a Node PTY/process and atomic filesystem boundary.
// @effect-diagnostics globalFetch:off - Bitbucket credential verification is intentionally performed at this boundary.
// @effect-diagnostics globalDateInEffect:off - Session expiration timestamps belong to the in-memory PTY lifecycle.
// @effect-diagnostics globalTimersInEffect:off - A detached auth session must outlive an individual RPC Effect scope.
// @effect-diagnostics globalTimers:off - Terminal snapshots are retained briefly after detached PTY completion.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";

import {
  AuthConnectorError,
  type AuthConnectorField,
  type AuthConnectorMethod,
  type AuthConnectorSession,
  type AuthConnectorStartInput,
  type AuthConnectorSubmitInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { writeStoredBitbucketCredentials } from "../sourceControl/BitbucketCredentialStore.ts";

const SESSION_TTL_MS = 15 * 60 * 1_000;
const TERMINAL_SESSION_RETENTION_MS = 5 * 60 * 1_000;
const MAX_OUTPUT_CHARS = 48_000;
const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

type PtyProcess = {
  readonly write: (data: string) => void;
  readonly kill: (signal?: string) => void;
  readonly onData: (listener: (data: string) => void) => { dispose(): void };
  readonly onExit: (
    listener: (event: { exitCode: number; signal?: number | undefined }) => void,
  ) => { dispose(): void };
};

type ManagedSession = {
  snapshot: AuthConnectorSession;
  process: PtyProcess | null;
  output: string;
  acceptOutput: boolean;
  selectedOpenCodeDeployment: boolean;
  answeredGitHubCredentialPrompt: boolean;
};

const sessions = new Map<string, ManagedSession>();
const isAuthConnectorError = Schema.is(AuthConnectorError);

function field(
  key: string,
  label: string,
  type: AuthConnectorField["type"],
  input?: Pick<AuthConnectorField, "placeholder" | "help">,
): AuthConnectorField {
  return {
    key,
    label,
    type,
    ...(input?.placeholder ? { placeholder: input.placeholder } : {}),
    ...(input?.help ? { help: input.help } : {}),
  };
}

function publicSnapshot(session: ManagedSession): AuthConnectorSession {
  return {
    ...session.snapshot,
    fields: [...session.snapshot.fields],
  };
}

function connectorError(operation: string, detail: string): AuthConnectorError {
  return new AuthConnectorError({ operation, detail });
}

function getManagedSession(id: string): Effect.Effect<ManagedSession, AuthConnectorError> {
  const session = sessions.get(id);
  return session
    ? Effect.succeed(session)
    : Effect.fail(connectorError("get", "This connection attempt no longer exists. Start again."));
}

function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, "").replace(/\r/g, "");
}

function extractUrl(output: string): string | null {
  const matches = output.match(/https?:\/\/[^\s<>"']+/giu) ?? [];
  const candidate = matches.findLast((url) =>
    /(?:github\.com|gitlab\.com|openai\.com|claude\.com|cursor\.com|x\.ai|microsoft\.com|microsoftonline\.com|aka\.ms)/iu.test(
      url,
    ),
  );
  return candidate?.replace(/[),.;]+$/u, "") ?? null;
}

function extractUserCode(output: string): string | null {
  const patterns = [
    /enter this one-time code(?:\s*\([^)]*\))?\s*\n\s*([A-Z0-9-]{6,})/iu,
    /one-time code:\s*([A-Z0-9-]{6,})/iu,
    /enter code:\s*([A-Z0-9-]{6,})/iu,
    /enter the code\s+([A-Z0-9-]{6,})/iu,
    /confirm this code(?: in your browser)?:\s*([A-Z0-9-]{6,})/iu,
    /user_code=([A-Z0-9-]{6,})/iu,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(output);
    if (match?.[1]) return match[1];
  }
  return null;
}

function hasGitHubCredentialPrompt(output: string): boolean {
  return /authenticate git with your github credentials\?/iu.test(output);
}

function claudeCallbackField(): AuthConnectorField {
  return field("callback", "Authorization URL or code", "textarea", {
    placeholder: "Paste the full URL from your browser, or the authorization code",
    help: "After approving access, copy the entire URL from the browser address bar. If Anthropic shows a short code instead, you can paste that.",
  });
}

function setSnapshot(
  session: ManagedSession,
  patch: Partial<Omit<AuthConnectorSession, "id" | "connector" | "method">>,
): void {
  session.snapshot = { ...session.snapshot, ...patch };
}

function clearSensitiveOutput(session: ManagedSession): void {
  session.output = "";
  session.acceptOutput = false;
}

function scheduleSessionRemoval(session: ManagedSession): void {
  const cleanup = setTimeout(() => {
    sessions.delete(session.snapshot.id);
  }, TERMINAL_SESSION_RETENTION_MS);
  cleanup.unref();
}

function parseProcessOutput(session: ManagedSession): void {
  const output = session.output;
  const userCode = extractUserCode(output);
  const verificationUrl =
    extractUrl(output) ??
    (session.snapshot.connector === "github" && userCode
      ? "https://github.com/login/device"
      : null);

  if (
    session.snapshot.connector === "github" &&
    !session.answeredGitHubCredentialPrompt &&
    hasGitHubCredentialPrompt(output)
  ) {
    session.answeredGitHubCredentialPrompt = true;
    session.process?.write("y\r");
  }

  if (
    session.snapshot.connector === "opencode" &&
    session.snapshot.method === "github-copilot" &&
    !session.selectedOpenCodeDeployment &&
    output.includes("Select GitHub deployment type")
  ) {
    session.selectedOpenCodeDeployment = true;
    session.process?.write("\r");
  }

  if (session.snapshot.connector === "claude" && verificationUrl) {
    setSnapshot(session, {
      status: "waiting",
      flow: "code",
      stage: "return",
      verificationUrl,
      fields: [claudeCallbackField()],
      message:
        "Approve access with Anthropic, then return here with the full browser URL or authorization code.",
    });
    return;
  }

  if (verificationUrl || userCode) {
    setSnapshot(session, {
      status: "waiting",
      stage: "authorize",
      verificationUrl: verificationUrl ?? session.snapshot.verificationUrl,
      userCode: userCode ?? session.snapshot.userCode,
      message: userCode
        ? "Open the authorization page and confirm the code. This screen updates automatically."
        : "Finish signing in in your browser. This screen updates automatically.",
    });
  }
}

function completeSession(session: ManagedSession, exitCode: number): void {
  if (
    session.snapshot.status === "cancelled" ||
    session.snapshot.status === "expired" ||
    session.snapshot.status === "succeeded"
  ) {
    return;
  }
  session.process = null;
  clearSensitiveOutput(session);
  if (exitCode === 0) {
    setSnapshot(session, {
      status: "succeeded",
      stage: "complete",
      fields: [],
      message: "Account connected.",
    });
    if (session.snapshot.connector === "github") {
      const child = NodeChildProcess.spawn("gh", ["auth", "setup-git"], {
        cwd: process.cwd(),
        env: process.env,
        stdio: "ignore",
      });
      child.unref();
    }
    scheduleSessionRemoval(session);
    return;
  }
  setSnapshot(session, {
    status: "failed",
    stage: "error",
    fields: [],
    message: "The connection did not complete. Try again or choose another sign-in method.",
  });
  scheduleSessionRemoval(session);
}

function secretFields(input: AuthConnectorStartInput): ReadonlyArray<AuthConnectorField> {
  if (input.connector === "bitbucket") {
    return [
      field("email", "Atlassian account email", "email", {
        placeholder: "you@company.com",
      }),
      field("token", "Bitbucket API token", "password", {
        placeholder: "Paste API token",
        help: "Use a token with repository read/write and pull request scopes.",
      }),
    ];
  }
  return [
    field("secret", input.method === "token" ? "Personal access token" : "API key", "password", {
      placeholder: input.method === "token" ? "Paste access token" : "Paste API key",
    }),
  ];
}

type LaunchSpec = {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly flow: AuthConnectorSession["flow"];
  readonly message: string;
  readonly fields?: ReadonlyArray<AuthConnectorField>;
  readonly env?: Readonly<Record<string, string>>;
  readonly ptyName?: string;
};

function launchSpec(input: AuthConnectorStartInput): LaunchSpec | null {
  const hostname = input.hostname?.trim() || undefined;
  switch (input.connector) {
    case "codex":
      if (input.method !== "account" && input.method !== "api-key") return null;
      return input.method === "api-key"
        ? {
            command: "codex",
            args: ["login", "--with-api-key"],
            flow: "secret",
            message: "Enter an OpenAI API key.",
            fields: secretFields(input),
          }
        : {
            command: "codex",
            args: ["login", "--device-auth"],
            flow: "device",
            message: "Starting secure ChatGPT sign-in…",
          };
    case "claude":
      if (input.method !== "account" && input.method !== "console") return null;
      return {
        command: "claude",
        args: ["auth", "login", input.method === "console" ? "--console" : "--claudeai"],
        flow: "code",
        message: "Starting Anthropic sign-in…",
      };
    case "cursor":
      if (input.method !== "account") return null;
      return {
        command: "cursor-agent",
        args: ["login"],
        flow: "browser",
        message: "Starting Cursor sign-in…",
      };
    case "grok":
      if (input.method !== "account") return null;
      return {
        command: "grok",
        args: ["login", "--device-auth"],
        flow: "device",
        message: "Starting xAI sign-in…",
      };
    case "github":
      if (input.method !== "account" && input.method !== "token") return null;
      return input.method === "token"
        ? {
            command: "gh",
            args: [
              "auth",
              "login",
              "--with-token",
              "--hostname",
              hostname ?? "github.com",
              "--git-protocol",
              "https",
              "--insecure-storage",
            ],
            flow: "secret",
            message: "Enter a GitHub personal access token.",
            fields: secretFields(input),
          }
        : {
            command: "gh",
            args: [
              "auth",
              "login",
              "--web",
              "--hostname",
              hostname ?? "github.com",
              "--git-protocol",
              "https",
              "--insecure-storage",
            ],
            flow: "device",
            message: "Starting GitHub sign-in…",
          };
    case "gitlab":
      if (input.method !== "account" && input.method !== "token") return null;
      return input.method === "token"
        ? {
            command: "glab",
            args: [
              "auth",
              "login",
              "--stdin",
              "--hostname",
              hostname ?? "gitlab.com",
              "--git-protocol",
              "https",
            ],
            flow: "secret",
            message: "Enter a GitLab personal access token.",
            fields: secretFields(input),
          }
        : {
            command: "glab",
            args: [
              "auth",
              "login",
              "--device",
              "--hostname",
              hostname ?? "gitlab.com",
              "--git-protocol",
              "https",
            ],
            flow: "device",
            message: "Starting GitLab sign-in…",
            env: { TERM: "dumb" },
            ptyName: "dumb",
          };
    case "azure-devops":
      if (input.method !== "account") return null;
      return {
        command: "az",
        args: ["login", "--use-device-code", "--allow-no-subscriptions"],
        flow: "device",
        message: "Starting Microsoft sign-in for Azure DevOps…",
      };
    case "opencode": {
      const methodMap: Partial<Record<AuthConnectorMethod, { provider: string; method?: string }>> =
        {
          "openai-account": {
            provider: "openai",
            method: "ChatGPT Pro/Plus (headless)",
          },
          "github-copilot": {
            provider: "github-copilot",
            method: "Login with GitHub Copilot",
          },
          "xai-account": {
            provider: "xai",
            method: "xAI Grok OAuth (Headless / Remote / VPS)",
          },
          "api-key": { provider: "openai", method: "Manually enter API Key" },
          "anthropic-api-key": { provider: "anthropic" },
          "opencode-api-key": { provider: "opencode" },
          "openrouter-api-key": { provider: "openrouter" },
        };
      const selected = methodMap[input.method];
      if (!selected) return null;
      const oauth =
        input.method === "openai-account" ||
        input.method === "github-copilot" ||
        input.method === "xai-account";
      return {
        command: "opencode",
        args: [
          "auth",
          "login",
          "--provider",
          selected.provider,
          ...(selected.method ? ["--method", selected.method] : []),
        ],
        flow: oauth ? "device" : "secret",
        message: oauth ? "Starting provider sign-in…" : "Enter the provider API key.",
        ...(oauth ? {} : { fields: secretFields(input) }),
      };
    }
    case "bitbucket":
      return null;
  }
}

async function spawnPty(session: ManagedSession, spec: LaunchSpec): Promise<void> {
  const pty = await import("node-pty");
  const child = pty.spawn(spec.command, [...spec.args], {
    name: spec.ptyName ?? "xterm-256color",
    cols: 100,
    rows: 32,
    cwd: process.cwd(),
    env: {
      ...process.env,
      NO_OPEN_BROWSER: "1",
      CI: "0",
      ...spec.env,
    },
  }) as PtyProcess;
  session.process = child;
  child.onData((chunk) => {
    if (!session.acceptOutput) return;
    session.output = `${session.output}${stripAnsi(chunk)}`.slice(-MAX_OUTPUT_CHARS);
    parseProcessOutput(session);
  });
  child.onExit(({ exitCode }) => completeSession(session, exitCode));
}

async function persistBitbucketGitCredential(email: string, apiToken: string): Promise<void> {
  const directory = NodePath.join(NodeOS.homedir(), ".config", "t3code");
  const credentialsPath = NodePath.join(directory, "git-credentials");
  const credential = `https://${encodeURIComponent(email)}:${encodeURIComponent(apiToken)}@bitbucket.org`;
  await NodeFS.promises.mkdir(directory, { recursive: true, mode: 0o700 });
  let existing = "";
  try {
    existing = await NodeFS.promises.readFile(credentialsPath, "utf8");
  } catch {
    // A first connection has no credentials file yet.
  }
  const lines = existing
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0 && !line.includes("@bitbucket.org"));
  lines.push(credential);
  await NodeFS.promises.writeFile(credentialsPath, `${lines.join("\n")}\n`, { mode: 0o600 });
  await new Promise<void>((resolve, reject) => {
    const child = NodeChildProcess.spawn(
      "git",
      [
        "config",
        "--global",
        "credential.https://bitbucket.org.helper",
        `store --file ${credentialsPath}`,
      ],
      { stdio: "ignore" },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Git credential configuration failed.")),
    );
  });
}

async function submitBitbucket(
  session: ManagedSession,
  values: Readonly<Record<string, string>>,
): Promise<void> {
  const email = values.email?.trim();
  const apiToken = values.token?.trim();
  if (!email || !apiToken) {
    throw connectorError("submit", "Enter both your Atlassian account email and API token.");
  }
  const response = await fetch("https://api.bitbucket.org/2.0/user", {
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`,
    },
  });
  if (!response.ok) {
    throw connectorError(
      "submit",
      "Bitbucket rejected those credentials. Check the email, token, and token scopes.",
    );
  }
  await writeStoredBitbucketCredentials({ email, apiToken });
  await persistBitbucketGitCredential(email, apiToken);
  setSnapshot(session, {
    status: "succeeded",
    stage: "complete",
    fields: [],
    message: "Bitbucket account connected.",
  });
  scheduleSessionRemoval(session);
}

export const start = Effect.fn("AuthConnectorManager.start")(function* (
  input: AuthConnectorStartInput,
): Effect.fn.Return<AuthConnectorSession, AuthConnectorError> {
  if (input.connector === "bitbucket" && input.method !== "token") {
    return yield* connectorError("start", "That sign-in method is not supported.");
  }
  const id = NodeCrypto.randomUUID();
  const spec = launchSpec(input);
  const initialFields =
    input.connector === "bitbucket" ? secretFields(input) : (spec?.fields ?? []);
  const flow = input.connector === "bitbucket" ? "secret" : (spec?.flow ?? "browser");
  const session: ManagedSession = {
    snapshot: {
      id,
      connector: input.connector,
      method: input.method,
      status: input.connector === "bitbucket" || initialFields.length > 0 ? "waiting" : "starting",
      flow,
      stage:
        input.connector === "bitbucket" || initialFields.length > 0 ? "credential" : "preparing",
      message:
        input.connector === "bitbucket"
          ? "Connect Bitbucket with an Atlassian account email and API token."
          : (spec?.message ?? "Starting sign-in…"),
      verificationUrl: null,
      userCode: null,
      fields: [...initialFields],
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    },
    process: null,
    output: "",
    acceptOutput: true,
    selectedOpenCodeDeployment: false,
    answeredGitHubCredentialPrompt: false,
  };
  sessions.set(id, session);
  const expiry = setTimeout(() => {
    const current = sessions.get(id);
    if (!current) return;
    if (current.snapshot.status === "starting" || current.snapshot.status === "waiting") {
      current.process?.kill();
      current.process = null;
      clearSensitiveOutput(current);
      setSnapshot(current, {
        status: "expired",
        stage: "error",
        fields: [],
        message: "This connection attempt expired. Start again.",
      });
      scheduleSessionRemoval(current);
    }
  }, SESSION_TTL_MS);
  expiry.unref();

  if (input.connector !== "bitbucket") {
    if (!spec) {
      return yield* connectorError("start", "That sign-in method is not supported.");
    }
    yield* Effect.tryPromise({
      try: () => spawnPty(session, spec),
      catch: () =>
        connectorError(
          "start",
          "The provider sign-in tool could not be started. Refresh its installation and try again.",
        ),
    });
  }
  return publicSnapshot(session);
});

export const get = Effect.fn("AuthConnectorManager.get")(function* (
  sessionId: string,
): Effect.fn.Return<AuthConnectorSession, AuthConnectorError> {
  return publicSnapshot(yield* getManagedSession(sessionId));
});

export const submit = Effect.fn("AuthConnectorManager.submit")(function* (
  input: AuthConnectorSubmitInput,
): Effect.fn.Return<AuthConnectorSession, AuthConnectorError> {
  const session = yield* getManagedSession(input.sessionId);
  if (session.snapshot.status !== "waiting") {
    return yield* connectorError("submit", "This connection attempt is not waiting for input.");
  }
  if (session.snapshot.connector === "bitbucket") {
    yield* Effect.tryPromise({
      try: () => submitBitbucket(session, input.values),
      catch: (cause) =>
        isAuthConnectorError(cause)
          ? cause
          : connectorError("submit", "Bitbucket could not be connected. Try again."),
    });
    return publicSnapshot(session);
  }
  const secret =
    session.snapshot.connector === "claude"
      ? input.values.callback?.trim()
      : input.values.secret?.trim();
  if (!secret) {
    return yield* connectorError("submit", "Enter the requested credential to continue.");
  }
  clearSensitiveOutput(session);
  session.process?.write(`${secret}\r`);
  setSnapshot(session, {
    status: "starting",
    stage: "verifying",
    fields: [],
    message: "Verifying your account…",
  });
  return publicSnapshot(session);
});

export const cancel = Effect.fn("AuthConnectorManager.cancel")(function* (
  sessionId: string,
): Effect.fn.Return<AuthConnectorSession, AuthConnectorError> {
  const session = yield* getManagedSession(sessionId);
  session.process?.kill();
  session.process = null;
  clearSensitiveOutput(session);
  setSnapshot(session, {
    status: "cancelled",
    stage: "error",
    fields: [],
    message: "Connection cancelled.",
  });
  scheduleSessionRemoval(session);
  return publicSnapshot(session);
});

function parseOutputForTest(input: {
  readonly connector: AuthConnectorSession["connector"];
  readonly method: AuthConnectorSession["method"];
  readonly flow: AuthConnectorSession["flow"];
  readonly output: string;
  readonly repetitions?: number;
}): { readonly snapshot: AuthConnectorSession; readonly writes: ReadonlyArray<string> } {
  const writes: Array<string> = [];
  const process: PtyProcess = {
    write: (data) => writes.push(data),
    kill: () => undefined,
    onData: () => ({ dispose: () => undefined }),
    onExit: () => ({ dispose: () => undefined }),
  };
  const session: ManagedSession = {
    snapshot: {
      id: "test-session",
      connector: input.connector,
      method: input.method,
      status: "starting",
      flow: input.flow,
      stage: "preparing",
      message: "Preparing sign-in.",
      verificationUrl: null,
      userCode: null,
      fields: [],
      expiresAt: null,
    },
    process,
    output: input.output,
    acceptOutput: true,
    selectedOpenCodeDeployment: false,
    answeredGitHubCredentialPrompt: false,
  };
  for (let index = 0; index < (input.repetitions ?? 1); index += 1) {
    parseProcessOutput(session);
  }
  return { snapshot: publicSnapshot(session), writes };
}

/** @internal */
export const testHelpers = {
  stripAnsi,
  extractUrl,
  extractUserCode,
  hasGitHubCredentialPrompt,
  claudeCallbackField,
  launchSpec,
  parseOutputForTest,
};
