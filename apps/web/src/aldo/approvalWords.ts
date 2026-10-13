// A thread's tool approvals in Aldo's words, the same as Aldo's own cards:
// one sentence of what the agent wants to do (the command itself behind
// Details), and Allow / Allow for this thread / Don't allow.

import type { ProviderApprovalOption } from "@t3tools/contracts";

/** The stock labels Aldo says differently; a provider's own wording is left alone. */
const LABELS: Record<string, Record<string, string>> = {
  accept: { Approve: "Allow" },
  acceptForSession: { "Always allow this session": "Allow for this thread" },
  decline: { Decline: "Don't allow" },
};

export function aldoApprovalOption(option: ProviderApprovalOption): ProviderApprovalOption {
  const label = LABELS[option.decision]?.[option.label];
  return label ? { ...option, label: label as ProviderApprovalOption["label"] } : option;
}

/** What the agent wants to do, in a sentence. */
export function aldoApprovalSentence(kind: string, appName: string | null | undefined): string {
  if (kind === "mcp-elicitation") return `Your agent wants to use ${appName || "an app"}.`;
  if (kind === "command") return "Your agent wants to run a command.";
  if (kind === "file-read") return "Your agent wants to read a file.";
  if (kind === "permission") return "Your agent wants more access.";
  return "Your agent wants to change a file.";
}
