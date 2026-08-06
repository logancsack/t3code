// @effect-diagnostics nodeBuiltinImport:off - Native auth is a Node PTY/process and atomic filesystem boundary.
// @effect-diagnostics globalFetch:off - Bitbucket verification and loopback CDP handoff are intentional process boundaries.
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
  defaultInstanceIdForDriver,
  PrimeSettings,
  ProviderDriverKind,
  type AuthConnectorField,
  type AuthConnectorMethod,
  type AuthConnectorSession,
  type AuthConnectorStartInput,
  type AuthConnectorSubmitInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ServerConfig } from "../config.ts";
import { deriveProviderInstanceConfigMap } from "../provider/Layers/ProviderInstanceRegistryHydration.ts";
import { mergeProviderInstanceEnvironment } from "../provider/ProviderInstanceEnvironment.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { writeStoredBitbucketCredentials } from "../sourceControl/BitbucketCredentialStore.ts";

const SESSION_TTL_MS = 15 * 60 * 1_000;
const TERMINAL_SESSION_RETENTION_MS = 5 * 60 * 1_000;
const MAX_OUTPUT_CHARS = 48_000;
// Fresh v0.7.0 launches rendered deferred onboarding at most 261 ms after
// the initial composer across eight clean-state probes. Two seconds leaves
// a wide margin while keeping an already-onboarded connection responsive.
const PRIME_AGENT_MAIN_PROMPT_STABILITY_MS = 2_000;
const PRIME_AGENT_DRIVER_KIND = ProviderDriverKind.make("primeAgent");
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

type PrimeAgentAuthState = {
  readonly providerQuery: string;
  readonly expectedDialogTitle: string;
  readonly expectedAuthType: "oauth" | "api_key" | "external" | "prime";
  onboardingDismissed: boolean;
  loginOpened: boolean;
  mainPromptTimer: ReturnType<typeof setTimeout> | null;
  providerSelected: boolean;
  providerDialogConfirmed: boolean;
  authSurfaceConfirmed: boolean;
  credentialPromptReady: boolean;
  continuedProviderPrompt: boolean;
  preservedPrimeTeamSelection: boolean;
  workspaceBrowserOpenStarted: boolean;
  pendingInput: string | null;
  submittedInput: string | null;
  sensitiveOutputCarry: string;
};

