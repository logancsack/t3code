// Aldo's sidebar, in place of T3's thread list (AppSidebarLayout.tsx): Aldo at
// the top (its home, and the orb to talk), then every thread grouped by what
// it needs from the user rather than by project: waiting on you (and the
// approvals that aren't a thread's), working, landing, unread, then folded,
// earlier, snoozed and what's scheduled (sidebar.logic.ts). Hovering a row (or
// Space on it) peeks at the thread, answered in place; its menu (a right-click,
// a tap and hold, or its "…") is T3's own thread menu, and ⌘1–9 and
// previous/next move through the rows as they show. At the foot: which
// projects it shows, the month's credits, and the user, whose picture opens
// their account (AldoAccountDialog.tsx). The classic sidebar is one switch
// away there.

import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Link, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import {
  CalendarPlusIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  ClipboardListIcon,
  EllipsisIcon,
  FolderIcon,
  GitMergeIcon,
  MailIcon,
  MessageCircleQuestionIcon,
  MicIcon,
  MicOffIcon,
  PencilLineIcon,
  PinIcon,
  RepeatIcon,
  SearchIcon,
  ShieldQuestionIcon,
  SparklesIcon,
  SquarePenIcon,
  BellIcon,
  XIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { openCommandPalette } from "../commandPaletteBus";
import { composerDraftHasUserContent, DraftId, useComposerDraftStore } from "../composerDraftStore";
import { resolveRenameCommit } from "../components/chat/ChatHeader";
import { SidebarChromeHeader } from "../components/sidebar/SidebarChrome";
import { snoozeWakeDescription } from "../components/Sidebar.snooze";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../components/ui/menu";
import { Popover, PopoverPopup } from "../components/ui/popover";
import { SidebarContent, useSidebar } from "../components/ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { toastManager } from "../components/ui/toast";
import { isElectron } from "../env";
import { useClientSettings } from "../hooks/useSettings";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useThreadActionMenu } from "../hooks/useThreadActionMenu";
import {
  resolveShortcutCommand,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../keybindings";
import { startNewThreadFromContext } from "../lib/chatThreadActions";
import { isTerminalFocused } from "../lib/terminalFocus";
import { selectProjectGroupingSettings } from "../logicalProject";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { useProjects, useThreadShells } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { environmentServerConfigsAtom, primaryServerKeybindingsAtom } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadRouteParams } from "../threadRoutes";
import { useUiStateStore } from "../uiStateStore";
import { cn } from "~/lib/utils";
import { AldoProfileButton } from "./AldoAccountDialog";
import { AldoOrb, useAldoAssistantAvailable } from "./AldoAssistant";
import { mergeFollowedPullRequest } from "./AldoHomeBoard";
import { AldoPeek, type AldoPeekTarget } from "./AldoPeek";
import { setAldoMuted, useAldoAssistant } from "./assistantSession";
import { isAldoEnvironmentId, type AldoApproval, type AldoHomeUsage } from "./cloud";
import { refreshAldoHome, setAldoHomeView, useAldoHomeRead } from "./homeFeed";
import { elapsed, relativeTime } from "./home.logic";
import {
  aldoSidebarList,
  aldoSidebarOrder,
  repoLabel,
  searchAldoSidebar,
  type AldoScheduledItem,
  type AldoSidebarKind,
  type AldoSidebarRow,
} from "./sidebar.logic";
import { ALDO_SUMMON_LABEL } from "./summon.logic";

/** Earlier threads shown at a time, when that group is open. */
const EARLIER_PAGE = 10;
/** How long the pointer rests on a row before it peeks, and lingers after leaving. */
const PEEK_OPEN_MS = 450;
const PEEK_CLOSE_MS = 220;
/** How long a finger rests on a row before its menu opens, and how far it may drift meanwhile. */
const HOLD_MS = 500;
const HOLD_SLOP_PX = 10;
const TICK_MS = 30_000;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

type Peek = { readonly key: string; readonly target: AldoPeekTarget; readonly anchor: HTMLElement };
type Point = { readonly x: number; readonly y: number };
/** A row's menu to open, and where; `id` tells one opening from the next. */
type MenuRequest = { readonly row: AldoSidebarRow; readonly at: Point; readonly id: number };

