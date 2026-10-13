import { memo, useState } from "react";
import { type PendingApproval } from "../../session-logic";
import { aldoApprovalSentence } from "~/aldo/approvalWords";
import { isAldoCloud } from "~/aldo/cloud";
import { cn } from "~/lib/utils";

interface ComposerPendingApprovalPanelProps {
  approval: PendingApproval;
  pendingCount: number;
  className?: string;
}

export const ComposerPendingApprovalPanel = memo(function ComposerPendingApprovalPanel({
  approval,
  pendingCount,
  className,
}: ComposerPendingApprovalPanelProps) {
  const fallbackLabel =
    approval.requestKind === "mcp-elicitation"
      ? "App access approval"
      : approval.requestKind === "command"
        ? "Command approval"
        : approval.requestKind === "file-read"
          ? "File read approval"
          : "File change approval";
  const detailAriaLabel =
    approval.requestKind === "mcp-elicitation"
      ? "App access request"
      : approval.requestKind === "command"
        ? "Command"
        : approval.requestKind === "file-read"
          ? "File to read"
          : "File change";
  // Aldo: a sentence of what the agent wants to do, with the command itself behind Details.
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  const detailsOpen = detailsFor === approval.requestId;
  const sentence = isAldoCloud
    ? aldoApprovalSentence(approval.requestKind, approval.appName)
    : null;

  return (
    <span
      aria-label={fallbackLabel}
      className={cn("flex min-w-0 flex-1 items-center gap-2", className)}
      role="group"
    >
      {sentence ? <span className="shrink-0 text-xs text-foreground">{sentence}</span> : null}
      {sentence && !detailsOpen && approval.detail ? (
        <button
          type="button"
          className="shrink-0 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => setDetailsFor(approval.requestId)}
        >
          Details
        </button>
      ) : null}
      {approval.appName && !sentence ? (
        <span className="max-w-32 shrink truncate text-[11px] font-medium text-foreground">
          {approval.appName}
        </span>
      ) : null}
      {sentence && !detailsOpen ? (
        <span className="min-w-0 flex-1" />
      ) : (
        <code
          aria-label={detailAriaLabel}
          className="block max-h-20 min-w-0 flex-1 overflow-auto whitespace-pre font-mono text-[11px] text-foreground/85 [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 [&::-webkit-scrollbar]:h-1.5"
          data-approval-detail="complete"
          tabIndex={0}
        >
          {approval.detail || fallbackLabel}
        </code>
      )}
      {pendingCount > 1 ? (
        <span className="shrink-0 text-[10px] font-medium text-muted-foreground tabular-nums">
          1/{pendingCount}
        </span>
      ) : null}
    </span>
  );
});
