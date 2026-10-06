// Aldo at the top of the sidebar, on every screen: its orb starts a
// conversation (or hangs up) right where the user is, and the row opens Aldo's
// own screen (the home screen's conversation). While a conversation is on, it shows what Aldo is doing or
// saying, with mute. Only where the server has the assistant.

import { Link } from "@tanstack/react-router";
import { MicIcon, MicOffIcon } from "lucide-react";

import { Button } from "../components/ui/button";
import { cn } from "~/lib/utils";
import { AldoOrb, ALDO_SHORTCUT_LABEL, useAldoAssistantAvailable } from "./AldoAssistant";
import type { AldoAssistantPhase } from "./assistant.logic";
import { setAldoMuted, useAldoAssistant } from "./assistantSession";
import { isAldoCloud } from "./cloud";
import { setAldoHomeView } from "./homeFeed";

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
    <div className="flex h-10 items-center gap-2 rounded-md px-1.5 text-sm hover:bg-sidebar-row-hover">
      <AldoOrb size="xs" className="ml-0.5" />
      <Link
        to="/"
        className="flex min-w-0 flex-1 flex-col leading-tight"
        aria-label="Open Aldo"
        onClick={() => setAldoHomeView("aldo")}
      >
        <span className="font-medium text-sidebar-foreground">Aldo</span>
        <span
          className={cn(
            "truncate text-[11px] text-sidebar-muted-foreground",
            live && "text-sidebar-foreground/80",
          )}
        >
          {status}
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
