// Aldo at the top of the sidebar, on every screen: a row with its halo, which
// sets it apart from the threads below. The halo starts a conversation (or
// hangs up) right where the user is, and the row opens Aldo's own screen (the
// home screen's conversation). While a conversation is on, it shows what Aldo
// is doing or saying, with mute. Only where the server has the assistant.

import { Link } from "@tanstack/react-router";
import { MicIcon, MicOffIcon } from "lucide-react";

import { Button } from "../components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "~/lib/utils";
import { ALDO_SHORTCUT_LABEL, useAldoAssistantAvailable } from "./AldoAssistant";
import { AldoHalo } from "./AldoHalo";
import type { AldoAssistantPhase } from "./assistant.logic";
import { connectAldo, disconnectAldo, setAldoMuted, useAldoAssistant } from "./assistantSession";
import { phaseMood } from "./presence.logic";
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
    <div className="mb-1 flex h-9 items-center gap-1.5 rounded-lg ps-1 pe-1 text-sm transition-colors hover:bg-sidebar-row-hover">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={live ? "End the conversation with Aldo" : "Talk to Aldo"}
              className="flex size-7 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => (live ? disconnectAldo() : void connectAldo())}
            />
          }
        >
          <AldoHalo size={20} mood={replying ? "thinking" : phaseMood(phase)} />
        </TooltipTrigger>
        <TooltipPopup side="right">
          {live ? "Hang up" : `Talk to Aldo (${ALDO_SHORTCUT_LABEL})`}
        </TooltipPopup>
      </Tooltip>
      <Link
        to="/"
        className="flex min-w-0 flex-1 items-center gap-2 pe-2 leading-tight"
        aria-label="Open Aldo"
      >
        <span className="font-semibold text-sidebar-foreground">Aldo</span>
        <span
          className={cn(
            "ms-auto min-w-0 truncate text-[12px] text-sidebar-muted-foreground",
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