export function AldoSidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const params = useParams({ strict: false }) as { environmentId?: string; threadId?: string };
  const { isMobile, setOpenMobile } = useSidebar();
  const shells = useThreadShells();
  const projects = useProjects();
  const { home } = useAldoHomeRead();
  const lastVisited = useUiStateStore((s) => s.threadLastVisitedAtById);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const newThreadContext = useHandleNewThread();
  const now = useNow();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<string | null>(null);
  const [earlierShown, setEarlierShown] = useState(0);
  const [snoozedOpen, setSnoozedOpen] = useState(false);
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const [peek, setPeek] = useState<Peek | null>(null);
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const timers = useRef<{ open?: number; close?: number }>({});

  const groups = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects,
        settings: groupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: () => null,
      }),
    [groupingSettings, primaryEnvironmentId, projects],
  );
  const groupByProject = useMemo(() => {
    const map = new Map<string, (typeof groups)[number]>();
    for (const group of groups)
      for (const ref of group.memberProjectRefs)
        map.set(`${ref.environmentId}:${ref.projectId}`, group);
    return map;
  }, [groups]);
  const groupOf = useCallback(
    (shell: EnvironmentThreadShell) =>
      groupByProject.get(`${shell.environmentId}:${shell.projectId}`),
    [groupByProject],
  );
  const scopeGroup = scope === null ? null : (groups.find((g) => g.projectKey === scope) ?? null);
  useEffect(() => {
    if (scope !== null && scopeGroup === null) setScope(null);
  }, [scope, scopeGroup]);

  const list = useMemo(
    () =>
      aldoSidebarList({
        shells: shells.filter((shell) => isAldoEnvironmentId(shell.environmentId)),
        home,
        lastVisitedAt: (key) => lastVisited[key],
        repoOf: (shell) => repoLabel(groupOf(shell)?.displayName),
        ...(scope === null ? {} : { inScope: (shell) => groupOf(shell)?.projectKey === scope }),
        supports: (shell) => {
          const capabilities = serverConfigs.get(shell.environmentId)?.environment.capabilities;
          return {
            settlement: capabilities?.threadSettlement === true,
            snooze: capabilities?.threadSnooze === true,
          };
        },
        now: new Date(now).toISOString(),
      }),
    [groupOf, home, lastVisited, now, scope, serverConfigs, shells],
  );
  const results = useMemo(() => searchAldoSidebar(list, query), [list, query]);
  const order = useMemo(
    () =>
      query.trim()
        ? results.map((row) => row.key)
        : aldoSidebarOrder(list, { earlier: earlierShown, snoozed: snoozedOpen }),
    [earlierShown, list, query, results, snoozedOpen],
  );
  const rowByKey = useMemo(() => {
    const map = new Map<string, AldoSidebarRow>();
    for (const row of [
      ...list.pinned,
      ...list.waiting,
      ...list.working,
      ...list.landing,
      ...list.unread,
      ...list.earlier,
      ...list.snoozed,
    ])
      map.set(row.key, row);
    return map;
  }, [list]);
  const routeKey =
    params.environmentId && params.threadId ? `${params.environmentId}:${params.threadId}` : null;

  const openThread = useCallback(
    (shell: { readonly environmentId: string; readonly id: string }) => {
      if (isMobile) setOpenMobile(false);
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(
          scopeThreadRef(shell.environmentId as EnvironmentId, shell.id as ThreadId),
        ),
      });
    },
    [isMobile, navigate, setOpenMobile],
  );

  // On a phone, the drawer closes whenever the page changes: the thread menu's
  // project settings, new thread on its branch, or archiving the open thread.
  const shownPath = useRef(pathname);
  useEffect(() => {
    if (shownPath.current === pathname) return;
    shownPath.current = pathname;
    if (isMobile) setOpenMobile(false);
  }, [isMobile, pathname, setOpenMobile]);

  // ⌘1–9 and previous/next move through the rows as they show.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const command = resolveShortcutCommand(event, keybindings, {
        platform: navigator.platform,
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: false,
          modelPickerOpen: isModelPickerOpen(),
        },
      });
      const go = (key: string | null | undefined) => {
        const row = key ? rowByKey.get(key) : undefined;
        if (!row) return;
        event.preventDefault();
        event.stopPropagation();
        openThread(row.shell);
      };
      const direction = threadTraversalDirectionFromCommand(command);
      if (direction !== null) {
        const index = routeKey ? order.indexOf(routeKey) : -1;
        go(
          direction === "next"
            ? order[index + 1]
            : index === -1
              ? order.at(-1)
              : index > 0
                ? order[index - 1]
                : null,
        );
        return;
      }
      const jump = threadJumpIndexFromCommand(command ?? "");
      if (jump !== null) go(order[jump]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keybindings, openThread, order, routeKey, rowByKey]);

  // Peeking: resting on a row opens it, and the peek stays while the pointer is in it.
  const clearTimers = () => {
    window.clearTimeout(timers.current.open);
    window.clearTimeout(timers.current.close);
  };
  useEffect(() => clearTimers, []);
  const hover = (key: string, target: AldoPeekTarget, anchor: HTMLElement) => {
    if (isMobile) return;
    clearTimers();
    timers.current.open = window.setTimeout(() => setPeek({ key, target, anchor }), PEEK_OPEN_MS);
  };
  const leave = () => {
    clearTimers();
    timers.current.close = window.setTimeout(() => setPeek(null), PEEK_CLOSE_MS);
  };
  const togglePeek = (key: string, target: AldoPeekTarget, anchor: HTMLElement) => {
    clearTimers();
    setPeek((current) => (current?.key === key ? null : { key, target, anchor }));
  };

  const projectCount = groups.length;
  const newThread = () => {
    if (isMobile) setOpenMobile(false);
    if (projectCount <= 1) {
      void startNewThreadFromContext({
        activeDraftThread: newThreadContext.activeDraftThread,
        activeThread: newThreadContext.activeThread ?? undefined,
        defaultProjectRef: newThreadContext.defaultProjectRef,
        handleNewThread: newThreadContext.handleNewThread,
      });
      return;
    }
    openCommandPalette({ open: "new-thread-in" });
  };

  const rowProps = (row: AldoSidebarRow) => ({
    row,
    now,
    active: row.key === routeKey,
    peeking: peek?.key === row.key,
    onOpen: () => openThread(row.shell),
    onHover: (anchor: HTMLElement) =>
      hover(
        row.key,
        {
          kind: "thread",
          target: { environmentId: row.shell.environmentId, threadId: row.shell.id },
        },
        anchor,
      ),
    onLeave: leave,
    onPeek: (anchor: HTMLElement) =>
      togglePeek(
        row.key,
        {
          kind: "thread",
          target: { environmentId: row.shell.environmentId, threadId: row.shell.id },
        },
        anchor,
      ),
    onMenu: (at: Point) => {
      clearTimers();
      setPeek(null);
      setMenu((current) => ({ row, at, id: (current?.id ?? 0) + 1 }));
    },
    renaming: renaming === row.key,
    onRenamed: () => setRenaming(null),
  });

  const searching = query.trim().length > 0;
  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="gap-0 px-2 pb-2"
        data-aldo-sidebar=""
        fixedHeader={
          <div className="flex flex-col gap-1.5 px-2 pb-1">
            <AldoRow
              active={pathname === "/"}
              onNavigate={() => isMobile && setOpenMobile(false)}
            />
            <div className="flex items-center gap-1">
              <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-sm text-sidebar-muted-foreground focus-within:bg-sidebar-row-active focus-within:ring-1 focus-within:ring-border hover:bg-sidebar-row-hover">
                <SearchIcon className="size-3.5 shrink-0" />
                <input
                  value={query}
                  aria-label="Search threads"
                  placeholder="Search threads"
                  autoComplete="off"
                  className="min-w-0 flex-1 bg-transparent text-sidebar-foreground outline-none placeholder:text-sidebar-muted-foreground"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setQuery("");
                    if (event.key === "Enter" && results[0]) {
                      openThread(results[0].shell);
                      setQuery("");
                    }
                  }}
                />
                {query ? (
                  <button type="button" aria-label="Clear the search" onClick={() => setQuery("")}>
                    <XIcon className="size-3.5" />
                  </button>
                ) : null}
              </label>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label="New thread"
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                      onClick={newThread}
                    />
                  }
                >
                  <SquarePenIcon className="size-4" />
                </TooltipTrigger>
                <TooltipPopup side="bottom">New thread</TooltipPopup>
              </Tooltip>
            </div>
          </div>
        }
      >
        {searching ? (
          <Group title={results.length > 0 ? "Threads" : "No threads match"}>
            {results.map((row) => (
              <ThreadRow key={row.key} {...rowProps(row)} />
            ))}
          </Group>
        ) : (
          <>
            <DraftGroup
              repoOf={(environmentId, projectId) =>
                repoLabel(groupByProject.get(`${environmentId}:${projectId}`)?.displayName)
              }
              onOpen={(draftId) => {
                if (isMobile) setOpenMobile(false);
                void navigate({
                  to: "/draft/$draftId",
                  params: { draftId: DraftId.make(draftId) },
                });
              }}
            />
            {list.pinned.length > 0 ? (
              <Group title="Pinned" icon={<PinIcon className="size-3" />}>
                {list.pinned.map((row) => (
                  <ThreadRow key={row.key} {...rowProps(row)} />
                ))}
              </Group>
            ) : null}
            {list.approvals.length + list.waiting.length > 0 ? (
              <Group
                title="Waiting on you"
                count={list.approvals.length + list.waiting.length}
                tone="amber"
              >
                {list.approvals.map((approval) => (
                  <ApprovalRow
                    key={approval.id}
                    approval={approval}
                    now={now}
                    peeking={peek?.key === `approval:${approval.id}`}
                    onHover={(anchor) =>
                      hover(
                        `approval:${approval.id}`,
                        { kind: "approval", id: approval.id },
                        anchor,
                      )
                    }
                    onLeave={leave}
                    onPeek={(anchor) =>
                      togglePeek(
                        `approval:${approval.id}`,
                        { kind: "approval", id: approval.id },
                        anchor,
                      )
                    }
                  />
                ))}
                {list.waiting.map((row) => (
                  <ThreadRow key={row.key} {...rowProps(row)} />
                ))}
              </Group>
            ) : null}
            {list.working.length > 0 ? (
              <Group title="Working" count={list.working.length}>
                {list.working.map((row) => (
                  <ThreadRow key={row.key} {...rowProps(row)} />
                ))}
              </Group>
            ) : null}
            {list.landing.length > 0 ? (
              <Group title="Landing" count={list.landing.length}>
                {list.landing.map((row) => (
                  <ThreadRow key={row.key} {...rowProps(row)} />
                ))}
              </Group>
            ) : null}
            {list.unread.length > 0 ? (
              <Group title="Unread" count={list.unread.length} tone="green">
                {list.unread.map((row) => (
                  <ThreadRow key={row.key} {...rowProps(row)} />
                ))}
              </Group>
            ) : null}
            {list.earlier.length > 0 ? (
              <Group
                title="Earlier"
                count={list.earlier.length}
                open={earlierShown > 0}
                onToggle={() => setEarlierShown((shown) => (shown > 0 ? 0 : EARLIER_PAGE))}
              >
                {list.earlier.slice(0, earlierShown).map((row) => (
                  <ThreadRow key={row.key} {...rowProps(row)} />
                ))}
                {earlierShown > 0 && list.earlier.length > earlierShown ? (
                  <button
                    type="button"
                    className="mx-2 my-1 self-start text-sidebar-muted-foreground text-xs hover:text-sidebar-foreground"
                    onClick={() => setEarlierShown((shown) => shown + 25)}
                  >
                    Show {Math.min(25, list.earlier.length - earlierShown)} more
                  </button>
                ) : null}
              </Group>
            ) : null}
            {list.snoozed.length > 0 ? (
              <Group
                title="Snoozed"
                count={list.snoozed.length}
                open={snoozedOpen}
                onToggle={() => setSnoozedOpen((v) => !v)}
              >
                {snoozedOpen
                  ? list.snoozed.map((row) => <ThreadRow key={row.key} {...rowProps(row)} />)
                  : null}
              </Group>
            ) : null}
            {list.scheduled.length > 0 ? (
              <Group
                title="Scheduled"
                count={list.scheduled.length}
                open={scheduledOpen}
                onToggle={() => setScheduledOpen((v) => !v)}
              >
                {scheduledOpen
                  ? list.scheduled.map((item) => (
                      <ScheduledRow
                        key={item.key}
                        item={item}
                        now={now}
                        onOpen={(target) =>
                          target
                            ? openThread({
                                environmentId: target.environmentId,
                                id: target.threadId,
                              })
                            : undefined
                        }
                      />
                    ))
                  : null}
              </Group>
            ) : null}
            {shells.length === 0 && list.approvals.length === 0 ? (
              <p className="px-3 py-6 text-center text-sidebar-muted-foreground text-xs">
                No threads yet. Tell Aldo what to get done, or start one with the pen.
              </p>
            ) : null}
          </>
        )}
      </SidebarContent>
      <SidebarFoot
        groups={groups}
        scope={scopeGroup}
        onScope={setScope}
        usage={home?.usage ?? null}
        onNavigate={() => isMobile && setOpenMobile(false)}
      />
      <Popover
        open={peek !== null && home !== null}
        onOpenChange={(open) => (open ? undefined : setPeek(null))}
      >
        <PopoverPopup
          anchor={peek?.anchor}
          side="right"
          align="start"
          sideOffset={12}
          initialFocus={false}
          finalFocus={false}
          className="w-[24rem] max-w-[calc(100vw-2rem)] p-0"
          viewportClassName="p-0"
          data-aldo-sidebar-peek=""
          onMouseEnter={clearTimers}
          onMouseLeave={leave}
        >
          {peek && home ? (
            <AldoPeek
              peek={peek.target}
              home={home}
              now={now}
              onClose={() => setPeek(null)}
              onAsked={() => setPeek(null)}
              className="max-h-[min(36rem,75vh)] rounded-[inherit]"
            />
          ) : null}
        </PopoverPopup>
      </Popover>
      <ThreadMenu request={menu} onRename={(row) => setRenaming(row.key)} />
    </>
  );
}

