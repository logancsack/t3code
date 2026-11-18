import { AldoFrame } from "./AldoFrame";
// Aldo over whatever's on screen. ⌘I (Ctrl+I), or the dock's keyboard, opens a
// bar that knows which thread is open (screen.ts, which this keeps up with the
// route): things to say about it, what needs the user elsewhere (peeked at,
// and answered, right in the bar), and what's working. Typed words ask Aldo
// (↵), its answer showing under the bar as the same conversation as the home
// screen's; or go into the thread's own composer for its agent (⌘↵), to send
// from there; or jump to a thread whose title has them. With nothing typed,
// Space starts a call. On the home screen's conversation, ⌘I is its composer.
// A stalled turn's Ask Aldo (AldoStall.tsx) opens the bar with a question
// about its thread already typed.

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowUpRightIcon,
  FileDiffIcon,
  MailIcon,
  MessageCircleQuestionIcon,
  MessageSquareIcon,
  PencilLineIcon,
  SparklesIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";

import { useComposerThreadDraft, useComposerDraftStore } from "../composerDraftStore";
import { PullRequestGlyph } from "../components/pullRequest/pullRequestIcons";
import { Badge } from "../components/ui/badge";
import { DialogBackdrop, DialogPortal, DialogViewport } from "../components/ui/dialog";
import { Kbd } from "../components/ui/kbd";
import { useThreadShells } from "../state/entities";
import { cn } from "~/lib/utils";
import {
  AldoCaption,
  AldoConversation,
  AldoVoiceMark,
  useAldoAssistantAvailable,
} from "./AldoAssistant";
import { AldoOpenContext, pullRequestsOf, reposLabel } from "./AldoLiveCard";
import { mergeFollowedPullRequest } from "./AldoHomeBoard";
import { AldoPeek, type AldoPeekTarget } from "./AldoPeek";
import {
  aldoAssistantLive,
  connectAldo,
  loadAldoConversation,
  seedAldoComposer,
  sendText,
  useAldoAssistant,
} from "./assistantSession";
import { isAldoCloud, isAldoEnvironmentId } from "./api";
import { refreshAldoHome, useAldoHomeRead } from "./homeFeed";
import { aldoHomeShowsConversation, showAldoConversation } from "./simpleMode";
import { NEEDS_YOU_LABEL, needsYouKind } from "./home.logic";
import { setAldoRouteThread, useAldoOnScreen } from "./screen";
import {
  ALDO_SUMMON_LABEL,
  isSummonShortcut,
  moveSummonSelection,
  promptWith,
  summonRows,
  summonSections,
  type SummonRow,
  type SummonThread,
} from "./summon.logic";

/** `query`: words the bar opens with, as if typed. */
const useAldoSummon = create<{ readonly open: boolean; readonly query: string }>(() => ({
  open: false,
  query: "",
}));

export function openAldoSummon(): void {
  useAldoSummon.setState({ open: true });
}

/** Opens the bar with words already in it (a question about the thread on screen), to ask or edit. */
export function openAldoSummonWith(query: string): void {
  useAldoSummon.setState({ open: true, query });
}

function closeAldoSummon(): void {
  useAldoSummon.setState({ open: false, query: "" });
}

const NO_THREAD = scopeThreadRef("" as EnvironmentId, "" as ThreadId);

/** The thread the route shows, for what's on screen (with its title from the sidebar). */
function useRouteThread(): void {
  const params = useParams({ strict: false }) as { environmentId?: string; threadId?: string };
  const shells = useThreadShells();
  const { environmentId, threadId } = params;
  const title = shells.find((s) => s.environmentId === environmentId && s.id === threadId)?.title;
  useEffect(() => {
    setAldoRouteThread(
      environmentId && threadId && isAldoEnvironmentId(environmentId)
        ? { environmentId, threadId, title: title ?? "this thread" }
        : null,
    );
  }, [environmentId, threadId, title]);
}

