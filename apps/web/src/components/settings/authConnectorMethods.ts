import type { AuthConnectorKind } from "@t3tools/contracts";

import type { AuthConnectorMethodOption } from "./AuthConnectorDialog";

type AgentAuthConnector = {
  readonly connector: AuthConnectorKind;
  readonly serviceName: string;
  readonly methods: ReadonlyArray<AuthConnectorMethodOption>;
};

const PRIME_AGENT_SUBSCRIPTION_METHODS: ReadonlyArray<AuthConnectorMethodOption> = [
  {
    method: "openai-account",
    label: "ChatGPT subscription OAuth",
    badgeLabel: "Subscription",
    description:
      "Sign in to ChatGPT Plus or Pro for Prime Agent. This creates a separate secure grant and does not copy your Codex credentials.",
    browserName: "OpenAI",
    workspaceBrowser: true,
    authorizeInstruction:
      "Prime Agent opened OpenAI in the workspace browser so the localhost callback stays inside your workspace.",
    manualAuthorizeInstruction:
      "Open OpenAI in this browser, approve access, then return here with the complete localhost:1455 redirect URL.",
    returnInstruction:
      "Prime Agent normally finishes automatically. If you used the fallback in this browser, paste the complete localhost:1455 redirect URL below.",
  },
  {
    method: "anthropic-account",
    label: "Claude subscription OAuth",
    badgeLabel: "Subscription",
    description:
      "Sign in to Claude Pro or Max for Prime Agent. This creates a separate secure grant and does not copy your Claude Code credentials.",
    browserName: "Anthropic",
    workspaceBrowser: true,
    authorizeInstruction:
      "Prime Agent opened Anthropic in the workspace browser so the localhost callback stays inside your workspace.",
    manualAuthorizeInstruction:
      "Open Anthropic in this browser, approve access, then return here with the redirect URL or authorization code.",
    returnInstruction:
      "Prime Agent normally finishes automatically. If you used the fallback in this browser, paste the redirect URL or authorization code below.",
  },
];