type ManagedSession = {
  snapshot: AuthConnectorSession;
  process: PtyProcess | null;
  processSubscriptions: Array<{ dispose(): void }>;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  output: string;
  rawOutput: string;
  acceptOutput: boolean;
  selectedOpenCodeDeployment: boolean;
  answeredGitHubCredentialPrompt: boolean;
  answeredGitHubBrowserPrompt: boolean;
  primeAgentAuth: PrimeAgentAuthState | null;
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

const AUTH_URL_HOSTS = [
  "github.com",
  "gitlab.com",
  "openai.com",
  "claude.com",
  "claude.ai",
  "cursor.com",
  "x.ai",
  "auth.meta.com",
  "microsoft.com",
  "microsoftonline.com",
  "aka.ms",
  "primeintellect.ai",
] as const;

function isAllowedAuthUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    const hostname = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === "https:" &&
      AUTH_URL_HOSTS.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`))
    );
  } catch {
    return false;
  }
}

function extractUrl(output: string): string | null {
  const matches = output.match(/https?:\/\/[^\s<>"']+/giu) ?? [];
  return (
    matches.map((candidate) => candidate.replace(/[),.;]+$/u, "")).findLast(isAllowedAuthUrl) ??
    null
  );
}

function extractTerminalHyperlinkUrl(output: string): string | null {
  // Prime's Ink UI wraps long OAuth URLs at the visible terminal width, but
  // preserves the complete target in an OSC-8 hyperlink escape sequence.
  // eslint-disable-next-line no-control-regex
  const matches = output.matchAll(/\u001B\]8;;(https?:\/\/[^\u0007\u001B]+)(?:\u0007|\u001B\\)/gu);
  return (
    Array.from(matches, (match) => match[1]).findLast(
      (candidate): candidate is string => candidate !== undefined && isAllowedAuthUrl(candidate),
    ) ?? null
  );
}

function managedBrowserTargetUrl(
  verificationUrl: string,
  endpoint = process.env.BROWSER_CDP_ENDPOINT ?? process.env.BROWSER_CDP_URL,
): string | null {
  if (!endpoint || !isAllowedAuthUrl(verificationUrl)) return null;

  try {
    const parsedEndpoint = new URL(endpoint);
    const isLoopback = ["127.0.0.1", "[::1]", "localhost"].includes(
      parsedEndpoint.hostname.toLowerCase(),
    );
    if (parsedEndpoint.protocol !== "http:" || !isLoopback) return null;

    const target = new URL("/json/new", parsedEndpoint);
    target.search = `?${encodeURIComponent(verificationUrl)}`;
    return target.toString();
  } catch {
    return null;
  }
}

function openInManagedWorkspaceBrowser(session: ManagedSession, verificationUrl: string): void {
  const state = session.primeAgentAuth;
  if (!state || state.workspaceBrowserOpenStarted) return;
  const targetUrl = managedBrowserTargetUrl(verificationUrl);
  if (!targetUrl) return;

  state.workspaceBrowserOpenStarted = true;
  void fetch(targetUrl, {
    method: "PUT",
    signal: AbortSignal.timeout(3_000),
  }).catch(() => undefined);
}

function extractUserCode(output: string): string | null {
  const patterns = [
    /enter this one-time code(?:\s*\([^)]*\))?\s*\n\s*([A-Z0-9-]{6,})/iu,
    /one-time code:\s*([A-Z0-9-]{6,})/iu,
    /enter code:\s*([A-Z0-9-]{6,})/iu,
    /enter the code\s+([A-Z0-9-]{6,})/iu,
    /confirm this code(?: in your browser)?:\s*([A-Z0-9-]{6,})/iu,
    /confirm this code matches:\s*([A-Z0-9-]{6,})/iu,
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

function hasGitHubBrowserPrompt(output: string): boolean {
  return /press enter to open (?:https?:\/\/)?github\.com(?:\/login\/device)? in your browser/iu.test(
    output,
  );
}

function claudeCallbackField(): AuthConnectorField {
  return field("callback", "Authorization URL or code", "textarea", {
    placeholder: "Paste the full URL from your browser, or the authorization code",
    help: "After approving access, copy the entire URL from the browser address bar. If Anthropic shows a short code instead, you can paste that.",
  });
}

function primeAgentCallbackField(method: AuthConnectorMethod): AuthConnectorField {
  return field("callback", "Redirect URL or authorization code", "textarea", {
    placeholder: "Paste the full redirect URL from your browser",
    help:
      method === "openai-account"
        ? "The workspace browser returns localhost:1455 directly to Prime Agent. If you used the fallback in another browser, paste its complete redirect URL here."
        : "The workspace browser returns the callback directly to Prime Agent. If you used the fallback in another browser, paste the complete redirect URL or authorization code here.",
  });
}

function primeAgentSecretField(method: AuthConnectorMethod): AuthConnectorField {
  const labels: Partial<Record<AuthConnectorMethod, string>> = {
    "prime-inference": "Prime Inference API key",
    "openai-api-key": "OpenAI API key",
    "anthropic-api-key": "Anthropic API key",
    "azure-openai": "Azure OpenAI API key",
    "google-vertex": "Google Vertex API key",
  };
  return field("secret", labels[method] ?? "Provider API key", "password", {
    placeholder: "Paste API key",
    help: "Prime Agent stores this credential in its own authentication file inside the workspace.",
  });
}

function isPrimeAgentSubscriptionMethod(method: AuthConnectorMethod): boolean {
  return method === "openai-account" || method === "anthropic-account";
}

function primeAgentProviderQuery(method: AuthConnectorMethod): string | null {
  const queries: Partial<Record<AuthConnectorMethod, string>> = {
    "prime-inference": "Prime Inference",
    "openai-account": "ChatGPT Plus",
    "openai-api-key": "OpenAI",
    "anthropic-account": "anthropic oauth",
    "anthropic-api-key": "anthropic api_key",
    "azure-openai": "Azure OpenAI Responses",
    "amazon-bedrock": "Amazon Bedrock",
    "google-vertex": "Google Vertex AI",
  };
  return queries[method] ?? null;
}

function primeAgentExpectedDialogTitle(method: AuthConnectorMethod): string | null {
  const titles: Partial<Record<AuthConnectorMethod, string>> = {
    "prime-inference": "Login to Prime Inference",
    "openai-account": "Login to ChatGPT Plus/Pro (Codex Subscription)",
    "openai-api-key": "Login to OpenAI",
    "anthropic-account": "Login to Anthropic (Claude Pro/Max)",
    "anthropic-api-key": "Login to Anthropic (Claude Pro/Max)",
    "azure-openai": "Login to Azure OpenAI Responses",
    "amazon-bedrock": "Amazon Bedrock setup",
    "google-vertex": "Login to Google Vertex AI",
  };
  return titles[method] ?? null;
}

function primeAgentExpectedAuthType(
  method: AuthConnectorMethod,
): PrimeAgentAuthState["expectedAuthType"] | null {
  if (isPrimeAgentSubscriptionMethod(method)) return "oauth";
  if (method === "prime-inference") return "prime";
  if (method === "amazon-bedrock") return "external";
  return primeAgentProviderQuery(method) ? "api_key" : null;
}

function primeAgentInputValue(
  method: AuthConnectorMethod,
  values: Readonly<Record<string, string>>,
): string | undefined {
  return isPrimeAgentSubscriptionMethod(method) ? values.callback?.trim() : values.secret?.trim();
}

function hasTerminalControlCharacters(input: string): boolean {
  // Credentials are written to an interactive PTY followed by a carriage return.
  // Reject embedded controls so a pasted value cannot inject another terminal command.
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001F\u007F-\u009F]/u.test(input);
}

function redactSensitiveOutputChunk(
  chunk: string,
  secret: string,
  carry: string,
): { readonly output: string; readonly carry: string } {
  const combined = `${carry}${chunk}`;
  const output: Array<string> = [];
  let cursor = 0;
  let match = combined.indexOf(secret, cursor);
  while (match !== -1) {
    output.push(combined.slice(cursor, match), "[redacted]");
    cursor = match + secret.length;
    match = combined.indexOf(secret, cursor);
  }

  const tail = combined.slice(cursor);
  let overlapLength = Math.min(tail.length, Math.max(0, secret.length - 1));
  while (overlapLength > 0 && !secret.startsWith(tail.slice(-overlapLength))) {
    overlapLength -= 1;
  }
  const nextCarry = overlapLength > 0 ? tail.slice(-overlapLength) : "";
  output.push(overlapLength > 0 ? tail.slice(0, -overlapLength) : tail);
  return { output: output.join(""), carry: nextCarry };
}

function setSnapshot(
  session: ManagedSession,
  patch: Partial<Omit<AuthConnectorSession, "id" | "connector" | "method">>,
): void {
  session.snapshot = { ...session.snapshot, ...patch };
}

function clearSensitiveOutput(session: ManagedSession): void {
  session.output = "";
  session.rawOutput = "";
  session.acceptOutput = false;
  if (session.primeAgentAuth) {
    if (session.primeAgentAuth.mainPromptTimer) {
      clearTimeout(session.primeAgentAuth.mainPromptTimer);
      session.primeAgentAuth.mainPromptTimer = null;
    }
    session.primeAgentAuth.pendingInput = null;
    session.primeAgentAuth.submittedInput = null;
    session.primeAgentAuth.sensitiveOutputCarry = "";
  }
}

function clearSessionExpiry(session: ManagedSession): void {
  if (!session.expiryTimer) return;
  clearTimeout(session.expiryTimer);
  session.expiryTimer = null;
}

function detachSessionProcess(session: ManagedSession, kill: boolean): void {
  const child = session.process;
  session.process = null;
  for (const subscription of session.processSubscriptions) {
    try {
      subscription.dispose();
    } catch {
      // Listener disposal is best-effort after the PTY has already closed.
    }
  }
  session.processSubscriptions = [];
  if (!kill || !child) return;
  try {
    child.kill();
  } catch {
    // A concurrently exiting PTY may already be gone.
  }
}

function resetCapturedOutput(session: ManagedSession): void {
  session.output = "";
  session.rawOutput = "";
  session.acceptOutput = true;
}

function scheduleSessionRemoval(session: ManagedSession): void {
  clearSessionExpiry(session);
  const cleanup = setTimeout(() => {
    sessions.delete(session.snapshot.id);
  }, TERMINAL_SESSION_RETENTION_MS);
  cleanup.unref();
}

function finishPrimeAgentSession(
  session: ManagedSession,
  outcome: "succeeded" | "failed",
  message: string,
): void {
  if (session.primeAgentAuth?.mainPromptTimer) {
    clearTimeout(session.primeAgentAuth.mainPromptTimer);
    session.primeAgentAuth.mainPromptTimer = null;
  }
  detachSessionProcess(session, true);
  clearSensitiveOutput(session);
  setSnapshot(session, {
    status: outcome,
    stage: outcome === "succeeded" ? "complete" : "error",
    fields: [],
    verificationUrl: null,
    userCode: null,
    message,
  });
  scheduleSessionRemoval(session);
}

function openPrimeAgentLogin(session: ManagedSession): void {
  const state = session.primeAgentAuth;
  if (!state || state.loginOpened) return;
  if (/Welcome to\s+PRIME\s+Agent/iu.test(session.output)) return;
  state.mainPromptTimer = null;
  state.loginOpened = true;
  resetCapturedOutput(session);
  session.process?.write("/login\r");
}

function schedulePrimeAgentLogin(session: ManagedSession): void {
  const state = session.primeAgentAuth;
  if (!state || state.loginOpened || state.mainPromptTimer) return;
  const timer = setTimeout(
    () => openPrimeAgentLogin(session),
    PRIME_AGENT_MAIN_PROMPT_STABILITY_MS,
  );
  timer.unref();
  state.mainPromptTimer = timer;
}

function handlePrimeAgentStartup(session: ManagedSession): boolean {
  const state = session.primeAgentAuth;
  if (!state || state.loginOpened) return false;
  const output = session.output;
  if (
    /Welcome to\s+PRIME\s+Agent/iu.test(output) ||
    /Press Enter to login with Prime Intellect/iu.test(output)
  ) {
    if (state.mainPromptTimer) {
      clearTimeout(state.mainPromptTimer);
      state.mainPromptTimer = null;
    }
    if (!state.onboardingDismissed) {
      state.onboardingDismissed = true;
      resetCapturedOutput(session);
      session.process?.write("\u001B");
    }
    return true;
  }
  if (
    /prime-agent - /iu.test(output) ||
    /Try "(?:refactor|fix bugs in|add tests for|explain how|improve performance in) @<filepath>"/iu.test(
      output,
    )
  ) {
    schedulePrimeAgentLogin(session);
    return true;
  }
  return false;
}

function flushPrimeAgentInput(session: ManagedSession): void {
  const state = session.primeAgentAuth;
  if (!state?.credentialPromptReady || !state.pendingInput) return;
  const value = state.pendingInput;
  state.pendingInput = null;
  state.submittedInput = value;
  state.sensitiveOutputCarry = "";
  resetCapturedOutput(session);
  session.process?.write(`${value}\r`);
  setSnapshot(session, {
    status: "starting",
    stage: "verifying",
    fields: [],
    message: "Waiting for Prime Agent to confirm the connection…",
  });
}

function parsePrimeAgentOutput(session: ManagedSession, verificationUrl: string | null): void {
  const state = session.primeAgentAuth;
  if (!state) return;
  const output = session.output;

  if (handlePrimeAgentStartup(session)) return;

  if (
    !state.providerSelected &&
    /(?:Search providers|Connect with a subscription or API key)/iu.test(output)
  ) {
    state.providerSelected = true;
    resetCapturedOutput(session);
    session.process?.write(`${state.providerQuery}\r`);
    return;
  }

  if (
    state.providerSelected &&
    /(?:No matching providers|No providers found|No results found)/iu.test(output)
  ) {
    finishPrimeAgentSession(
      session,
      "failed",
      "Prime Agent did not expose the requested provider sign-in method. Update Prime Agent or choose another connection method.",
    );
    return;
  }

  if (output.includes(state.expectedDialogTitle)) {
    state.providerDialogConfirmed = true;
  } else {
    const openedDialog = /(?:Login to [A-Za-z0-9 ()/+.-]{1,80}|Amazon Bedrock setup)/iu
      .exec(output)?.[0]
      ?.trim();
    if (openedDialog) {
      finishPrimeAgentSession(
        session,
        "failed",
        `Prime Agent opened the wrong provider dialog (${openedDialog}). No credential was submitted. Update Prime Agent or choose another connection method.`,
      );
      return;
    }
  }

  const apiKeyPrompt = /Enter API key:/u.test(output);
  if (state.providerDialogConfirmed) {
    if (state.expectedAuthType === "api_key" && verificationUrl) {
      finishPrimeAgentSession(
        session,
        "failed",
        "Prime Agent opened a subscription flow instead of the requested API-key flow. No credential was submitted. Update Prime Agent or choose another connection method.",
      );
      return;
    }
    if (state.expectedAuthType === "oauth" && apiKeyPrompt && !verificationUrl) {
      finishPrimeAgentSession(
        session,
        "failed",
        "Prime Agent opened an API-key flow instead of the requested subscription flow. No credential was submitted. Update Prime Agent or choose another connection method.",
      );
      return;
    }
    state.authSurfaceConfirmed ||=
      state.expectedAuthType === "external" ||
      (state.expectedAuthType === "api_key" && apiKeyPrompt) ||
      (state.expectedAuthType === "oauth" && verificationUrl !== null) ||
      (state.expectedAuthType === "prime" && (apiKeyPrompt || verificationUrl !== null));
  }

  const submittedOrBrowserAuthorized =
    state.expectedAuthType !== "api_key" || state.submittedInput !== null;

  if (
    session.snapshot.method === "prime-inference" &&
    state.providerDialogConfirmed &&
    state.authSurfaceConfirmed &&
    !state.preservedPrimeTeamSelection &&
    /Prime Team/iu.test(output) &&
    /Choose which account pays for Prime Inference usage\./iu.test(output)
  ) {
    // Escape preserves Prime Agent's existing/default billing selection. Enter
    // would incorrectly choose Personal because the selector initializes at 0.
    state.preservedPrimeTeamSelection = true;
    session.process?.write("\u001B");
  }

  if (
    state.providerDialogConfirmed &&
    state.authSurfaceConfirmed &&
    submittedOrBrowserAuthorized &&
    /(?:Saved API key for|Logged in to) .+?\. Credentials saved to/iu.test(output)
  ) {
    finishPrimeAgentSession(
      session,
      "succeeded",
      "Account connected. Prime Agent stored the credential in its own workspace authentication file.",
    );
    return;
  }

  if (
    state.providerDialogConfirmed &&
    state.authSurfaceConfirmed &&
    state.expectedAuthType === "external" &&
    /uses external credentials[\s\S]*Select a model/iu.test(output)
  ) {
    finishPrimeAgentSession(
      session,
      "succeeded",
      "External provider credentials detected. Prime Agent can now use them.",
    );
    return;
  }

  if (
    /credentials were not detected[\s\S]*Configure them/iu.test(output) ||
    /(?:authentication|login|authorization) (?:failed|was cancelled)/iu.test(output)
  ) {
    finishPrimeAgentSession(
      session,
      "failed",
      "Prime Agent could not verify this provider connection. Check the provider setup and try again.",
    );
    return;
  }

  if (!state.continuedProviderPrompt && /Press Enter to (?:open|continue|return)/iu.test(output)) {
    state.continuedProviderPrompt = true;
    session.process?.write("\r");
  }

  if (
    state.authSurfaceConfirmed &&
    /(?:Enter API key:|Paste value|Paste redirect URL)/iu.test(output)
  ) {
    state.credentialPromptReady = true;
    flushPrimeAgentInput(session);
  }

  if (
    state.authSurfaceConfirmed &&
    verificationUrl &&
    isPrimeAgentSubscriptionMethod(session.snapshot.method)
  ) {
    openInManagedWorkspaceBrowser(session, verificationUrl);
    setSnapshot(session, {
      status: "waiting",
      flow: "code",
      stage: "return",
      verificationUrl,
      fields: [primeAgentCallbackField(session.snapshot.method)],
      message:
        session.snapshot.method === "openai-account"
          ? "Complete OpenAI sign-in in the workspace browser so its localhost callback returns directly to Prime Agent."
          : "Complete Anthropic sign-in in the workspace browser so its localhost callback returns directly to Prime Agent.",
    });
    return;
  }

  if (state.authSurfaceConfirmed && verificationUrl) {
    const offerApiKeyFallback =
      session.snapshot.method === "prime-inference" && state.credentialPromptReady;
    setSnapshot(session, {
      status: "waiting",
      stage: "authorize",
      verificationUrl,
      fields: offerApiKeyFallback ? [primeAgentSecretField(session.snapshot.method)] : [],
      message: offerApiKeyFallback
        ? "Finish Prime Intellect sign-in in the workspace Browser panel, or paste a Prime Inference API key below."
        : "Finish signing in in the workspace Browser panel. This screen updates automatically.",
    });
    return;
  }

  if (
    session.snapshot.method === "prime-inference" &&
    state.authSurfaceConfirmed &&
    state.credentialPromptReady
  ) {
    setSnapshot(session, {
      status: "waiting",
      flow: "secret",
      stage: "credential",
      fields: [primeAgentSecretField(session.snapshot.method)],
      message: "Paste a Prime Inference API key to connect without browser sign-in.",
    });
  }
}

function parseProcessOutput(session: ManagedSession): void {
  const output = session.output;
  const userCode = extractUserCode(output);
  const verificationUrl =
    extractTerminalHyperlinkUrl(session.rawOutput) ??
    extractUrl(output) ??
    (session.snapshot.connector === "github" && userCode
      ? "https://github.com/login/device"
      : null);

  if (session.snapshot.connector === "prime-agent") {
    parsePrimeAgentOutput(session, verificationUrl);
    return;
  }

  if (
    session.snapshot.connector === "github" &&
    !session.answeredGitHubCredentialPrompt &&
    hasGitHubCredentialPrompt(output)
  ) {
    session.answeredGitHubCredentialPrompt = true;
    session.process?.write("y\r");
  }

  if (
    session.snapshot.connector === "github" &&
    !session.answeredGitHubBrowserPrompt &&
    hasGitHubBrowserPrompt(output)
  ) {
    session.answeredGitHubBrowserPrompt = true;
    session.process?.write("\r");
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
    session.snapshot.status === "succeeded" ||
    session.snapshot.status === "failed"
  ) {
    return;
  }
  detachSessionProcess(session, false);
  clearSensitiveOutput(session);
  if (session.snapshot.connector === "prime-agent") {
    setSnapshot(session, {
      status: "failed",
      stage: "error",
      fields: [],
      verificationUrl: null,
      userCode: null,
      message:
        "Prime Agent closed before it confirmed that the provider credential was saved. Try again and complete every step in the sign-in flow.",
    });
    scheduleSessionRemoval(session);
    return;
  }
  if (exitCode === 0) {
    setSnapshot(session, {
      status: "succeeded",
      stage: "complete",
      fields: [],
      verificationUrl: null,
      userCode: null,
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
    verificationUrl: null,
    userCode: null,
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

function secretInputTerminator(input: Pick<AuthConnectorSession, "connector" | "method">): string {
  return input.connector === "muse" && input.method === "api-key" ? "\r\u0004" : "\r";
}

type LaunchSpec = {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly flow: AuthConnectorSession["flow"];
  readonly message: string;
  readonly fields?: ReadonlyArray<AuthConnectorField>;
  readonly env?: Readonly<NodeJS.ProcessEnv>;
  readonly ptyName?: string;
  readonly columns?: number;
  readonly primeAgentProviderQuery?: string;
  readonly primeAgentExpectedDialogTitle?: string;
  readonly primeAgentExpectedAuthType?: PrimeAgentAuthState["expectedAuthType"];
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
    case "muse":
      if (input.method !== "account" && input.method !== "api-key") return null;
      return input.method === "api-key"
        ? {
            command: "muse",
            args: ["auth", "set", "--provider", "meta", "--api-key-stdin"],
            flow: "secret",
            message: "Enter a Meta API key.",
            fields: secretFields(input),
          }
        : {
            command: "muse",
            args: ["login"],
            flow: "device",
            message: "Starting secure Meta sign-in…",
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
            env: { GH_BROWSER: "true" },
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
    case "prime-agent": {
      const providerQuery = primeAgentProviderQuery(input.method);
      const expectedDialogTitle = primeAgentExpectedDialogTitle(input.method);
      const expectedAuthType = primeAgentExpectedAuthType(input.method);
      if (!providerQuery || !expectedDialogTitle || !expectedAuthType) return null;
      const subscription = isPrimeAgentSubscriptionMethod(input.method);
      const requiresApiKey =
        input.method === "openai-api-key" ||
        input.method === "anthropic-api-key" ||
        input.method === "azure-openai" ||
        input.method === "google-vertex";
      return {
        command: "prime-agent",
        args: [
          "--no-session",
          "--no-context-files",
          "--no-skills",
          "--no-extensions",
          "--no-themes",
        ],
        flow: subscription ? "code" : requiresApiKey ? "secret" : "browser",
        message: subscription
          ? "Starting provider sign-in in Prime Agent…"
          : requiresApiKey
            ? "Enter the provider API key. Prime Agent will store it in its own workspace authentication file."
            : "Starting provider setup in Prime Agent…",
        ...(requiresApiKey ? { fields: [primeAgentSecretField(input.method)] } : {}),
        env: {
          // Prime renders OAuth URLs as OSC-8 hyperlinks only for terminals it
          // knows support them. The managed PTY consumes those hyperlinks and
          // needs the full target because the visible URL wraps inside Prime's
          // fixed-width login dialog.
          TERM_PROGRAM: "vscode",
          TMUX: "",
        },
        columns: 512,
        primeAgentProviderQuery: providerQuery,
        primeAgentExpectedDialogTitle: expectedDialogTitle,
        primeAgentExpectedAuthType: expectedAuthType,
      };
    }
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

const decodePrimeSettings = Schema.decodeUnknownEffect(PrimeSettings);

const resolvePrimeAgentLaunchSpec = Effect.fn("AuthConnectorManager.resolvePrimeAgentLaunchSpec")(
  function* (
    input: AuthConnectorStartInput,
    spec: LaunchSpec,
  ): Effect.fn.Return<LaunchSpec, AuthConnectorError, ServerSettingsService> {
    const serverSettings = yield* ServerSettingsService;
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(() =>
        connectorError(
          "start",
          "Prime Agent provider settings could not be loaded. Refresh and try again.",
        ),
      ),
    );
    // `getSettings` returns the server-only materialized view, including
    // sensitive provider environment values. Derive the same map that feeds
    // ProviderInstanceRegistry so legacy default instances and explicit
    // multi-instance entries resolve identically to normal model execution.
    const configMap = deriveProviderInstanceConfigMap(settings);
    const instanceId =
      input.providerInstanceId ?? defaultInstanceIdForDriver(PRIME_AGENT_DRIVER_KIND);
    const instance = configMap[instanceId];
    if (!instance) {
      return yield* connectorError(
        "start",
        `Prime Agent provider instance '${instanceId}' does not exist.`,
      );
    }
    if (instance.driver !== PRIME_AGENT_DRIVER_KIND) {
      return yield* connectorError(
        "start",
        `Provider instance '${instanceId}' is not a Prime Agent instance.`,
      );
    }
    const primeSettings = yield* decodePrimeSettings(instance.config ?? {}).pipe(
      Effect.mapError(() =>
        connectorError(
          "start",
          `Prime Agent provider instance '${instanceId}' has invalid configuration.`,
        ),
      ),
    );
    if (!(instance.enabled ?? primeSettings.enabled)) {
      return yield* connectorError(
        "start",
        `Prime Agent provider instance '${instanceId}' is disabled.`,
      );
    }

    return {
      ...spec,
      command: primeSettings.binaryPath,
      env: {
        ...mergeProviderInstanceEnvironment(instance.environment, {}),
        ...spec.env,
      },
    };
  },
);

async function spawnPty(session: ManagedSession, spec: LaunchSpec): Promise<void> {
  const pty = await import("node-pty");
  const child = pty.spawn(spec.command, [...spec.args], {
    name: spec.ptyName ?? "xterm-256color",
    cols: spec.columns ?? 100,
    rows: 32,
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...spec.env,
      // These are connector invariants, not provider-instance knobs. Keep
      // them final so neither the host nor a configured environment entry
      // can make an auth subprocess open a browser or behave as CI.
      NO_OPEN_BROWSER: "1",
      CI: "0",
    },
  }) as PtyProcess;
  session.process = child;
  session.processSubscriptions.push(
    child.onData((chunk) => {
      if (!session.acceptOutput) return;
      const primeState = session.primeAgentAuth;
      let sanitizedChunk = chunk;
      if (primeState?.submittedInput) {
        const redacted = redactSensitiveOutputChunk(
          chunk,
          primeState.submittedInput,
          primeState.sensitiveOutputCarry,
        );
        primeState.sensitiveOutputCarry = redacted.carry;
        sanitizedChunk = redacted.output;
      }
      if (!sanitizedChunk) return;
      session.rawOutput = `${session.rawOutput}${sanitizedChunk}`.slice(-MAX_OUTPUT_CHARS);
      session.output = `${session.output}${stripAnsi(sanitizedChunk)}`.slice(-MAX_OUTPUT_CHARS);
      parseProcessOutput(session);
    }),
  );
  session.processSubscriptions.push(
    child.onExit(({ exitCode }) => completeSession(session, exitCode)),
  );
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
    verificationUrl: null,
    userCode: null,
    message: "Bitbucket account connected.",
  });
  scheduleSessionRemoval(session);
}

export const start = Effect.fn("AuthConnectorManager.start")(function* (
  input: AuthConnectorStartInput,
): Effect.fn.Return<
  AuthConnectorSession,
  AuthConnectorError,
  ServerConfig | ServerSettingsService
> {
  const { museCodeEnabled, primeAgentSubscriptionOAuthEnabled } = yield* ServerConfig;
  if (input.connector === "muse" && !museCodeEnabled) {
    return yield* connectorError(
      "start",
      "Muse Code is not available in this T3 Code environment.",
    );
  }
  if (
    input.connector === "prime-agent" &&
    isPrimeAgentSubscriptionMethod(input.method) &&
    !primeAgentSubscriptionOAuthEnabled
  ) {
    return yield* connectorError(
      "start",
      "Prime Agent subscription OAuth is not enabled by this server.",
    );
  }
  if (input.connector === "bitbucket" && input.method !== "token") {
    return yield* connectorError("start", "That sign-in method is not supported.");
  }
  const baseSpec = launchSpec(input);
  if (input.connector !== "bitbucket" && !baseSpec) {
    return yield* connectorError("start", "That sign-in method is not supported.");
  }
  const spec =
    input.connector === "prime-agent" && baseSpec
      ? yield* resolvePrimeAgentLaunchSpec(input, baseSpec)
      : baseSpec;
  const id = NodeCrypto.randomUUID();
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
    processSubscriptions: [],
    expiryTimer: null,
    output: "",
    rawOutput: "",
    acceptOutput: true,
    selectedOpenCodeDeployment: false,
    answeredGitHubCredentialPrompt: false,
    answeredGitHubBrowserPrompt: false,
    primeAgentAuth:
      spec?.primeAgentProviderQuery &&
      spec.primeAgentExpectedDialogTitle &&
      spec.primeAgentExpectedAuthType
        ? {
            providerQuery: spec.primeAgentProviderQuery,
            expectedDialogTitle: spec.primeAgentExpectedDialogTitle,
            expectedAuthType: spec.primeAgentExpectedAuthType,
            onboardingDismissed: false,
            loginOpened: false,
            mainPromptTimer: null,
            providerSelected: false,
            providerDialogConfirmed: false,
            authSurfaceConfirmed: false,
            credentialPromptReady: false,
            continuedProviderPrompt: false,
            preservedPrimeTeamSelection: false,
            workspaceBrowserOpenStarted: false,
            pendingInput: null,
            submittedInput: null,
            sensitiveOutputCarry: "",
          }
        : null,
  };
  sessions.set(id, session);
  session.expiryTimer = setTimeout(() => {
    const current = sessions.get(id);
    if (!current) return;
    current.expiryTimer = null;
    if (current.snapshot.status === "starting" || current.snapshot.status === "waiting") {
      detachSessionProcess(current, true);
      clearSensitiveOutput(current);
      setSnapshot(current, {
        status: "expired",
        stage: "error",
        fields: [],
        verificationUrl: null,
        userCode: null,
        message: "This connection attempt expired. Start again.",
      });
      scheduleSessionRemoval(current);
    }
  }, SESSION_TTL_MS);
  session.expiryTimer.unref();

  if (spec) {
    yield* Effect.tryPromise({
      try: () => spawnPty(session, spec),
      catch: () => {
        detachSessionProcess(session, true);
        clearSensitiveOutput(session);
        clearSessionExpiry(session);
        sessions.delete(id);
        return connectorError(
          "start",
          "The provider sign-in tool could not be started. Refresh its installation and try again.",
        );
      },
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
  const rawCredential =
    session.snapshot.connector === "prime-agent"
      ? isPrimeAgentSubscriptionMethod(session.snapshot.method)
        ? input.values.callback
        : input.values.secret
      : session.snapshot.connector === "claude"
        ? input.values.callback
        : input.values.secret;
  if (rawCredential && hasTerminalControlCharacters(rawCredential)) {
    return yield* connectorError(
      "submit",
      "Credentials cannot contain line breaks or terminal control characters.",
    );
  }
  const secret =
    session.snapshot.connector === "prime-agent"
      ? primeAgentInputValue(session.snapshot.method, input.values)
      : rawCredential?.trim();
  if (!secret) {
    return yield* connectorError("submit", "Enter the requested credential to continue.");
  }
  if (session.snapshot.connector === "prime-agent") {
    const state = session.primeAgentAuth;
    if (!state) {
      return yield* connectorError("submit", "Prime Agent sign-in is no longer active.");
    }
    resetCapturedOutput(session);
    state.pendingInput = secret;
    setSnapshot(session, {
      status: "starting",
      stage: "verifying",
      fields: [],
      message: state.credentialPromptReady
        ? "Waiting for Prime Agent to confirm the connection…"
        : "Waiting for Prime Agent's secure credential prompt…",
    });
    flushPrimeAgentInput(session);
    return publicSnapshot(session);
  }
  clearSensitiveOutput(session);
  session.process?.write(`${secret}${secretInputTerminator(session.snapshot)}`);
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
  detachSessionProcess(session, true);
  clearSensitiveOutput(session);
  setSnapshot(session, {
    status: "cancelled",
    stage: "error",
    fields: [],
    verificationUrl: null,
    userCode: null,
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
  readonly rawOutput?: string;
  readonly repetitions?: number;
  readonly followupOutputs?: ReadonlyArray<{
    readonly output: string;
    readonly rawOutput?: string;
  }>;
  readonly exitCode?: number;
  readonly settlePrimeStartup?: boolean;
  readonly pendingInput?: string;
}): {
  readonly snapshot: AuthConnectorSession;
  readonly writes: ReadonlyArray<string>;
  readonly sensitiveState: {
    readonly pendingInput: string | null;
    readonly submittedInput: string | null;
  } | null;
} {
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
    processSubscriptions: [],
    expiryTimer: null,
    output: input.output,
    rawOutput: input.rawOutput ?? input.output,
    acceptOutput: true,
    selectedOpenCodeDeployment: false,
    answeredGitHubCredentialPrompt: false,
    answeredGitHubBrowserPrompt: false,
    primeAgentAuth:
      input.connector === "prime-agent"
        ? {
            providerQuery: primeAgentProviderQuery(input.method) ?? "unsupported",
            expectedDialogTitle:
              primeAgentExpectedDialogTitle(input.method) ?? "Unsupported provider dialog",
            expectedAuthType: primeAgentExpectedAuthType(input.method) ?? "api_key",
            onboardingDismissed: false,
            loginOpened: false,
            mainPromptTimer: null,
            providerSelected: false,
            providerDialogConfirmed: false,
            authSurfaceConfirmed: false,
            credentialPromptReady: false,
            continuedProviderPrompt: false,
            preservedPrimeTeamSelection: false,
            workspaceBrowserOpenStarted: false,
            pendingInput: input.pendingInput ?? null,
            submittedInput: null,
            sensitiveOutputCarry: "",
          }
        : null,
  };
  for (let index = 0; index < (input.repetitions ?? 1); index += 1) {
    parseProcessOutput(session);
  }
  for (const followup of input.followupOutputs ?? []) {
    session.output = `${session.output}${followup.output}`;
    session.rawOutput = `${session.rawOutput}${followup.rawOutput ?? followup.output}`;
    parseProcessOutput(session);
  }
  if (input.settlePrimeStartup) openPrimeAgentLogin(session);
  if (input.exitCode !== undefined) completeSession(session, input.exitCode);
  if (session.primeAgentAuth?.mainPromptTimer) {
    clearTimeout(session.primeAgentAuth.mainPromptTimer);
    session.primeAgentAuth.mainPromptTimer = null;
  }
  return {
    snapshot: publicSnapshot(session),
    writes,
    sensitiveState: session.primeAgentAuth
      ? {
          pendingInput: session.primeAgentAuth.pendingInput,
          submittedInput: session.primeAgentAuth.submittedInput,
        }
      : null,
  };
}

/** @internal */
export const testHelpers = {
  stripAnsi,
  extractUrl,
  extractTerminalHyperlinkUrl,
  managedBrowserTargetUrl,
  extractUserCode,
  hasGitHubCredentialPrompt,
  hasGitHubBrowserPrompt,
  claudeCallbackField,
  primeAgentCallbackField,
  primeAgentProviderQuery,
  primeAgentExpectedDialogTitle,
  primeAgentExpectedAuthType,
  primeAgentInputValue,
  hasTerminalControlCharacters,
  redactSensitiveOutputChunk,
  secretInputTerminator,
  launchSpec,
  resolvePrimeAgentLaunchSpec,
  parseOutputForTest,
};
