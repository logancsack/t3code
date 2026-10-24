// Aldo’s sidebar entry opens Home; its mark starts or ends a voice call.

import { Link, useRouterState } from "@tanstack/react-router";
import { MicIcon, MicOffIcon } from "lucide-react";

import { Button } from "../components/ui/button";
import { useSidebar } from "../components/ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "~/lib/utils";
import { ALDO_SHORTCUT_LABEL, useAldoAssistantAvailable } from "./AldoAssistant";
import { AldoFrame } from "./AldoFrame";
import type { AldoAssistantPhase } from "./assistant.logic";
import { connectAldo, disconnectAldo, setAldoMuted, useAldoAssistant } from "./assistantSession";
import { voicePresenceState } from "./presence.logic";
import { isAldoCloud } from "./api";

const STATUS: Record<AldoAssistantPhase, string> = {
  idle: "Your assistant",
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
  const { isMobile } = useSidebar();
  const onAldo = useRouterState({ select: (state) => state.location.pathname === "/" });
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
        "mb-1 flex h-12 items-center gap-2.5 rounded-md bg-primary/[0.05] px-2.5 text-sm ring-1 ring-primary/10 ring-inset transition-colors hover:bg-primary/[0.09]",
        onAldo && "bg-primary/[0.09] ring-primary/20",
      )}
    >
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
          <AldoFrame size={24} state={replying ? "thinking" : voicePresenceState(phase)} />
        </TooltipTrigger>
        <TooltipPopup side="right">
          {live ? "Hang up" : `Talk to Aldo (${ALDO_SHORTCUT_LABEL})`}
        </TooltipPopup>
      </Tooltip>
      <Link
        to="/"
        className="flex min-w-0 flex-1 flex-col leading-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Open Aldo"
        aria-current={onAldo ? "page" : undefined}
      >
        <span className="flex items-baseline gap-2">
          <span className="font-semibold text-sidebar-foreground">Aldo</span>
          {isMobile || live ? null : (
            <span className="ms-auto text-[11px] text-sidebar-muted-foreground">
              {ALDO_SHORTCUT_LABEL}
            </span>
          )}
        </span>
        <span
          className={cn(
            "mt-0.5 min-w-0 truncate text-xs text-secondary-label",
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