// ---------------------------------------------------------------------------

const ALDO_STATUS: Record<string, string> = {
  connecting: "Connecting…",
  listening: "Listening",
  hearing: "Listening",
  thinking: "Thinking…",
  speaking: "Speaking",
  error: "Tap the orb to talk again",
};

/** Aldo at the top: its home (the conversation), the orb to talk, and mute while a call is on. */
function AldoRow(props: { readonly active: boolean; readonly onNavigate: () => void }) {
  const available = useAldoAssistantAvailable();
  const phase = useAldoAssistant((s) => s.phase);
  const said = useAldoAssistant((s) => s.said);
  const muted = useAldoAssistant((s) => s.muted);
  const micOn = useAldoAssistant((s) => s.micOn);
  const replying = useAldoAssistant((s) => s.replying);
  const live = phase !== "idle" && phase !== "error";
  const status = !available
    ? "Your agents"
    : live && muted
      ? "Muted"
      : phase === "speaking" && said
        ? said
        : replying
          ? "Thinking…"
          : (ALDO_STATUS[phase] ?? `Talk or type · ${ALDO_SUMMON_LABEL}`);
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors",
        props.active
          ? "bg-sidebar-row-active shadow-xs/5 ring-1 ring-border/60"
          : "hover:bg-sidebar-row-hover",
      )}
    >
      {available ? <AldoOrb size="sm" /> : null}
      <Link
        to="/"
        className="flex min-w-0 flex-1 flex-col leading-tight"
        aria-label="Open Aldo"
        onClick={() => {
          setAldoHomeView("aldo");
          props.onNavigate();
        }}
      >
        <span className="font-semibold text-sidebar-foreground text-sm">Aldo</span>
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
        <button
          type="button"
          aria-label={muted ? "Unmute" : "Mute"}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-muted-foreground hover:bg-sidebar-control-surface hover:text-sidebar-foreground"
          onClick={() => setAldoMuted(!muted)}
        >
          {muted ? <MicOffIcon className="size-3.5" /> : <MicIcon className="size-3.5" />}
        </button>
      ) : null}
    </div>
  );
}

