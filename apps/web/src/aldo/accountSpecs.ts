import type { AuthConnectorMethodOption } from "../components/settings/AuthConnectorDialog";
import type { AldoAccountKind } from "./cloud";

export type AccountSpec = {
  readonly kind: AldoAccountKind;
  readonly title: string;
  readonly description: string;
  readonly serviceName: string;
  readonly method: AuthConnectorMethodOption;
};

export const ALDO_ACCOUNT_SPECS: Record<AldoAccountKind, AccountSpec> = {
  github: {
    kind: "github",
    title: "GitHub",
    description: "Lets threads clone your repositories, push branches, and open pull requests.",
    serviceName: "GitHub",
    method: {
      method: "account",
      label: "Sign in with GitHub",
      description: "Authorize Aldo with GitHub's one-time device code.",
      browserName: "GitHub",
      authorizeInstruction:
        "Enter the one-time code on GitHub, then authorize access to your repositories.",
      waitingMessage: "Waiting for GitHub to approve…",
    },
  },
  claude: {
    kind: "claude",
    title: "Claude Code",
    description: "Runs Claude Code on your Claude Pro or Max subscription.",
    serviceName: "Claude",
    method: {
      method: "account",
      label: "Claude subscription",
      description: "Use your Claude Pro, Max, Team, or Enterprise subscription.",
      browserName: "Anthropic",
      authorizeInstruction: "Sign in to Claude and approve access in the Anthropic tab.",
      returnInstruction: "After you approve, Anthropic shows a code. Copy it and paste it below.",
    },
  },
  codex: {
    kind: "codex",
    title: "Codex",
    description: "Runs Codex on your ChatGPT Plus or Pro subscription.",
    serviceName: "Codex",
    method: {
      method: "account",
      label: "Sign in with ChatGPT",
      description: "Use your ChatGPT Plus, Pro, Business, or Enterprise account.",
      browserName: "OpenAI",
      authorizeInstruction: "Enter the one-time code on OpenAI's device page, then approve access.",
      waitingMessage: "Waiting for OpenAI to confirm the code…",
    },
  },
  grok: {
    kind: "grok",
    title: "Grok Build",
    description: "Runs Grok Build on your SuperGrok or X Premium+ subscription.",
    serviceName: "Grok",
    method: {
      method: "account",
      label: "Sign in with xAI",
      description: "Use your Grok or X subscription through xAI's device flow.",
      browserName: "xAI",
      authorizeInstruction: "Confirm the one-time code on xAI's page and approve access.",
      waitingMessage: "Waiting for xAI to confirm the code…",
    },
  },
};

/** The sign-in Aldo runs for a connector, or null if Aldo can't connect it. */
export function aldoAccountMethod(connector: string): AuthConnectorMethodOption | null {
  return connector in ALDO_ACCOUNT_SPECS
    ? ALDO_ACCOUNT_SPECS[connector as AldoAccountKind].method
    : null;
}
