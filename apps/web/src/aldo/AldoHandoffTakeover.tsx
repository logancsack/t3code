// The agent's browser full screen, for what only the user can get past
// (AldoHandoffCard.tsx): the page, what it is and what to do, and a large
// "I'm done" that hands it back. It opens from the card's "Take control", the
// Browser panel's "Take over", or the conversation with `?handoff=<id>`: a
// notification's "Do it now", or the card's "Do it on my phone" on a phone
// signed in to Aldo. There, a camera step the site offers to finish on a
// phone leads with the site's own page, where the phone's camera works.
// Touch works as in the Browser panel, and so does "Teach this", which
// teaches the conversation that asked: it's handed back only once a
// recording is taught or discarded.

import { useRouter, useRouterState } from "@tanstack/react-router";
import { ExternalLinkIcon, LoaderIcon, XIcon } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../components/ui/button";
import { toastManager } from "../components/ui/toast";
import { cn } from "~/lib/utils";
import {
  answerAldoHandoff,
  closeAldoHandoffTakeover,
  openAldoHandoffTakeover,
  useAldoHandoffTakeover,
  useAldoOnPhone,
} from "./AldoHandoffCard";
import {
  aldoHandoffHow,
  aldoHandoffParam,
  aldoHandoffSiteLabel,
  aldoHandoffSiteLink,
  aldoHandoffSkipLabel,
} from "./handoffs.logic";
import { useAldoHomeRead } from "./homeFeed";
import { PRIMARY, SECONDARY } from "./surface";

const AldoBrowserPanel = lazy(() =>
  import("./AldoBrowserPanel").then((module) => ({ default: module.AldoBrowserPanel })),
);

/** Read before the router settles the address: the handoff a notification opened the page for. */
let fromNotification =
  typeof window === "undefined" ? null : aldoHandoffParam(window.location.search);

/** Mounted once: the takeover, when one is open. */
export function AldoHandoffTakeoverHost() {
  const id = useAldoHandoffTakeover((s) => s.id);
  const router = useRouter();
  const href = useRouterState({ select: (state) => state.location.href });
  useEffect(() => {
    const handoff =
      fromNotification ?? aldoHandoffParam(new URL(href, window.location.origin).search);
    if (!handoff) return;
    openAldoHandoffTakeover(handoff);
    fromNotification = null;
  }, [href]);
  // The URL keeps `?handoff=` until Aldo has answered the takeover's read, so a
  // phone that has to sign in first comes back to the step (api.ts sends sign-in
  // back to this URL). Then it's cleared, so another tap of the same link is a
  // new navigation; and when the takeover closes before that.
  const clearParam = useCallback(() => {
    const url = new URL(router.state.location.href, window.location.origin);
    if (!url.searchParams.has("handoff")) return;
    url.searchParams.delete("handoff");
    void router.navigate({
      href: url.pathname + url.search + url.hash,
      replace: true,
      resetScroll: false,
    });
  }, [router]);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (shown.current && !id) clearParam();
    shown.current = id;
  }, [id, clearParam]);
  return id ? <Takeover key={id} id={id} onRead={clearParam} /> : null;
}

function Takeover({ id, onRead }: { readonly id: string; readonly onRead: () => void }) {
  const { home, supported } = useAldoHomeRead();
  useEffect(() => {
    if (home !== null || supported === false) onRead();
  }, [home, supported, onRead]);
  const handoff = home?.handoffs?.find((h) => h.id === id) ?? null;
  const [busy, setBusy] = useState<"done" | "skip" | null>(null);
  const [teaching, setTeaching] = useState(false);
  const answered = useRef(false);
  // On a phone, a camera step's own page (the site's link) is where its camera works.
  const onPhone = useAldoOnPhone();
  const siteLink = handoff && onPhone ? aldoHandoffSiteLink(handoff) : null;
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
            <div className="text-center text-[14px] leading-5">
              <p className="font-medium">{handoff.reason}</p>
              <p className="text-muted-foreground">{aldoHandoffHow(handoff)}</p>
            </div>
            {siteLink ? (
              <>
                <a
                  className={cn(PRIMARY, "w-full")}
                  href={siteLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {aldoHandoffSiteLabel(handoff)}
                  <ExternalLinkIcon aria-hidden className="size-4" />
                </a>
                <p className="text-center text-muted-foreground text-xs">
                  Your phone's camera works there. When you've finished, return here and hand it
                  back.
                </p>
              </>
            ) : null}
            <button
              type="button"
              className={cn(siteLink ? SECONDARY : PRIMARY, "w-full")}
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
