// The conversation with Aldo, away from the home screen: Aldo opened a thread
// (or the user went to one) and the call carries on. A small bar shows what
// Aldo is saying, with mute, hang up and the way back. It also gives the
// conversation the router, so Aldo can open threads on the page.

import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { MicIcon, MicOffIcon, PhoneOffIcon } from "lucide-react";
import { useEffect } from "react";

import { Button } from "../components/ui/button";
import { AldoOrb } from "./AldoAssistant";
import {
  disconnectAldo,
  setAldoAssistantNavigator,
  setAldoMuted,
  useAldoAssistant,
} from "./assistantSession";
import { isAldoCloud } from "./cloud";

export function AldoAssistantDock() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const phase = useAldoAssistant((s) => s.phase);
  const said = useAldoAssistant((s) => s.said);
  const muted = useAldoAssistant((s) => s.muted);
  const micOn = useAldoAssistant((s) => s.micOn);

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

  if (!isAldoCloud || phase === "idle" || phase === "error" || pathname === "/") return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-md items-center gap-2 rounded-full border border-border/70 bg-popover/95 py-1.5 pr-1.5 pl-1.5 shadow-lg backdrop-blur">
        <AldoOrb size="sm" />
        <Link to="/" className="min-w-0 max-w-64 truncate px-1 text-sm">
          {said ||
            (phase === "thinking" ? "Aldo is thinking…" : muted ? "Muted" : "Aldo is listening")}
        </Link>
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
  );
}
