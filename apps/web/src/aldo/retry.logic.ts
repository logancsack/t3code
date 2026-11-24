// After the user reconnects a provider whose sign-in expired mid-turn, the turn it cut short runs
// again: a stopped turn resumes where it was, a failed one gets its message sent again.

import type { ChatAttachment, OrchestrationV2RunStatus, ServerProvider } from "@t3tools/contracts";

export type AldoReconnectRetry =
  | { readonly kind: "resume" }
  | {
      readonly kind: "resend";
      readonly text: string;
      /** What the message carried, as the thread keeps it: sent again by reference, not uploaded again. */
      readonly attachments: ReadonlyArray<ChatAttachment>;
    }
  | null;

export function aldoRetryAfterReconnect(input: {
  /** The provider's status as the banner showed it, before the reconnect. */
  readonly provider: Pick<ServerProvider, "auth"> | null;
  readonly latestRunStatus: OrchestrationV2RunStatus | null;
  readonly canResume: boolean;
  /** The message the latest run answered. */
  readonly userMessage: {
    readonly text: string;
    readonly attachments: ReadonlyArray<ChatAttachment>;
  } | null;
}): AldoReconnectRetry {
  if (input.provider?.auth.status !== "unauthenticated") return null;
  if (input.latestRunStatus === "interrupted" && input.canResume) return { kind: "resume" };
  if (input.latestRunStatus !== "failed" && input.latestRunStatus !== "interrupted") return null;
  const message = input.userMessage;
  if (message === null || (!message.text.trim() && message.attachments.length === 0)) return null;
  return { kind: "resend", text: message.text, attachments: message.attachments };
}