export const AGENT_AUTH_METHODS: Partial<Record<string, AgentAuthConnector>> = {
  codex: {
    connector: "codex",
    serviceName: "Codex",
    methods: [
      {
        method: "account",
        label: "Sign in with ChatGPT",
        description: "Use your ChatGPT Plus, Pro, Business, Enterprise, or Edu account.",
        browserName: "OpenAI",
        authorizeInstruction:
          "We’ll copy the one-time code for you. Enter it on OpenAI’s device page, then approve access.",
        waitingMessage: "Waiting for OpenAI to confirm the code…",
      },
      {
        method: "api-key",
        label: "Use an OpenAI API key",
        description: "Use pay-as-you-go API billing from the OpenAI Platform.",
        externalHelpUrl: "https://platform.openai.com/api-keys",
        externalHelpLabel: "Create an OpenAI API key",
      },
    ],
  },
  claudeAgent: {
    connector: "claude",
    serviceName: "Claude",
    methods: [
      {
        method: "account",
        label: "Claude subscription",
        description: "Use a Claude Pro, Max, Team, or Enterprise subscription.",
        browserName: "Anthropic",
        authorizeInstruction: "Approve access to your Claude subscription in the Anthropic tab.",
        returnInstruction:
          "After approving, copy the entire URL from the browser address bar and paste it below. If Anthropic shows a short code instead, paste that.",
      },
      {
        method: "console",
        label: "Anthropic Console",
        description: "Use API-based billing through your Anthropic Console organization.",
        browserName: "Anthropic",
        authorizeInstruction: "Choose your Anthropic Console organization and approve access.",
        returnInstruction:
          "After approving, copy the entire URL from the browser address bar and paste it below. If Anthropic shows a short code instead, paste that.",
      },
    ],
  },
  cursor: {
    connector: "cursor",
    serviceName: "Cursor",
    methods: [
      {
        method: "account",
        label: "Sign in with Cursor",
        description: "Connect your Cursor account and active subscription in the browser.",
        browserName: "Cursor",
        authorizeInstruction:
          "Sign in to Cursor and approve this workspace. You can close the tab when Cursor says you’re connected.",
        waitingMessage: "Waiting for Cursor to finish sign-in…",
      },
    ],
  },
  grok: {
    connector: "grok",
    serviceName: "Grok",
    methods: [
      {
        method: "account",
        label: "Sign in with xAI",
        description: "Use your Grok or X subscription through xAI's secure device flow.",
        browserName: "xAI",
        authorizeInstruction:
          "Enter the one-time code on xAI’s device page and approve access to your account.",
        waitingMessage: "Waiting for xAI to confirm the code…",
      },
    ],
  },
  muse: {
    connector: "muse",
    serviceName: "Muse Code",
    methods: [
      {
        method: "account",
        label: "Sign in with Meta",
        description: "Connect your Meta account with Muse Code's secure device flow.",
        browserName: "Meta",
        authorizeInstruction:
          "Confirm that the one-time code matches on Meta’s authorization page, then approve access.",
        waitingMessage: "Waiting for Meta to confirm the code…",
      },
      {
        method: "api-key",
        label: "Use a Meta API key",
        description: "Authenticate Muse Code with a Meta API key.",
        externalHelpUrl: "https://dev.meta.ai/",
        externalHelpLabel: "Create a Meta API key",
      },
    ],
  },
  primeAgent: {
    connector: "prime-agent",
    serviceName: "Prime Agent",
    methods: [
      {
        method: "prime-inference",
        label: "Prime Inference",
        description:
          "Sign in with Prime Intellect or paste a Prime API key. Prime Agent stores the credential in its own workspace config.",
        browserName: "Prime Intellect",
        authorizeInstruction:
          "Complete Prime Intellect sign-in in the workspace Browser panel, or use Prime Agent's API-key fallback.",
        waitingMessage: "Waiting for Prime Agent to confirm Prime Inference access…",
      },
      {
        method: "openai-api-key",
        label: "OpenAI API key",
        description:
          "Use OpenAI Platform API billing. The key is saved only in Prime Agent's workspace authentication file.",
        externalHelpUrl: "https://platform.openai.com/api-keys",
        externalHelpLabel: "Create an OpenAI API key",
      },
      {
        method: "anthropic-api-key",
        label: "Anthropic API key",
        description:
          "Use Anthropic Console API billing. The key is saved only in Prime Agent's workspace authentication file.",
        externalHelpUrl: "https://console.anthropic.com/settings/keys",
        externalHelpLabel: "Create an Anthropic API key",
      },
      {
        method: "azure-openai",
        label: "Azure OpenAI",
        description:
          "Store an Azure OpenAI Responses key in Prime Agent. The selected provider instance must also set AZURE_OPENAI_BASE_URL or AZURE_OPENAI_RESOURCE_NAME in its environment.",
      },
      {
        method: "google-vertex",
        label: "Google Vertex AI",
        description:
          "Store a Google Vertex AI credential directly in Prime Agent's workspace config.",
      },
      {
        method: "amazon-bedrock",
        label: "Amazon Bedrock",
        description:
          "Let Prime Agent detect an existing AWS profile, IAM keys, bearer token, or role-based credentials in this workspace.",
      },
    ],
  },
  opencode: {
    connector: "opencode",
    serviceName: "OpenCode",
    methods: [
      {
        method: "openai-account",
        label: "ChatGPT Plus / Pro",
        description: "Connect an OpenAI account with a headless device-code flow.",
        browserName: "OpenAI",
        authorizeInstruction:
          "Enter the one-time code on OpenAI’s device page and approve OpenCode access.",
        waitingMessage: "Waiting for OpenAI to confirm the code…",
      },
      {
        method: "github-copilot",
        label: "GitHub Copilot",
        description: "Use models included with your GitHub Copilot subscription.",
        browserName: "GitHub",
        authorizeInstruction:
          "Enter the one-time code on GitHub and authorize access to your Copilot subscription.",
        waitingMessage: "Waiting for GitHub to confirm the code…",
      },
      {
        method: "xai-account",
        label: "xAI / SuperGrok",
        description: "Connect a Grok subscription with a secure device-code flow.",
        browserName: "xAI",
        authorizeInstruction:
          "Enter the one-time code on xAI’s device page and approve OpenCode access.",
        waitingMessage: "Waiting for xAI to confirm the code…",
      },
      {
        method: "anthropic-api-key",
        label: "Anthropic API key",
        description: "Use Anthropic Console API billing.",
        externalHelpUrl: "https://console.anthropic.com/settings/keys",
        externalHelpLabel: "Create an Anthropic API key",
      },
      {
        method: "opencode-api-key",
        label: "OpenCode Zen",
        description: "Use OpenCode's curated Zen model gateway.",
        externalHelpUrl: "https://opencode.ai/auth",
        externalHelpLabel: "Create an OpenCode Zen key",
      },
      {
        method: "openrouter-api-key",
        label: "OpenRouter",
        description: "Use one API key across OpenRouter's model catalog.",
        externalHelpUrl: "https://openrouter.ai/settings/keys",
        externalHelpLabel: "Create an OpenRouter key",
      },
    ],
  },
};