function Group(props: {
  readonly title: string;
  readonly count?: number;
  readonly tone?: "amber" | "green";
  readonly icon?: ReactNode;
  /** Folds: open or not, and how to toggle it. */
  readonly open?: boolean;
  readonly onToggle?: () => void;
  readonly children?: ReactNode;
}) {
  const foldable = props.onToggle !== undefined;
  const label = (
    <>
      {foldable ? (
        props.open ? (
          <ChevronDownIcon className="size-3" />
        ) : (
          <ChevronRightIcon className="size-3" />
        )
      ) : (
        props.icon
      )}
      <span className="flex-1 text-left">{props.title}</span>
      {props.count !== undefined ? (
        <span
          className={cn(
            "min-w-[1.125rem] rounded-full px-1.5 text-center font-semibold text-[10px] leading-4 tracking-normal",
            props.tone === "amber"
              ? "bg-warning/15 text-warning-foreground"
              : props.tone === "green"
                ? "bg-success/12 text-success-foreground"
                : "bg-sidebar-control-surface text-sidebar-muted-foreground",
          )}
        >
          {props.count}
        </span>
      ) : null}
    </>
  );
  const labelClass =
    "flex w-full items-center gap-1.5 px-2 pt-3 pb-1 font-semibold text-[11px] text-sidebar-muted-foreground/80 uppercase tracking-wide";
  return (
    <section className="flex flex-col" aria-label={props.title}>
      {foldable ? (
        <button
          type="button"
          aria-expanded={props.open}
          className={cn(labelClass, "hover:text-sidebar-foreground")}
          onClick={props.onToggle}
        >
          {label}
        </button>
      ) : (
        <h3 className={labelClass}>{label}</h3>
      )}
      <ul className="flex flex-col gap-px">{props.children}</ul>
    </section>
  );
}

