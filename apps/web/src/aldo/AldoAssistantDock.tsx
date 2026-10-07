// The conversation with Aldo, away from the home screen: Aldo opened a thread
// (or the user went to one) and the call carries on. A small bar shows what
// Aldo is saying, with typing (the summon bar), mute, hang up and the way
// back. Mounted once at the root, it also gives the conversation the router
// (so Aldo can open threads on the page), listens for the shortcut that
// talks to Aldo from anywhere (ALDO_SHORTCUT_LABEL), and shows the call
// screen: a call on a phone, and going through decisions with Aldo
// (AldoCallScreen.tsx); on a phone the bar brings the folded screen back.

import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { KeyboardIcon, MicIcon, MicOffIcon, PhoneOffIcon } from "lucide-react";
import { useEffect } from "react";

import { Button } from "../components/ui/button";
import { useIsMobile } from "../hooks/useMediaQuery";
import { AldoOrb, useAldoAssistantAvailable } from "./AldoAssistant";
import { AldoCallScreen } from "./AldoCallScreen";
import { showAldoCall, useAldoCallView } from "./callView";
import { openAldoSummon } from "./AldoSummon";
import {
  aldoAssistantLive,
  connectAldo,
  disconnectAldo,
  setAldoAssistantNavigator,
  setAldoMuted,
  useAldoAssistant,
} from "./assistantSession";
import { isAldoCloud } from "./cloud";
import { setAldoHomeView } from "./homeFeed";
import { stopAldoWalkthrough } from "./walkthrough";

/** Mod+Shift+A: talk to Aldo, or hang up. */
function isAldoShortcut(event: KeyboardEvent): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === "a"
  );
}

export function AldoAssistantDock() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const available = useAldoAssistantAvailable();
  const phase = useAldoAssistant((s) => s.phase);
  const said = useAldoAssistant((s) => s.said);
  const muted = useAldoAssistant((s) => s.muted);
  const micOn = useAldoAssistant((s) => s.micOn);
  const mobile = useIsMobile();
  const minimized = useAldoCallView((s) => s.minimized);
  const live = phase !== "idle" && phase !== "error";

  // Each call opens the call screen again; one that ends (or fails) ends going through decisions.
  useEffect(() => {
    if (phase === "connecting") showAldoCall();
    if (!live) stopAldoWalkthrough();
  }, [phase, live]);

  useEffect(() => {
    if (!isAldoCloud) return;
    setAldoAssistantNavigator((target) => {
      void navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: target.environmentId as EnvironmentId,
          threadId: target.threadId as ThreadId,
        },
      });
    });
    return () => setAldoAssistantNavigator(null);
  }, [navigate]);

  useEffect(() => {
    if (!isAldoCloud || !available) return;
    const onKey = (event: KeyboardEvent) => {
      if (!isAldoShortcut(event) || event.repeat) return;
      event.preventDefault();
      if (aldoAssistantLive()) disconnectAldo();
      else void connectAldo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [available]);

  if (!isAldoCloud || !live) return null;
  // On a phone the call screen covers the page until it's folded away.
  if (pathname === "/" || (mobile && !minimized)) return <AldoCallScreen />;
  return (
    <>
      <AldoCallScreen />
      <div className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4">
        <div
          className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-full border border-border/70 bg-popover/95 py-1.5 pr-1.5 pl-1.5 shadow-lg backdrop-blur"
          data-aldo-dock="capsule"
        >
          <AldoOrb size="sm" />
          {mobile ? (
            <button
              type="button"
              className="min-w-0 flex-1 truncate px-1 text-left text-sm"
              onClick={showAldoCall}
            >
              {said ||
                (phase === "thinking"
                  ? "Aldo is thinking…"
                  : muted
                    ? "Muted"
                    : "Aldo is listening")}
            </button>
          ) : (
            <Link
              to="/"
              className="min-w-0 flex-1 truncate px-1 text-sm"
              onClick={() => setAldoHomeView("aldo")}
            >
              {said ||
                (phase === "thinking"
                  ? "Aldo is thinking…"
                  : muted
                    ? "Muted"
                    : "Aldo is listening")}
            </Link>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Type to Aldo" onClick={openAldoSummon}>
            <KeyboardIcon />
          </Button>
          {micOn ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={muted ? "Unmute" : "Mute"}
              onClick={() => setAldoMuted(!muted)}
            >
              {muted ? <MicOffIcon /> : <MicIcon />}
            </Button>
          ) : null}
          <Button variant="ghost" size="icon-sm" aria-label="Hang up" onClick={disconnectAldo}>
            <PhoneOffIcon />
          </Button>
        </div>
      </div>
    </>
  );
}
