// The conversation with Aldo, away from the home screen: Aldo opened a thread
// (or the user went to one) and the call carries on. A small bar shows what
// Aldo is saying, with typing, mute, hang up and the way back. Mounted once at
// the root, it also gives the conversation the router (so Aldo can open
// threads on the page) and listens for the shortcut that talks to Aldo from
// anywhere (ALDO_SHORTCUT_LABEL).

import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ArrowUpIcon, KeyboardIcon, MicIcon, MicOffIcon, PhoneOffIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { AldoOrb, useAldoAssistantAvailable } from "./AldoAssistant";
import {
  aldoAssistantLive,
  connectAldo,
  disconnectAldo,
  sendText,
  setAldoAssistantNavigator,
  setAldoMuted,
  useAldoAssistant,
} from "./assistantSession";
import { isAldoCloud } from "./cloud";

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
  // What Aldo last said, for the typing view (where the caption's place is the field).
  const lastSaid = useAldoAssistant((s) => {
    const last = s.entries.findLast((e) => e.kind === "message" && e.role === "assistant");
    return last?.kind === "message" ? last.text : "";
  });
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (typing) input.current?.focus();
  }, [typing]);

  const live = phase !== "idle" && phase !== "error";
  if (!isAldoCloud || !live || pathname === "/") return null;
  const send = () => {
    if (!text.trim()) return;
    sendText(text);
    setText("");
  };
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4">
      {typing && (said || lastSaid) ? (
        <p
          className="pointer-events-auto line-clamp-4 w-full max-w-md rounded-2xl border border-border/70 bg-popover/95 px-3.5 py-2 text-sm shadow-lg backdrop-blur"
          data-aldo-dock="bubble"
        >
          {said || lastSaid}
        </p>
      ) : null}
      <div
        className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-full border border-border/70 bg-popover/95 py-1.5 pr-1.5 pl-1.5 shadow-lg backdrop-blur"
        data-aldo-dock="capsule"
      >
        <AldoOrb size="sm" />
        {typing ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <Input
              ref={input}
              size="sm"
              className="min-w-0 flex-1"
              value={text}
              placeholder="Type to Aldo…"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setTyping(false);
              }}
            />
            <Button type="submit" size="icon-sm" aria-label="Send" disabled={!text.trim()}>
              <ArrowUpIcon />
            </Button>
          </form>
        ) : (
          <Link to="/" className="min-w-0 flex-1 truncate px-1 text-sm">
            {said ||
              (phase === "thinking" ? "Aldo is thinking…" : muted ? "Muted" : "Aldo is listening")}
          </Link>
        )}
        {typing ? null : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Type to Aldo"
            onClick={() => setTyping(true)}
          >
            <KeyboardIcon />
          </Button>
        )}
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
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Hang up"
          onClick={() => {
            setTyping(false);
            disconnectAldo();
          }}
        >
          <PhoneOffIcon />
        </Button>
      </div>
    </div>
  );
}
