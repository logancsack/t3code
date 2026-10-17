// The agent's browser full screen, for what only the user can get past
// (AldoHandoffCard.tsx): the page, one sentence of what to do, and a large
// "I'm done" that hands it back. It opens from the card's "Do it now", the
// Browser panel's "Take over", or a notification's "Do it now", which opens
// the conversation with `?handoff=<id>`. Touch works as in the Browser panel,
// and so does "Teach this", which teaches the conversation that asked: it's
// handed back only once a recording is taught or discarded.

import { useRouterState } from "@tanstack/react-router";
import { LoaderIcon, XIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { Button } from "../components/ui/button";
import { toastManager } from "../components/ui/toast";
import { cn } from "~/lib/utils";
import {
  answerAldoHandoff,
  closeAldoHandoffTakeover,
  openAldoHandoffTakeover,
  useAldoHandoffTakeover,
} from "./AldoHandoffCard";
import { aldoHandoffHow, aldoHandoffParam, aldoHandoffSkipLabel } from "./handoffs.logic";
import { useAldoHomeRead } from "./homeFeed";
import { PRIMARY } from "./surface";

const AldoBrowserPanel = lazy(() =>
  import("./AldoBrowserPanel").then((module) => ({ default: module.AldoBrowserPanel })),
);

/** Read before the router settles the address: the handoff a notification opened the page for. */
let fromNotification =
  typeof window === "undefined" ? null : aldoHandoffParam(window.location.search);

/** Mounted once: the takeover, when one is open. */
export function AldoHandoffTakeoverHost() {
  const id = useAldoHandoffTakeover((s) => s.id);
  const href = useRouterState({ select: (state) => state.location.href });
  useEffect(() => {
    const handoff =
      fromNotification ?? aldoHandoffParam(new URL(href, window.location.origin).search);
    if (!handoff) return;
    openAldoHandoffTakeover(handoff);
    fromNotification = null;
    // A reload doesn't open it again.
    const url = new URL(window.location.href);
    url.searchParams.delete("handoff");
    window.history.replaceState(window.history.state, "", url);
  }, [href]);
  return id ? <Takeover key={id} id={id} /> : null;
}

function Takeover({ id }: { readonly id: string }) {
  const { home, supported } = useAldoHomeRead();
  const handoff = home?.handoffs?.find((h) => h.id === id) ?? null;
  const [busy, setBusy] = useState<"done" | "skip" | null>(null);
  const [teaching, setTeaching] = useState(false);
  const answered = useRef(false);
  // Gone from the read: done on another device, skipped, or run out.
  const gone = supported === false || (home !== null && handoff === null);
  useEffect(() => {
    if (!gone || answered.current) return;
    closeAldoHandoffTakeover();
    if (supported !== false) {
      toastManager.add({ type: "info", title: "That no longer waits on you." });
    }
  }, [gone, supported]);

  const answer = async (next: { readonly decision: "done" | "skip" }) => {
    if (!handoff) return;
    setBusy(next.decision);
    answered.current = true;
    if (await answerAldoHandoff(handoff, next)) closeAldoHandoffTakeover();
    else {
      answered.current = false;
      setBusy(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Your agent's browser"
      className="fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      data-aldo-takeover=""
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close, without handing it back"
          onClick={closeAldoHandoffTakeover}
        >
          <XIcon className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-sm">
            {handoff?.threadTitle || "Your agent's browser"}
          </p>
          <p className="flex items-center gap-1.5 truncate text-[12px] text-muted-foreground leading-[18px]">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
            You have the browser · your agent waits
          </p>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        {handoff ? (
          <Suspense fallback={null}>
            <AldoBrowserPanel
              key={handoff.thread.environmentId}
              environmentId={handoff.thread.environmentId}
              threadId={handoff.thread.threadId}
              inTakeover
              onTeaching={setTeaching}
            />
          </Suspense>
        ) : (
          <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground text-sm">
            <LoaderIcon className="size-4 animate-spin" /> Opening your agent's browser…
          </div>
        )}
      </div>
      {handoff ? (
        <footer className="shrink-0 border-t border-border px-4 py-3">
          <div className="mx-auto flex w-full max-w-md flex-col gap-2">
            <p className="text-center text-[14px] leading-5">{aldoHandoffHow(handoff)}</p>
            <button
              type="button"
              className={cn(PRIMARY, "w-full")}
              aria-busy={busy === "done" || undefined}
              disabled={busy !== null || teaching}
              onClick={() => void answer({ decision: "done" })}
            >
              I'm done
              {busy === "done" ? <LoaderIcon aria-hidden className="size-4 animate-spin" /> : null}
            </button>
            {teaching ? (
              <p className="text-center text-muted-foreground text-xs">
                Finish the recording (teach it or discard it) to hand it back.
              </p>
            ) : (
              <p className="text-center text-muted-foreground text-xs">
                Your agent waits until you hand it back ·{" "}
                {/* A finger needs 44px; the line grows on touch screens only. */}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-foreground disabled:opacity-60 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
                  disabled={busy !== null}
                  onClick={() => void answer({ decision: "skip" })}
                >
                  {aldoHandoffSkipLabel(handoff)}
                </button>
              </p>
            )}
          </div>
        </footer>
      ) : null}
    </div>
  );
}
