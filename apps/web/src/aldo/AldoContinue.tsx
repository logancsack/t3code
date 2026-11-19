// Carries on a thread that paused or stalled (threadCard.logic.ts stalledOf),
// from its card: the same as Aldo's continue_thread. Answers the tap at once;
// a thread paused mid-turn then shows as starting up, like an answered
// question (answered.logic.ts), without waiting for Aldo's next read. A plan
// that can't run agents sends to its fix instead, since carrying on would only
// stall again.

import { Link } from "@tanstack/react-router";
import { LoaderCircleIcon } from "lucide-react";
import { useRef, useState } from "react";

import { toastManager } from "../components/ui/toast";
import { cn } from "~/lib/utils";
import { sendAldoAnswer } from "./homeFeed";
import { continueAldoThread, type AldoHomeConversation } from "./homeApi";
import { type Stalled } from "./threadCard.logic";
import { PRIMARY } from "./surface";

const FULL = "w-full max-sm:h-auto max-sm:min-h-11";

export function ContinueButton(props: {
  readonly conversation: AldoHomeConversation;
  readonly blocked?: Stalled["blocked"];
  readonly className?: string;
}) {
  const sending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "busy" | "sent">("idle");
  const { blocked } = props;
  if (blocked)
    return (
      <Link to={blocked.href} className={cn(PRIMARY, FULL, props.className)}>
        {blocked.label}
      </Link>
    );
  return (
    <div className="flex w-full flex-col gap-2">
      {error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={phase !== "idle"}
        aria-busy={phase === "busy" || undefined}
        className={cn(PRIMARY, FULL, props.className)}
        onClick={() => {
          if (sending.current) return;
          sending.current = true;
          setPhase("busy");
          setError(null);
          sendAldoAnswer(props.conversation, () => continueAldoThread(props.conversation.thread), {
            afterAccepted: true,
          })
            .then(() => setPhase("sent"))
            .catch((cause: unknown) => {
              sending.current = false;
              setPhase("idle");
              setError(cause instanceof Error ? cause.message : "Try again.");
              // The hold is released on failure, so this card is remounted: say it where it stays.
              toastManager.add({
                type: "error",
                title: "Couldn't carry it on",
                description: cause instanceof Error ? cause.message : "Try again.",
              });
            });
        }}
      >
        {phase === "busy" ? (
          <>
            <LoaderCircleIcon aria-hidden className="size-4 animate-spin" />
            Continuing…
          </>
        ) : phase === "sent" ? (
          "Asked it to carry on"
        ) : (
          "Continue"
        )}
      </button>
    </div>
  );
}