export function resolveAgentAuthMethods(
  driver: string,
  primeAgentSubscriptionOAuthEnabled = false,
): AgentAuthConnector | undefined {
  const configured = AGENT_AUTH_METHODS[driver];
  if (!configured || driver !== "primeAgent" || !primeAgentSubscriptionOAuthEnabled) {
    return configured;
  }
  return {
    ...configured,
    methods: [...configured.methods, ...PRIME_AGENT_SUBSCRIPTION_METHODS],
  };
}

export const SOURCE_CONTROL_AUTH_METHODS = {
  github: {
    connector: "github" as const,
    serviceName: "GitHub",
    methods: [
      {
        method: "account" as const,
        label: "Sign in with GitHub",
        description: "Authorize this workspace with GitHub's one-time device code.",
        browserName: "GitHub",
        authorizeInstruction:
          "Enter the one-time code on GitHub, then authorize this workspace for your repositories.",
        waitingMessage: "Waiting for GitHub to approve this workspace…",
      },
      {
        method: "token" as const,
        label: "Use a personal access token",
        description: "Connect GitHub Enterprise or a manually scoped GitHub token.",
        externalHelpUrl: "https://github.com/settings/personal-access-tokens",
        externalHelpLabel: "Create a GitHub token",
      },
    ],
  },
  gitlab: {
    connector: "gitlab" as const,
    serviceName: "GitLab",
    methods: [
      {
        method: "account" as const,
        label: "Sign in with GitLab",
        description: "Authorize GitLab.com using its headless OAuth device flow.",
        browserName: "GitLab",
        authorizeInstruction:
          "Enter the one-time code on GitLab, review the requested access, and approve it.",
        waitingMessage: "Waiting for GitLab to approve this workspace…",
      },
      {
        method: "token" as const,
        label: "Use a personal access token",
        description: "Connect GitLab.com or a self-managed GitLab instance.",
        externalHelpUrl: "https://gitlab.com/-/user_settings/personal_access_tokens",
        externalHelpLabel: "Create a GitLab token",
      },
    ],
  },
  "azure-devops": {
    connector: "azure-devops" as const,
    serviceName: "Azure DevOps",
    methods: [
      {
        method: "account" as const,
        label: "Sign in with Microsoft",
        description:
          "Connect the Microsoft account that has access to your Azure DevOps organization.",
        browserName: "Microsoft",
        authorizeInstruction:
          "Enter the one-time code on Microsoft’s device page, then choose the account with Azure DevOps access.",
        waitingMessage: "Waiting for Microsoft to confirm the code…",
      },
    ],
  },
  bitbucket: {
    connector: "bitbucket" as const,
    serviceName: "Bitbucket",
    methods: [
      {
        method: "token" as const,
        label: "Connect with an API token",
        description: "Use your Atlassian account email and a scoped Bitbucket API token.",
        externalHelpUrl: "https://id.atlassian.com/manage-profile/security/api-tokens",
        externalHelpLabel: "Create an Atlassian API token",
      },
    ],
  },
};
