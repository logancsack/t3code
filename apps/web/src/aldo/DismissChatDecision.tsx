import { useState } from "react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { toastManager } from "../components/ui/toast";
import { cn } from "~/lib/utils";
import { dismissAldoChatDecision, type AldoChatDecision } from "./homeApi";
import { type aldoHiddenFromChat } from "./decisions.logic";
import { refreshAldoHome, setAldoChatDecisionDismissed } from "./homeFeed";
import { FOCUS } from "./surface";

/** Separate from deciding: no receipt, answer or message is sent to the thread. */
export function DismissChatDecision(props: {
  readonly decision: AldoChatDecision | undefined;
  readonly title: string;
  readonly restore?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const decision = props.decision;
  // Older servers do not advertise dismissal support.
  if (!decision) return null;
  const dismiss = async () => {
    setBusy(true);
    try {
      await dismissAldoChatDecision(decision.id, !props.restore);
      setAldoChatDecisionDismissed(decision.id, !props.restore);
      await refreshAldoHome();
      const toast = toastManager.add({
        type: "info",
        title: props.restore ? "Shown in Aldo chat" : "Hidden from Aldo chat",
        description: "Still waiting in the thread. No answer was sent.",
        actionProps: {
          children: props.restore ? "Hide again" : "Undo",
          onClick: () => {
            toastManager.close(toast);
            void dismissAldoChatDecision(decision.id, Boolean(props.restore)).then(
              () => {
                setAldoChatDecisionDismissed(decision.id, Boolean(props.restore));
                return refreshAldoHome();
              },
              () => toastManager.add({ type: "error", title: "Couldn't show the prompt again" }),
            );
          },
        },
      });
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: props.restore ? "Couldn't show the prompt" : "Couldn't hide the prompt",
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={
              props.restore
                ? `Show ${props.title} in Aldo chat again`
                : `Not now: hide ${props.title} from Aldo chat`
            }
            disabled={busy}
            aria-busy={busy || undefined}
            className={cn(
              FOCUS,
              "shrink-0 whitespace-nowrap rounded-full px-3 py-2 text-[12px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-50",
            )}
            onClick={() => void dismiss()}
          />
        }
      >
        {busy ? (props.restore ? "Showing…" : "Hiding…") : props.restore ? "Show again" : "Not now"}
      </TooltipTrigger>
      <TooltipPopup>
        {props.restore ? "Show in Aldo chat again" : "Hide from Aldo chat without answering"}
      </TooltipPopup>
    </Tooltip>
  );
}

/** What the user hid from Aldo's conversation, a line each to show again (under Aldo's name, AldoPresence.tsx). */
export function AldoHiddenFromChat(props: {
  readonly items: ReturnType<typeof aldoHiddenFromChat>;
}) {
  if (props.items.length === 0) return null;
  return (
    <section className="flex flex-col gap-0.5">
      <h3 className="px-1.5 font-medium text-[12px] text-muted-foreground">
        Hidden from chat
        <span className="font-normal"> · still waiting in their threads</span>
      </h3>
      <ul className="flex flex-col">
        {props.items.map((item) => (
          <li key={item.chatDecision.id} className="flex items-center gap-2 ps-1.5">
            <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
            <DismissChatDecision decision={item.chatDecision} title={item.title} restore />
          </li>
        ))}
      </ul>
    </section>
  );
}
