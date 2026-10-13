// The agent's browser full screen, for what only the user can get past
// (AldoHandoffCard.tsx): the page, one sentence of what to do, and a large
// "I'm done" that hands it back. It opens from the card's "Do it now", the
// Browser panel's "Take over", or a notification's "Do it now", which opens
// the conversation with `?handoff=<id>`. Touch works as in the Browser panel,
// and so does "Teach this", which teaches the conversation that asked.

import { LoaderIcon, XIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { Button } from "../components/ui/button";
import { toastManager } from "../components/ui/toast";
import {
  answerAldoHandoff,
  closeAldoHandoffTakeover,
  openAldoHandoffTakeover,
  useAldoHandoffTakeover,
} from "./AldoHandoffCard";
import { aldoHandoffHow, aldoHandoffParam, aldoHandoffSkipLabel } from "./handoffs.logic";
import { useAldoHomeRead } from "./homeFeed";

const AldoBrowserPanel = lazy(() =>
  import("./AldoBrowserPanel").then((module) => ({ default: module.AldoBrowserPanel })),
);

/** Read before the router settles the address: the handoff a notification opened the page for. */
let fromNotification =
  typeof window === "undefined" ? null : aldoHandoffParam(window.location.search);

/** Mounted once: the takeover, when one is open. */
export function AldoHandoffTakeoverHost() {
  const id = useAldoHandoffTakeover((s) => s.id);
  useEffect(() => {
    if (!fromNotification) return;
    openAldoHandoffTakeover(fromNotification);
    fromNotification = null;
    // A reload doesn't open it again.
    const url = new URL(window.location.href);
    url.searchParams.delete("handoff");
    window.history.replaceState(window.history.state, "", url);
  }, []);
  return id ? <Takeover key={id} id={id} /> : null;
}

function Takeover({ id }: { readonly id: string }) {
  const { home, supported } = useAldoHomeRead();
  const handoff = home?.handoffs?.find((h) => h.id === id) ?? null;
  const [busy, setBusy] = useState<"done" | "skip" | null>(null);
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
          <p className="truncate text-warning text-xs">You have the browser · your agent waits</p>
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
            <p className="text-sm">{aldoHandoffHow(handoff)}</p>
            <Button
              type="button"
              size="xl"
              className="w-full font-semibold"
              disabled={busy !== null}
              onClick={() => void answer({ decision: "done" })}
            >
              {busy === "done" ? <LoaderIcon className="size-4 animate-spin" /> : null} I'm done
            </Button>
            <p className="text-center text-muted-foreground text-xs">
              Your agent waits until you hand it back ·{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground disabled:opacity-60"
                disabled={busy !== null}
                onClick={() => void answer({ decision: "skip" })}
              >
                {aldoHandoffSkipLabel(handoff)}
              </button>
            </p>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
