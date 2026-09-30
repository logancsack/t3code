// Aldo as the home screen: talk to it (the orb), or type. It shows what was
// said, what Aldo did (with a link to each thread), and what needs the user
// or is working now, read the way Aldo reads it (its overview) without waking
// a machine. The conversation itself lives in assistantSession.ts, so it
// carries on when Aldo opens a thread (the dock shows it there).

import { Link } from "@tanstack/react-router";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ArrowUpIcon, ArrowUpRightIcon, MicIcon, MicOffIcon, PhoneOffIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "../components/ui/button";
import { SidebarInset } from "../components/ui/sidebar";
import { Input } from "../components/ui/input";
import { cn } from "~/lib/utils";
import { useThreadShells } from "../state/entities";
import type { AldoAssistantPhase, AldoOpenTarget } from "./assistant.logic";
import {
  connectAldo,
  disconnectAldo,
  loadAldoConversation,
  sendText,
  setAldoMuted,
  useAldoAssistant,
  type AldoConversationEntry,
} from "./assistantSession";
import { aldoAssistant } from "./cloud";

const OVERVIEW_EVERY_MS = 20_000;

const PHASE_LABEL: Record<AldoAssistantPhase, string> = {
  idle: "Tap to talk to Aldo",
  connecting: "Connecting…",
  listening: "Listening",
  hearing: "Listening",
  thinking: "Thinking…",
  speaking: "Aldo",
  error: "Tap to talk again",
};

export function AldoAssistantHome(props: { readonly setup?: ReactNode }) {
  useEffect(() => {
    void loadAldoConversation();
  }, []);
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 pt-14 pb-4 sm:pt-8">
            {props.setup}
            <AldoAtAGlance />
            <AldoConversation />
          </div>
        </div>
        <div className="shrink-0 border-t border-border/60 bg-background/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <AldoCaption />
            <AldoTalkControls />
            <AldoComposer />
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

/** The orb: tap to talk or hang up; it swells with whoever is speaking. */
export function AldoOrb(props: { readonly size?: "lg" | "sm"; readonly className?: string }) {
  const phase = useAldoAssistant((s) => s.phase);
  const levels = useAldoAssistant((s) => s.levels);
  const live = phase !== "idle" && phase !== "error";
  const level =
    phase === "speaking"
      ? levels.aldo
      : phase === "hearing" || phase === "listening"
        ? levels.mic
        : 0;
  const scale = 1 + Math.min(1, level * 2.5) * 0.28;
  const large = props.size !== "sm";
  return (
    <button
      type="button"
      aria-label={live ? "End the conversation with Aldo" : "Talk to Aldo"}
      onClick={() => (live ? disconnectAldo() : void connectAldo())}
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
        large ? "size-20" : "size-9",
        props.className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-0 rounded-full bg-gradient-to-br from-primary/90 to-primary/50 shadow-lg shadow-primary/20 transition-transform duration-100 motion-reduce:transition-none",
          (phase === "thinking" || phase === "connecting") && "animate-pulse",
          !live && "opacity-80",
        )}
        style={{ transform: `scale(${scale})` }}
      />
      <span
        aria-hidden
        className={cn("absolute rounded-full bg-background/25", large ? "inset-5" : "inset-2")}
      />
      {live ? null : (
        <MicIcon className={cn("relative text-primary-foreground", large ? "size-7" : "size-4")} />
      )}
    </button>
  );
}

function AldoTalkControls() {
  const phase = useAldoAssistant((s) => s.phase);
  const micOn = useAldoAssistant((s) => s.micOn);
  const muted = useAldoAssistant((s) => s.muted);
  const live = phase !== "idle" && phase !== "error";
  return (
    <div className="flex items-center gap-4">
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label={muted ? "Unmute" : "Mute"}
        className={cn(!live || !micOn ? "invisible" : undefined)}
        onClick={() => setAldoMuted(!muted)}
      >
        {muted ? <MicOffIcon /> : <MicIcon />}
      </Button>
      <div className="flex flex-col items-center gap-1.5">
        <AldoOrb />
        <span className="text-muted-foreground text-xs">
          {muted && live ? "Muted" : PHASE_LABEL[phase]}
        </span>
      </div>
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="Hang up"
        className={cn(!live ? "invisible" : undefined)}
        onClick={disconnectAldo}
      >
        <PhoneOffIcon />
      </Button>
    </div>
  );
}

/** What Aldo is saying now; or what went wrong. */
function AldoCaption() {
  const said = useAldoAssistant((s) => s.said);
  const error = useAldoAssistant((s) => s.error);
  const phase = useAldoAssistant((s) => s.phase);
  if (error)
    return <p className="max-w-lg text-center text-destructive-foreground text-sm">{error}</p>;
  if (!said || phase === "idle") return null;
  return <p className="line-clamp-3 max-w-lg text-center text-foreground/90 text-sm">{said}</p>;
}

function AldoComposer() {
  const [text, setText] = useState("");
  const phase = useAldoAssistant((s) => s.phase);
  const unsent = useAldoAssistant((s) => s.unsent);
  const live = phase !== "idle" && phase !== "error";
  // What couldn't be sent comes back to be sent again.
  useEffect(() => {
    if (unsent === null) return;
    setText(unsent);
    useAldoAssistant.setState({ unsent: null });
  }, [unsent]);
  const submit = () => {
    if (!text.trim()) return;
    sendText(text);
    setText("");
  };
  return (
    <form
      className="flex w-full items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Input
        className="flex-1"
        value={text}
        placeholder={live ? "Or type to Aldo…" : "Type to Aldo, or tap the orb to talk"}
        onChange={(event) => setText(event.target.value)}
      />
      <Button type="submit" size="icon" aria-label="Send" disabled={!text.trim()}>
        <ArrowUpIcon />
      </Button>
    </form>
  );
}

