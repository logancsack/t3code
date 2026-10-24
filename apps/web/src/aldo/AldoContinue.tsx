// Carries on a thread that paused or stalled (threadCard.logic.ts stalledOf),
// from its card: the same as Aldo's continue_thread. Answers the tap at once;
// a thread paused mid-turn then shows as starting up, like an answered
// question (answered.logic.ts), without waiting for Aldo's next read. A plan
// that can't run agents sends to its fix instead, since carrying on would only
// stall again.

import { Link } from "@tanstack/react-router";
import { LoaderCircleIcon } from "lucide-react";
import { useState } from "react";

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
  const [phase, setPhase] = useState<"idle" | "busy" | "sent">("idle");
  const { blocked } = props;
  if (blocked)
    return (
      <Link to={blocked.href} className={cn(PRIMARY, FULL, props.className)}>
        {blocked.label}
      </Link>
    );
  return (
    <button
      type="button"
      disabled={phase !== "idle"}
      aria-busy={phase === "busy" || undefined}
      className={cn(PRIMARY, FULL, props.className)}
      onClick={() => {
        setPhase("busy");
        sendAldoAnswer(props.conversation, () => continueAldoThread(props.conversation.thread))
          .then(() => setPhase("sent"))
          .catch((cause: unknown) => {
            setPhase("idle");
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
  );
}
