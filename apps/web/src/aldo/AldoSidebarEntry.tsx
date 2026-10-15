// Aldo at the top of the sidebar, on every screen: a pill, so it reads as a
// control rather than the first thread of the list. Its orb starts a
// conversation (or hangs up) right where the user is, and the pill opens
// Aldo's own screen (the home screen's conversation). While a conversation is
// on, it shows what Aldo is doing or saying, with mute. Only where the server
// has the assistant.

import { Link } from "@tanstack/react-router";
import { MicIcon, MicOffIcon } from "lucide-react";

import { Button } from "../components/ui/button";
import { cn } from "~/lib/utils";
import { AldoOrb, ALDO_SHORTCUT_LABEL, useAldoAssistantAvailable } from "./AldoAssistant";
import type { AldoAssistantPhase } from "./assistant.logic";
import { setAldoMuted, useAldoAssistant } from "./assistantSession";
import { isAldoCloud } from "./cloud";

const STATUS: Record<AldoAssistantPhase, string> = {
  idle: `Talk or type · ${ALDO_SHORTCUT_LABEL}`,
  connecting: "Connecting…",
  listening: "Listening",
  hearing: "Listening",
  thinking: "Thinking…",
  speaking: "Speaking",
  error: "Tap to talk again",
};

export function AldoSidebarEntry() {
  const available = useAldoAssistantAvailable();
  const phase = useAldoAssistant((s) => s.phase);
  const said = useAldoAssistant((s) => s.said);
  const muted = useAldoAssistant((s) => s.muted);
  const micOn = useAldoAssistant((s) => s.micOn);
  const replying = useAldoAssistant((s) => s.replying);
  if (!isAldoCloud || !available) return null;
  const live = phase !== "idle" && phase !== "error";
  const status =
    live && muted
      ? "Muted"
      : phase === "speaking" && said
        ? said
        : replying
          ? "Thinking…"
          : STATUS[phase];
  return (
    <div
      className={cn(
        "mb-1.5 flex h-9 items-center gap-2 rounded-full border border-primary/35 bg-primary/10 ps-1 pe-1 text-sm transition-colors hover:bg-primary/15",
        live && "border-primary/60",
      )}
    >
      <AldoOrb size="xs" />
      <Link
        to="/"
        className="flex min-w-0 flex-1 items-center gap-2 pe-2 leading-tight"
        aria-label="Open Aldo"
      >
        <span className="font-semibold text-sidebar-foreground">Aldo</span>
        <span
          className={cn(
            "ms-auto min-w-0 truncate text-[11px] text-sidebar-muted-foreground",
            live && "text-sidebar-foreground/80",
          )}
        >
          {phase === "idle" && !replying ? ALDO_SHORTCUT_LABEL : status}
        </span>
      </Link>
      {live && micOn ? (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={muted ? "Unmute" : "Mute"}
          className="shrink-0 text-sidebar-muted-foreground hover:bg-sidebar-control-surface hover:text-sidebar-foreground"
          onClick={() => setAldoMuted(!muted)}
        >
          {muted ? <MicOffIcon /> : <MicIcon />}
        </Button>
      ) : null}
    </div>
  );
}