function threadLink(target: AldoOpenTarget, children: ReactNode, className?: string) {
  return (
    <Link
      to="/$environmentId/$threadId"
      params={{
        environmentId: target.environmentId as EnvironmentId,
        threadId: target.threadId as ThreadId,
      }}
      className={className}
    >
      {children}
    </Link>
  );
}

function AldoConversation() {
  const entries = useAldoAssistant((s) => s.entries);
  const loaded = useAldoAssistant((s) => s.historyLoaded);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [entries.length]);
  if (loaded && entries.length === 0) {
    return (
      <div className="py-10 text-center">
        <h1 className="font-semibold text-2xl">What should we get done?</h1>
        <p className="mx-auto mt-2 max-w-md text-muted-foreground text-sm">
          Tell Aldo what you want, out loud or typed. It starts threads, briefs their agents,
          follows them, and tells you how it went. You never have to open a thread yourself.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {entries.map((entry, index) => (
        <ConversationEntry
          key={entry.kind === "action" ? entry.id : `${entry.at}-${index}`}
          entry={entry}
        />
      ))}
      <div ref={end} />
    </div>
  );
}

function ConversationEntry({ entry }: { readonly entry: AldoConversationEntry }) {
  if (entry.kind === "action") {
    const label = (
      <span
        className={cn(
          "inline-flex items-center gap-1.5",
          entry.failed && "text-destructive-foreground",
        )}
      >
        {entry.label}
        {entry.open ? <ArrowUpRightIcon className="size-3.5" /> : null}
      </span>
    );
    return (
      <div className="self-start rounded-full border border-border/60 bg-card/40 px-3 py-1 text-muted-foreground text-xs">
        {entry.open && entry.open.threadId
          ? threadLink(entry.open, label, "hover:text-foreground")
          : label}
      </div>
    );
  }
  return entry.role === "user" ? (
    <p className="max-w-[85%] self-end whitespace-pre-wrap rounded-2xl bg-muted/60 px-3.5 py-2 text-sm">
      {entry.text}
    </p>
  ) : (
    <p className="max-w-[85%] self-start whitespace-pre-wrap text-sm leading-relaxed">
      {entry.text}
    </p>
  );
}

type OverviewEntry = { ref: string; title: string; state: string; summary?: string };

/** The ref's thread on this page: its machine's environment, and the T3 thread its id prefix names. */
function useRefTarget(): (ref: string) => AldoOpenTarget | null {
  const shells = useThreadShells();
  return useMemo(
    () => (ref: string) => {
      const [machine, prefix = ""] = ref.split(":");
      const environmentId = `aldo-${machine}`;
      const match = shells
        .filter(
          (s) => s.environmentId === environmentId && s.id.startsWith(prefix) && !s.archivedAt,
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      return match ? { environmentId, threadId: match.id } : null;
    },
    [shells],
  );
}

/** What needs the user, and what's working, as Aldo sees it. */
function AldoAtAGlance() {
  const [overview, setOverview] = useState<{
    needsYou: OverviewEntry[];
    working: OverviewEntry[];
  } | null>(null);
  const target = useRefTarget();
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      const outcome = await aldoAssistant
        .runTool("overview", { limit: 20 }, null, [])
        .catch(() => null);
      const result = outcome?.result as
        | { needsYou?: OverviewEntry[]; conversations?: OverviewEntry[] }
        | undefined;
      if (stopped || !result) return;
      setOverview({
        needsYou: result.needsYou ?? [],
        working: (result.conversations ?? []).filter(
          (c) => c.state === "working" || c.state === "starting" || c.state === "queued",
        ),
      });
    };
    void load();
    const timer = setInterval(() => void load(), OVERVIEW_EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
  if (!overview || (overview.needsYou.length === 0 && overview.working.length === 0)) return null;
  const row = (entry: OverviewEntry, tone: "needs" | "working") => {
    const open = target(entry.ref);
    const body = (
      <>
        <span
          aria-hidden
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full",
            tone === "needs" ? "bg-warning" : "animate-pulse bg-primary",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-sm">{entry.title}</span>
          {entry.summary ? (
            <span className="line-clamp-2 text-muted-foreground text-xs">{entry.summary}</span>
          ) : null}
        </span>
      </>
    );
    const className = "flex items-start gap-2.5 rounded-lg px-2.5 py-2 hover:bg-accent/50";
    return (
      <li key={entry.ref}>
        {open ? threadLink(open, body, className) : <div className={className}>{body}</div>}
      </li>
    );
  };
  return (
    <section className="rounded-xl border border-border/60 bg-card/30 p-2">
      {overview.needsYou.length > 0 ? (
        <>
          <h2 className="px-2.5 pt-1 pb-0.5 font-medium text-muted-foreground text-xs">
            Needs you
          </h2>
          <ul>{overview.needsYou.map((e) => row(e, "needs"))}</ul>
        </>
      ) : null}
      {overview.working.length > 0 ? (
        <>
          <h2 className="px-2.5 pt-1 pb-0.5 font-medium text-muted-foreground text-xs">Working</h2>
          <ul>{overview.working.map((e) => row(e, "working"))}</ul>
        </>
      ) : null}
    </section>
  );
}
