import { memo, useState } from "react";
import { type PendingApproval } from "../../session-logic";
import { aldoApprovalSentence } from "~/aldo/approvalWords";
import { isAldoCloud } from "~/aldo/api";
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
  const Detail = approval.requestKind === "mcp-elicitation" ? "span" : "code";
  const fallbackLabel =
    approval.requestKind === "mcp-elicitation"
      ? "App access approval"
      : approval.requestKind === "command"
        ? "Command approval"
        : approval.requestKind === "file-read"
          ? "File read approval"
          : approval.requestKind === "permission"
            ? "App permission approval"
            : "File change approval";
  const detailAriaLabel =
    approval.requestKind === "mcp-elicitation"
      ? "App access request"
      : approval.requestKind === "command"
        ? "Command"
        : approval.requestKind === "file-read"
          ? "File to read"
          : approval.requestKind === "permission"
            ? "Permission request"
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
      className={cn("flex min-w-0 flex-1 flex-col items-start gap-1", className)}
      role="group"
    >
      <span className="flex w-full min-w-0 items-center gap-2 text-2xs text-muted-foreground">
        {sentence ? (
          <>
            <span className="shrink-0 text-xs text-foreground">{sentence}</span>
            {approval.detail ? (
              <button
                type="button"
                aria-expanded={detailsOpen}
                className="shrink-0 underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => setDetailsFor(detailsOpen ? null : approval.requestId)}
              >
                {detailsOpen ? "Hide" : "Details"}
              </button>
            ) : null}
          </>
        ) : (
          <>
            <span className="shrink-0 font-medium text-warning">{fallbackLabel}</span>
            {approval.appName ? <span className="min-w-0 truncate">{approval.appName}</span> : null}
          </>
        )}
        {pendingCount > 1 ? (
          <span className="ml-auto shrink-0 tabular-nums">1/{pendingCount}</span>
        ) : null}
      </span>
      {sentence && !detailsOpen ? null : (
        <Detail
          aria-label={detailAriaLabel}
          className={cn(
            "block max-h-20 w-full min-w-0 overflow-auto text-xs text-foreground [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 [&::-webkit-scrollbar]:h-1.5",
            approval.requestKind === "mcp-elicitation"
              ? "whitespace-pre-wrap font-sans wrap-break-word"
              : "whitespace-pre font-mono",
          )}
          data-approval-detail="complete"
          tabIndex={0}
        >
          {approval.detail || fallbackLabel}
        </Detail>
      )}
    </span>
  );
});