export function AldoSummon() {
  const available = useAldoAssistantAvailable();
  const open = useAldoSummon((s) => s.open);
  const { pathname } = useLocation();
  useRouteThread();
  useEffect(() => {
    if (!isAldoCloud || !available) return;
    const onKey = (event: KeyboardEvent) => {
      if (!isSummonShortcut(event) || event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      // Aldo's own page has its composer right there.
      if (pathname === "/" && aldoHomeShowsConversation()) {
        seedAldoComposer("");
        return;
      }
      useAldoSummon.setState((s) => (s.open ? { open: false, query: "" } : { open: true }));
    };
    // Before the page's own keys (an editor's italic), so it works from a composer too.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [available, pathname]);
  // Leaving the page puts the bar away.
  useEffect(() => {
    closeAldoSummon();
  }, [pathname]);
  if (!isAldoCloud || !available) return null;
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => (next ? openAldoSummon() : closeAldoSummon())}
    >
      {open ? <SummonBar /> : null}
    </DialogPrimitive.Root>
  );
}

function SummonBar() {
  const navigate = useNavigate();
  const onScreen = useAldoOnScreen();
  const { home } = useAldoHomeRead();
  const shells = useThreadShells();
  const phase = useAldoAssistant((s) => s.phase);
  const replying = useAldoAssistant((s) => s.replying);
  const [query, setQuery] = useState(() => useAldoSummon.getState().query);
  /** Opened with words in it: the caret goes after them. */
  const seeded = useRef(query.length > 0);
  const [selected, setSelected] = useState(0);
  /** Where the conversation was when the bar first asked Aldo: what follows shows under it. */
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const [peek, setPeek] = useState<AldoPeekTarget | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const live = phase !== "idle" && phase !== "error";
  const threadRef = onScreen
    ? scopeThreadRef(onScreen.environmentId as EnvironmentId, onScreen.threadId as ThreadId)
    : null;
  const draft = useComposerThreadDraft(threadRef ?? NO_THREAD).prompt;

  useEffect(() => {
    void loadAldoConversation();
  }, []);

  const threads: ReadonlyArray<SummonThread> = useMemo(
    () =>
      shells
        .filter((s) => isAldoEnvironmentId(s.environmentId))
        .map((s) => ({
          environmentId: s.environmentId,
          threadId: s.id,
          title: s.title,
          updatedAt: s.updatedAt,
          archived: Boolean(s.archivedAt),
        })),
    [shells],
  );
  const sections = useMemo(
    () => summonSections({ query, onScreen, home, threads, now: Date.now() }),
    [query, onScreen, home, threads],
  );
  const rows = summonRows(sections);
  useEffect(() => setSelected(0), [query]);
  const answering = askedAt !== null && !query.trim() && !peek;

  const ask = (text: string) => {
    // Where the conversation is before the question goes in (an updater would read it after).
    const before = useAldoAssistant.getState().entries.length;
    setAskedAt((at) => at ?? before);
    setPeek(null);
    setQuery("");
    sendText(text);
    input.current?.focus();
  };
  const go = useCallback(
    (target: { environmentId: string; threadId: string }) => {
      closeAldoSummon();
      void navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: target.environmentId as EnvironmentId,
          threadId: target.threadId as ThreadId,
        },
      });
    },
    [navigate],
  );
  const writeToAgent = (text: string) => {
    if (!threadRef) return;
    useComposerDraftStore.getState().setPrompt(threadRef, promptWith(draft, text));
    closeAldoSummon();
    // Once the bar has let go of the focus: the composer, to read it over and send.
    window.setTimeout(
      () => document.querySelector<HTMLElement>('[data-testid="composer-editor"]')?.focus(),
      50,
    );
  };
  const activate = (row: SummonRow) => {
    switch (row.kind) {
      case "ask":
      case "say":
        ask(row.text);
        return;
      case "agent":
        writeToAgent(row.text);
        return;
      case "merge":
        void mergeFollowedPullRequest(row.pullRequest).then((merged) => {
          if (merged) void refreshAldoHome();
        });
        return;
      case "needs":
      case "working":
        setPeek({ kind: "thread", target: row.conversation.thread });
        return;
      case "approval":
        setPeek({ kind: "approval", id: row.approval.id });
        return;
      case "thread":
        go(row.thread);
        return;
    }
  };

  return (
    <DialogPortal>
      <DialogBackdrop />
      <DialogViewport className="grid-rows-[auto_1fr] p-2 pt-[10vh] max-sm:pt-2">
        <DialogPrimitive.Popup
          aria-label="Aldo"
          initialFocus={input}
          className="dialog-glass relative flex max-h-[80vh] w-full max-w-2xl min-w-0 flex-col overflow-hidden rounded-2xl border text-popover-foreground shadow-2xl outline-none transition-[scale,opacity] duration-150 data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0"
          data-aldo-summon=""
        >
          <div className="flex h-14 shrink-0 items-center gap-3 border-border/60 border-b ps-3.5 pe-3">
            <AldoVoiceMark size="sm" />
            <input
              ref={input}
              autoFocus
              value={query}
              aria-label="Ask Aldo"
              autoComplete="off"
              placeholder={
                askedAt !== null
                  ? "Ask a follow-up…"
                  : onScreen
                    ? "Ask Aldo about this thread, or anything…"
                    : "Ask Aldo, or jump to a thread…"
              }
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
              onChange={(event) => setQuery(event.target.value)}
              onFocus={(event) => {
                if (!seeded.current) return;
                seeded.current = false;
                const end = event.currentTarget.value.length;
                event.currentTarget.setSelectionRange(end, end);
              }}
              onKeyDown={(event) => {
                const next = moveSummonSelection(selected, rows.length, event.key);
                if (next !== null && !answering) {
                  event.preventDefault();
                  setSelected(next);
                  return;
                }
                if (event.key === " " && !query && !event.repeat) {
                  // Nothing typed: Space talks.
                  event.preventDefault();
                  if (!aldoAssistantLive()) void connectAldo();
                  return;
                }
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                if ((event.metaKey || event.ctrlKey) && query.trim() && onScreen) {
                  writeToAgent(query.trim());
                  return;
                }
                const row = rows[selected];
                if (row && !answering) activate(row);
              }}
            />
            {!query && !live ? (
              <span className="hidden shrink-0 items-center gap-1 text-muted-foreground text-xs sm:flex">
                <Kbd>Space</Kbd> to talk
              </span>
            ) : null}
            <Kbd className="shrink-0">Esc</Kbd>
          </div>
          {onScreen ? <OnScreenRow /> : null}
          {live ? (
            <div className="shrink-0 border-border/60 border-b px-4 py-2 empty:hidden">
              <AldoCaption />
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {peek && home ? (
              <AldoPeek
                peek={peek}
                home={home}
                now={Date.now()}
                onClose={() => setPeek(null)}
                onAsked={() => setPeek(null)}
              />
            ) : answering ? (
              <div className="flex flex-col gap-3 px-4 py-4" aria-live="polite">
                <AldoOpenContext.Provider value={go}>
                  <AldoConversation since={askedAt} />
                </AldoOpenContext.Provider>
              </div>
            ) : (
              <SummonList
                sections={sections}
                selected={rows[selected]?.key ?? null}
                onHover={(key) =>
                  setSelected(
                    Math.max(
                      0,
                      rows.findIndex((r) => r.key === key),
                    ),
                  )
                }
                onActivate={activate}
              />
            )}
          </div>
          <footer className="flex shrink-0 flex-wrap items-center gap-x-3.5 gap-y-1 border-border/60 border-t bg-muted/40 px-4 py-2 text-muted-foreground text-xs">
            <span className="flex items-center gap-1.5">
              <Kbd>↵</Kbd>
              {answering || replying ? "Follow up" : "Ask Aldo"}
            </span>
            {onScreen ? (
              <span className="flex items-center gap-1.5">
                <Kbd>{ALDO_SUMMON_LABEL.replace(/I$/, "↵")}</Kbd>
                Write to this thread's agent
              </span>
            ) : null}
            <button
              type="button"
              className="ms-auto flex items-center gap-1 hover:text-foreground"
              onClick={() => {
                closeAldoSummon();
                showAldoConversation();
                void navigate({ to: "/" });
              }}
            >
              Open Aldo
              <ArrowUpRightIcon className="size-3.5" />
            </button>
          </footer>
        </DialogPrimitive.Popup>
      </DialogViewport>
    </DialogPortal>
  );
}

/** What Aldo sees: the thread on screen, its repositories and its pull requests. */
function OnScreenRow() {
  const onScreen = useAldoOnScreen();
  const home = useAldoHomeRead().home;
  if (!onScreen) return null;
  const conversation = home?.conversations.find(
    (c) =>
      c.thread.environmentId === onScreen.environmentId && c.thread.threadId === onScreen.threadId,
  );
  const pullRequests = home ? pullRequestsOf(home, onScreen, Date.now()) : [];
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-border/60 border-b px-4 py-2">
      <span className="me-0.5 text-muted-foreground text-xs">On screen</span>
      <Badge variant="info" size="sm" className="max-w-80 truncate">
        {onScreen.title}
      </Badge>
      {conversation ? (
        <Badge variant="outline" size="sm">
          {reposLabel(conversation.repos)}
        </Badge>
      ) : null}
      {pullRequests.map((pr) => (
        <Badge key={`${pr.repo}#${pr.number}`} variant="outline" size="sm">
          #{pr.number}
        </Badge>
      ))}
    </div>
  );
}

