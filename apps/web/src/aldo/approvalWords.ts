// A thread's tool approvals in Aldo's words, the same as Aldo's own cards:
// one sentence of what the agent wants to do (the command itself behind
// Details), and Allow / Allow for this thread / Don't allow.

import type { ProviderApprovalOption } from "@t3tools/contracts";
import type { AldoApprovalExplain } from "./homeApi";

/** The stock labels Aldo says differently; a provider's own wording is left alone. */
const LABELS: Record<string, Record<string, string>> = {
  accept: { Approve: "Allow" },
  acceptForSession: { "Always allow this session": "Allow for this thread" },
  decline: { Decline: "Don't allow" },
};

/** A choice's label in Aldo's words (Home's cards say the same as the thread's). */
export function aldoApprovalLabel(decision: string, label: string): string {
  return LABELS[decision]?.[label] ?? label;
}

export function aldoApprovalOption(option: ProviderApprovalOption): ProviderApprovalOption {
  const label = LABELS[option.decision]?.[option.label];
  return label ? { ...option, label: label as ProviderApprovalOption["label"] } : option;
}

/** What needs approval, in plain words. */
export function aldoApprovalSentence(kind: string, appName: string | null | undefined): string {
  if (kind === "mcp-elicitation") return `Use ${appName || "this app"}?`;
  if (kind === "command") return "Run this command?";
  if (kind === "file-read") return "Read this file?";
  if (kind === "permission") return "Allow more access?";
  return "Change this file?";
}

/** The card's headline: direct plain question without third-person filler ("Run a command" -> "Run a command?"). */
export function approvalHeadline(what: string): string {
  const clean = what.trim().replace(/\.+$/, "");
  if (!clean) return "Allow this step?";
  return clean.endsWith("?") ? clean : `${clean}?`;
}

/** How serious a step is, in two or three words, said before what it does. */
export const SAFETY_LABEL: Record<AldoApprovalExplain["safety"]["level"], string> = {
  safe: "Safe to allow",
  changes: "Changes something",
  risky: "Be careful",
  unclear: "Not sure what it does",
};

/** The choice that is the answer Aldo recommends: T3's accept (or a variant of it), or its decline. */
export function recommendedOption<T extends { readonly decision: string }>(
  options: ReadonlyArray<T>,
  recommended: AldoApprovalExplain["recommended"],
): T | undefined {
  const yes = recommended === "accept";
  return (
    options.find((o) => o.decision === (yes ? "accept" : "decline")) ??
    options.find((o) => (yes ? o.decision.startsWith("accept") : o.decision === "cancel"))
  );
}
