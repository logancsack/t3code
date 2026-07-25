import type { AuthConnectorKind } from "@t3tools/contracts";

import type { AuthConnectorMethodOption } from "./AuthConnectorDialog";

export const AGENT_AUTH_METHODS: Partial<
  Record<
    string,
    {
      readonly connector: AuthConnectorKind;
      readonly serviceName: string;
      readonly methods: ReadonlyArray<AuthConnectorMethodOption>;
    }
  >
> = {
  codex: {
    connector: "codex",
    serviceName: "Codex",
    methods: [
      {
        method: "account",
        label: "Sign in with ChatGPT",
        description: "Use your ChatGPT Plus, Pro, Business, Enterprise, or Edu account.",
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
      },
      {
        method: "console",
        label: "Anthropic Console",
        description: "Use API-based billing through your Anthropic Console organization.",
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
      },
      {
        method: "github-copilot",
        label: "GitHub Copilot",
        description: "Use models included with your GitHub Copilot subscription.",
      },
      {
        method: "xai-account",
        label: "xAI / SuperGrok",
        description: "Connect a Grok subscription with a secure device-code flow.",
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

export const SOURCE_CONTROL_AUTH_METHODS = {
  github: {
    connector: "github" as const,
    serviceName: "GitHub",
    methods: [
      {
        method: "account" as const,
        label: "Sign in with GitHub",
        description: "Authorize this workspace with GitHub's one-time device code.",
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