function SummonList(props: {
  readonly sections: ReturnType<typeof summonSections>;
  readonly selected: string | null;
  readonly onHover: (key: string) => void;
  readonly onActivate: (row: SummonRow) => void;
}) {
  if (props.sections.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-muted-foreground text-sm">
        Ask Aldo anything, or tell it what to get done.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1 p-2" role="listbox" aria-label="Aldo">
      {props.sections.map((section) => (
        <div key={section.title ?? "typed"} className="flex flex-col">
          {section.title ? (
            <h3 className="px-2.5 pt-2 pb-1 font-medium text-muted-foreground text-xs">
              {section.title}
            </h3>
          ) : null}
          {section.rows.map((row) => (
            <button
              key={row.key}
              type="button"
              role="option"
              aria-selected={props.selected === row.key}
              className={cn(
                "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm",
                props.selected === row.key ? "bg-accent text-accent-foreground" : "",
              )}
              onMouseMove={() => props.onHover(row.key)}
              onClick={() => props.onActivate(row)}
            >
              <RowContent row={row} selected={props.selected === row.key} />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

const SAY_ICON = {
  progress: MessageCircleQuestionIcon,
  review: FileDiffIcon,
  opinion: SparklesIcon,
} as const;

function RowContent({ row, selected }: { readonly row: SummonRow; readonly selected: boolean }) {
  const icon = "size-4 shrink-0 text-muted-foreground";
  const hint = (text: string) => (
    <span className="ms-auto shrink-0 ps-2 text-muted-foreground text-xs">{text}</span>
  );
  switch (row.kind) {
    case "ask":
      return (
        <>
          <AldoFrame size={16} />
          <span className="min-w-0 truncate">
            Ask Aldo: <span className="font-medium">{row.text}</span>
          </span>
          {selected ? hint("↵") : null}
        </>
      );
    case "agent":
      return (
        <>
          <PencilLineIcon className={icon} />
          <span className="min-w-0 truncate">
            Write it to the agent in <span className="font-medium">{row.title}</span>
          </span>
          {hint(ALDO_SUMMON_LABEL.replace(/I$/, "↵"))}
        </>
      );
    case "say": {
      const Icon = SAY_ICON[row.icon];
      return (
        <>
          <Icon className={icon} />
          <span className="min-w-0 truncate">{row.label}</span>
          {selected ? hint("ask Aldo") : null}
        </>
      );
    }
    case "merge":
      return (
        <>
          <PullRequestGlyph.merged className={cn(icon, "text-success-foreground")} />
          <span className="min-w-0 truncate">
            Merge #{row.pullRequest.number} {row.pullRequest.title}
          </span>
          {hint("checks passed")}
        </>
      );
    case "approval":
      return (
        <>
          <MailIcon className={cn(icon, "text-warning-foreground")} />
          <span className="min-w-0 truncate">
            <span className="font-medium">{row.approval.title}</span>{" "}
            <span className="text-muted-foreground">{row.approval.summary}</span>
          </span>
          {hint("to approve")}
        </>
      );
    case "needs": {
      const c = row.conversation;
      const kind = needsYouKind(c);
      return (
        <>
          <span aria-hidden className="mx-1 size-2 shrink-0 rounded-full bg-warning" />
          <span className="min-w-0 truncate">
            <span className="font-medium">{c.title}</span>{" "}
            <span className="text-muted-foreground">{c.summary}</span>
          </span>
          {hint(kind ? NEEDS_YOU_LABEL[kind] : "waiting")}
        </>
      );
    }
    case "working":
      return (
        <>
          <span
            aria-hidden
            className="mx-1 size-2 shrink-0 animate-pulse rounded-full bg-primary"
          />
          <span className="min-w-0 truncate">
            <span className="font-medium">{row.conversation.title}</span>{" "}
            <span className="text-muted-foreground">{row.conversation.summary}</span>
          </span>
          {hint(reposLabel(row.conversation.repos))}
        </>
      );
    case "thread":
      return (
        <>
          <MessageSquareIcon className={icon} />
          <span className="min-w-0 truncate">{row.thread.title}</span>
          {selected ? hint("open") : null}
        </>
      );
  }
}
