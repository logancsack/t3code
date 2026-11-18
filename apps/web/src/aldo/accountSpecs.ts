import { useEffect, useState } from "react";

import type { AuthConnectorMethodOption } from "../components/settings/AuthConnectorDialog";
import { aldoReportsAccount, fetchAldoAccounts, type AldoAccountKind } from "./accountApi";

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
    title: "Claude",
    description: "Your Claude Pro or Max plan, through Claude Code.",
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
    title: "ChatGPT",
    description: "Your ChatGPT Plus or Pro plan, through Codex.",
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
    title: "Grok",
    description: "Your SuperGrok or X Premium+ plan, through Grok Build.",
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
  muse: {
    kind: "muse",
    title: "Muse Code",
    description:
      "Your Muse Code plan from Meta. Its Contributor mode gives more usage, and Meta may train on what the agent sees.",
    serviceName: "Muse Code",
    method: {
      method: "account",
      label: "Sign in with Meta",
      description: "Use your Muse Code plan through Meta's device sign-in.",
      browserName: "Meta",
      authorizeInstruction: "Check that the code matches on Meta's page, then approve access.",
      waitingMessage: "Waiting for Meta to confirm…",
    },
  },
};

/**
 * The sign-in Aldo runs for a connector, or null if Aldo can't connect it. An
 * Aldo that predates Muse Code doesn't report it, and leaves its sign-in to
 * the thread's own sandbox.
 */
function aldoAccountMethod(connector: string): AuthConnectorMethodOption | null {
  if (!(connector in ALDO_ACCOUNT_SPECS)) return null;
  const reported = aldoReportsAccount(connector);
  if (reported === false || (reported === null && connector === "muse")) return null;
  return ALDO_ACCOUNT_SPECS[connector as AldoAccountKind].method;
}

let asking: Promise<unknown> | null = null;

/** aldoAccountMethod, asking Aldo which accounts it keeps if nothing has yet. */
export function useAldoAccountMethod(
  connector: string,
  enabled: boolean,
): AuthConnectorMethodOption | null {
  const [, setAnswered] = useState(false);
  const unknown =
    enabled && connector in ALDO_ACCOUNT_SPECS && aldoReportsAccount(connector) === null;
  useEffect(() => {
    if (!unknown) return;
    let cancelled = false;
    asking ??= fetchAldoAccounts().catch(() => {
      asking = null;
    });
    void asking.then(() => {
      if (!cancelled) setAnswered(true);
    });
    return () => {
      cancelled = true;
    };
  }, [unknown]);
  return enabled ? aldoAccountMethod(connector) : null;
}