function ProgressRing(props: { readonly value: number }) {
  const length = 2 * Math.PI * 7;
  return (
    <svg viewBox="0 0 20 20" className="size-4" aria-hidden>
      <circle cx="10" cy="10" r="7" fill="none" className="stroke-primary/20" strokeWidth="2.5" />
      <circle
        cx="10"
        cy="10"
        r="7"
        fill="none"
        className="stroke-primary"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${length * props.value} ${length}`}
        transform="rotate(-90 10 10)"
      />
    </svg>
  );
}

const KIND_ICON: Partial<Record<AldoSidebarKind, ReactNode>> = {
  approval: <ShieldQuestionIcon className="size-3.5 text-warning-foreground" />,
  question: <MessageCircleQuestionIcon className="size-3.5 text-warning-foreground" />,
  plan: <ClipboardListIcon className="size-3.5 text-warning-foreground" />,
  waiting: <span className="size-2 rounded-full bg-warning" />,
  failed: <CircleAlertIcon className="size-3.5 text-destructive-foreground" />,
  merge: <GitMergeIcon className="size-3.5 text-success-foreground" />,
  landing: <GitMergeIcon className="size-3.5 text-primary" />,
  unread: <CheckCircle2Icon className="size-3.5 text-success-foreground" />,
  done: <span className="size-1.5 rounded-full bg-sidebar-muted-foreground/40" />,
};

function RowIcon(props: { readonly row: AldoSidebarRow }) {
  const { row } = props;
  if (row.kind === "working" || row.kind === "monitoring" || row.kind === "starting") {
    return row.progress !== null ? (
      <ProgressRing value={row.progress} />
    ) : (
      <span className="size-3.5 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
    );
  }
  return <>{KIND_ICON[row.kind]}</>;
}

function rowTime(row: AldoSidebarRow, now: number): string {
  if (row.kind === "working" || row.kind === "monitoring" || row.kind === "starting") {
    return elapsed(row.at, now).replace(" min", "m").replace(" h", "h").replace("just now", "now");
  }
  return relativeTime(row.at, now).replace(" ago", "");
}

/**
 * A row's menu from a tap and hold, on touch screens: iOS never sends
 * contextmenu, and Android sends one partway through the hold, which would
 * close the menu the hold opened (and open the browser's own). So while a
 * finger is down the page doesn't get contextmenu (Android's opens the menu
 * at once instead), and the tap that ends a hold doesn't open the thread.
 */
function useHold(onMenu: (at: Point) => void) {
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);
  const held = useRef(false);
  const onMenuRef = useRef(onMenu);
  onMenuRef.current = onMenu;

  const fire = useCallback(() => {
    const current = hold.current;
    if (!current || held.current) return;
    window.clearTimeout(current.timer);
    held.current = true;
    onMenuRef.current({ x: current.x, y: current.y });
  }, []);
  const swallow = useCallback(
    (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      fire();
    },
    [fire],
  );
  const end = useCallback(() => {
    if (!hold.current) return;
    window.clearTimeout(hold.current.timer);
    hold.current = null;
    // Android's contextmenu can trail the finger lifting.
    window.setTimeout(() => window.removeEventListener("contextmenu", swallow, true), 400);
  }, [swallow]);
  useEffect(() => () => window.removeEventListener("contextmenu", swallow, true), [swallow]);

  return {
    onPointerDown: (event: ReactPointerEvent) => {
      held.current = false;
      if (event.pointerType === "mouse") return;
      end();
      hold.current = {
        x: event.clientX,
        y: event.clientY,
        timer: window.setTimeout(fire, HOLD_MS),
      };
      window.addEventListener("contextmenu", swallow, true);
    },
    onPointerMove: (event: ReactPointerEvent) => {
      const current = hold.current;
      if (
        current &&
        Math.hypot(event.clientX - current.x, event.clientY - current.y) > HOLD_SLOP_PX
      ) {
        end();
      }
    },
    onPointerUp: end,
    onPointerCancel: end,
    onClickCapture: (event: ReactMouseEvent) => {
      if (!held.current) return;
      held.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

function ThreadRow(props: {
  readonly row: AldoSidebarRow;
  readonly now: number;
  readonly active: boolean;
  readonly peeking: boolean;
  readonly renaming: boolean;
  readonly onOpen: () => void;
  readonly onHover: (anchor: HTMLElement) => void;
  readonly onLeave: () => void;
  readonly onPeek: (anchor: HTMLElement) => void;
  readonly onMenu: (at: Point) => void;
  readonly onRenamed: () => void;
}) {
  const { row } = props;
  const element = useRef<HTMLLIElement>(null);
  const [merging, setMerging] = useState(false);
  const hold = useHold(props.onMenu);
  const timestampFormat = useClientSettings((s) => s.timestampFormat);
  const detail =
    row.shell.snoozedUntil && row.kind !== "approval" && row.kind !== "question"
      ? snoozeWakeDescription(row.shell.snoozedUntil, new Date(props.now), timestampFormat)
      : null;
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      event.preventDefault();
      props.onOpen();
    } else if (event.key === " ") {
      event.preventDefault();
      if (element.current) props.onPeek(element.current);
    }
  };
  return (
    <li
      ref={element}
      role="button"
      tabIndex={0}
      aria-current={props.active ? "page" : undefined}
      data-aldo-row={row.kind}
      className={cn(
        "group/row relative flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2 py-1.5 outline-none transition-colors [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-ring",
        props.active
          ? "bg-sidebar-row-active shadow-xs/5 ring-1 ring-border/60"
          : props.peeking
            ? "bg-sidebar-row-hover"
            : "hover:bg-sidebar-row-hover",
      )}
      onClick={props.renaming ? undefined : props.onOpen}
      onKeyDown={onKeyDown}
      // Pointer rather than mouse events: a tap's emulated mouseenter would peek.
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") props.onHover(event.currentTarget);
      }}
      onPointerLeave={props.onLeave}
      onContextMenu={(event) => {
        // Renaming, the input keeps its own (cut, copy, paste).
        if (props.renaming) return;
        event.preventDefault();
        // From the keyboard (the menu key, Shift+F10) it has no pointer: under the row.
        const rect = event.currentTarget.getBoundingClientRect();
        props.onMenu(
          event.clientX === 0 && event.clientY === 0
            ? { x: rect.left + 8, y: rect.bottom }
            : { x: event.clientX, y: event.clientY },
        );
      }}
      {...hold}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        <RowIcon row={row} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        {props.renaming ? (
          <RenameInput shell={row.shell} onDone={props.onRenamed} />
        ) : (
          <span
            className={cn(
              "truncate text-[13px] text-sidebar-foreground",
              row.unread && "font-semibold",
              props.active && "font-medium",
            )}
          >
            {row.shell.title}
          </span>
        )}
        <span className="truncate text-[11.5px] text-sidebar-muted-foreground">
          {detail ? `Until ${detail}` : row.detail}
          {row.repo ? ` · ${row.repo}` : ""}
        </span>
      </span>
      <span className="shrink-0 self-start pt-0.5 text-[11px] text-sidebar-muted-foreground/80 group-hover/row:invisible">
        {rowTime(row, props.now)}
      </span>
      <span className="absolute end-1.5 top-1/2 hidden -translate-y-1/2 items-center gap-1 group-hover/row:flex">
        {row.kind === "merge" && row.pullRequest ? (
          <button
            type="button"
            disabled={merging}
            className="h-6 rounded-md bg-primary px-2 font-medium text-[11.5px] text-primary-foreground hover:bg-primary/90"
            onClick={(event) => {
              event.stopPropagation();
              const pr = row.pullRequest;
              if (!pr) return;
              void mergeFollowedPullRequest(pr, () => setMerging(true)).then((merged) => {
                setMerging(false);
                if (merged) void refreshAldoHome();
              });
            }}
          >
            {merging ? "Merging…" : "Merge"}
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`More for ${row.shell.title}`}
          className="flex size-6 items-center justify-center rounded-md bg-sidebar-row-active text-sidebar-muted-foreground shadow-xs/5 hover:text-sidebar-foreground"
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            props.onMenu({ x: rect.left, y: rect.bottom + 4 });
          }}
        >
          <EllipsisIcon className="size-3.5" />
        </button>
      </span>
    </li>
  );
}

const APPROVAL_ICON = { email: MailIcon, event: CalendarPlusIcon, start: SparklesIcon } as const;

function ApprovalRow(props: {
  readonly approval: AldoApproval;
  readonly now: number;
  readonly peeking: boolean;
  readonly onHover: (anchor: HTMLElement) => void;
  readonly onLeave: () => void;
  readonly onPeek: (anchor: HTMLElement) => void;
}) {
  const a = props.approval;
  const Icon = APPROVAL_ICON[a.kind];
  return (
    <li
      role="button"
      tabIndex={0}
      data-aldo-row="approval-item"
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        props.peeking ? "bg-sidebar-row-hover" : "hover:bg-sidebar-row-hover",
      )}
      onClick={(event) => props.onPeek(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onPeek(event.currentTarget);
        }
      }}
      onMouseEnter={(event) => props.onHover(event.currentTarget)}
      onMouseLeave={props.onLeave}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        <Icon className="size-3.5 text-warning-foreground" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] text-sidebar-foreground">{a.title}</span>
        <span className="truncate text-[11.5px] text-sidebar-muted-foreground">
          {a.kind === "email"
            ? "Email to approve"
            : a.kind === "event"
              ? "Event to add"
              : "Thread to start"}
          {a.summary ? ` · ${a.summary}` : ""}
        </span>
      </span>
      <span className="shrink-0 self-start pt-0.5 text-[11px] text-sidebar-muted-foreground/80">
        {relativeTime(a.createdAt, props.now).replace(" ago", "")}
      </span>
    </li>
  );
}

function ScheduledRow(props: {
  readonly item: AldoScheduledItem;
  readonly now: number;
  readonly onOpen: (target: { environmentId: string; threadId: string } | null) => void;
}) {
  const { item } = props;
  const routine = item.kind === "routine" ? item.routine : null;
  const delivery = item.kind === "delivery" ? item.delivery : null;
  const target = routine?.thread ?? delivery?.thread ?? null;
  const when = routine?.nextRunAt ?? delivery?.dueAt ?? null;
  return (
    <li
      role="button"
      tabIndex={0}
      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-sidebar-row-hover"
      onClick={() => props.onOpen(target)}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-sidebar-muted-foreground">
        {routine ? <RepeatIcon className="size-3.5" /> : <BellIcon className="size-3.5" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] text-sidebar-foreground">
          {routine ? routine.title : (delivery?.message ?? "")}
        </span>
        <span className="truncate text-[11.5px] text-sidebar-muted-foreground">
          {routine ? routine.when : `To ${delivery?.threadTitle ?? "a thread"}`}
        </span>
      </span>
      {when ? (
        <span className="shrink-0 self-start pt-0.5 text-[11px] text-sidebar-muted-foreground/80">
          {new Date(when).toLocaleString(undefined, {
            weekday: "short",
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      ) : null}
    </li>
  );
}

/** Threads begun and not sent yet: back to them, or discarded. */
function DraftGroup(props: {
  readonly repoOf: (environmentId: string, projectId: string) => string;
  readonly onOpen: (draftId: string) => void;
}) {
  const sessions = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const drafts = useComposerDraftStore((store) => store.draftsByThreadKey);
  const clearDraftThread = useComposerDraftStore((store) => store.clearDraftThread);
  const rows = Object.entries(sessions).flatMap(([draftId, session]) => {
    const draft = drafts[draftId];
    if (session.promotedTo != null || !composerDraftHasUserContent(draft)) return [];
    return [{ draftId, session, prompt: draft?.prompt.trim() ?? "" }];
  });
  if (rows.length === 0) return null;
  return (
    <Group title="Drafts" count={rows.length}>
      {rows.map(({ draftId, session, prompt }) => (
        <li
          key={draftId}
          role="button"
          tabIndex={0}
          className="group/row relative flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-sidebar-row-hover"
          onClick={() => props.onOpen(draftId)}
        >
          <span className="flex size-4 shrink-0 items-center justify-center">
            <PencilLineIcon className="size-3.5 text-warning-foreground" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] text-sidebar-foreground">
              {prompt.split("\n")[0] || "New thread"}
            </span>
            <span className="truncate text-[11.5px] text-sidebar-muted-foreground">
              Not sent · {props.repoOf(session.environmentId, session.projectId)}
            </span>
          </span>
          <button
            type="button"
            aria-label="Discard the draft"
            className="hidden size-6 items-center justify-center rounded-md text-sidebar-muted-foreground hover:text-sidebar-foreground group-hover/row:flex"
            onClick={(event) => {
              event.stopPropagation();
              clearDraftThread(DraftId.make(draftId));
            }}
          >
            <XIcon className="size-3.5" />
          </button>
        </li>
      ))}
    </Group>
  );
}

/**
 * A row's menu: T3's own thread menu (useThreadActionMenu), as its sidebar
 * and the chat header have it, so what it offers for a thread, and how it
 * says an action failed, are T3's. Opens once for each request.
 */
function ThreadMenu(props: {
  readonly request: MenuRequest | null;
  readonly onRename: (row: AldoSidebarRow) => void;
}) {
  const { request, onRename } = props;
  const shell = request?.row.shell ?? null;
  const environmentId = shell?.environmentId ?? null;
  const threadId = shell?.id ?? null;
  const projectId = shell?.projectId ?? null;
  const projects = useProjects();
  const threadRef = useMemo(
    () => (environmentId && threadId ? scopeThreadRef(environmentId, threadId) : null),
    [environmentId, threadId],
  );
  const projectCwd =
    projects.find((project) => project.environmentId === environmentId && project.id === projectId)
      ?.workspaceRoot ?? null;
  const onStartRename = useCallback(() => {
    if (request) onRename(request.row);
  }, [onRename, request]);
  const { openMenu } = useThreadActionMenu({ threadRef, projectCwd, onStartRename });
  const opened = useRef(0);
  useEffect(() => {
    if (!request || opened.current === request.id) return;
    opened.current = request.id;
    openMenu(request.at);
  }, [openMenu, request]);
  return null;
}

/** The row's title, to rename it in place (from the menu), as T3's sidebar does. */
function RenameInput(props: {
  readonly shell: EnvironmentThreadShell;
  readonly onDone: () => void;
}) {
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (title: string | null) => {
    if (done.current) return;
    done.current = true;
    props.onDone();
    if (title === null) return;
    const { shell } = props;
    const resolution = resolveRenameCommit({ title, originalTitle: shell.title });
    if (resolution.action === "reject-empty") {
      toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
      return;
    }
    if (resolution.action === "noop") return;
    void updateThreadMetadata({
      environmentId: shell.environmentId,
      input: { threadId: shell.id, title: resolution.title },
    }).then((result) => {
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Failed to rename thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    });
  };
  return (
    <input
      ref={input}
      defaultValue={props.shell.title}
      aria-label="Thread title"
      autoComplete="off"
      className="-mx-1 min-w-0 rounded-sm bg-background px-1 text-[13px] text-sidebar-foreground outline-none ring-1 ring-ring"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") finish(event.currentTarget.value);
        else if (event.key === "Escape") finish(null);
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
    />
  );
}

/** The foot: which projects show, the month's credits, and who's signed in. */
function SidebarFoot(props: {
  readonly groups: ReturnType<typeof buildSidebarProjectSnapshots>;
  readonly scope: ReturnType<typeof buildSidebarProjectSnapshots>[number] | null;
  readonly onScope: (projectKey: string | null) => void;
  readonly usage: AldoHomeUsage | null;
  readonly onNavigate: () => void;
}) {
  const credits = props.usage?.credits ?? null;
  const share =
    credits && credits.included > 0 ? Math.min(1, credits.used / credits.included) : null;
  return (
    <div
      className="flex shrink-0 flex-col gap-2 border-sidebar-border border-t px-3 pt-2.5 pb-3"
      data-aldo-sidebar-foot=""
    >
      <div className="flex items-center gap-2">
        {props.groups.length > 1 ? (
          <Menu>
            <MenuTriggerButton>
              <FolderIcon className="size-3.5" />
              <span className="max-w-32 truncate">
                {props.scope ? repoLabel(props.scope.displayName) : "All projects"}
              </span>
              <ChevronDownIcon className="size-3" />
            </MenuTriggerButton>
            <MenuPopup side="top" align="start" className="min-w-44">
              <MenuItem onClick={() => props.onScope(null)}>All projects</MenuItem>
              <MenuSeparator />
              {props.groups.map((group) => (
                <MenuItem key={group.projectKey} onClick={() => props.onScope(group.projectKey)}>
                  {repoLabel(group.displayName)}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        ) : null}
        {share !== null && credits ? (
          <Link
            to="/usage"
            className="ms-auto flex min-w-0 flex-col gap-1 text-[11px] text-sidebar-muted-foreground hover:text-sidebar-foreground"
            onClick={props.onNavigate}
          >
            <span className="truncate text-end">
              {credits.used.toLocaleString()} / {credits.included.toLocaleString()} credits
            </span>
            <span className="h-1 w-28 self-end overflow-hidden rounded-full bg-sidebar-control-surface">
              <span
                className={cn(
                  "block h-full rounded-full",
                  share >= 0.9 ? "bg-warning" : "bg-primary",
                )}
                style={{ width: `${Math.round(share * 100)}%` }}
              />
            </span>
          </Link>
        ) : null}
      </div>
      <AldoProfileButton className="-mx-1.5 w-[calc(100%+0.75rem)]" />
    </div>
  );
}

function MenuTriggerButton(props: { readonly children: ReactNode }) {
  return (
    <MenuTrigger className="flex h-7 items-center gap-1.5 rounded-md border border-sidebar-border bg-sidebar-row-active px-2 text-[11.5px] text-sidebar-muted-foreground hover:text-sidebar-foreground">
      {props.children}
    </MenuTrigger>
  );
}
