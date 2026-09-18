import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { MicIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";

import { useIsMobile } from "../hooks/useMediaQuery";
import { isLandingDemo } from "../landingDemo/mode";
import { isManagedDevPc } from "../managedDevPc";
import { cn } from "~/lib/utils";
import { derivePendingApprovals } from "../session-logic";
import { useThread, useThreadShells } from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { resolveThreadRouteRef, buildThreadRouteParams } from "../threadRoutes";
import { useRightPanelStore } from "../rightPanelStore";
import { Button } from "./ui/button";
import { useSidebar } from "./ui/sidebar";
import { stackedThreadToast, toastManager } from "./ui/toast";

/** The conversation page and its memory editor, both served by the managed gateway. */
const AGENT_URL = "/_aldo/agent";
const MEMORY_URL = "/_aldo/agent/memory";
/** Threads the coordinator starts carry this prefix in their id. */
const ALDO_THREAD_PREFIX = "aldo-";
/** Height of the bar at the bottom of the workspace, in pixels. */
const BAR_HEIGHT = 52;

type AldoPhase =
  | "loading"
  | "unavailable"
  | "idle"
  | "connecting"
  | "initializing"
  | "listening"
  | "thinking"
  | "speaking"
  | "ended";
/** What the embedded page reports about itself. */
interface AldoFrameState {
  phase: AldoPhase;
  live: boolean;
  said: string;
  heard: string;
  pushToTalk: boolean;
  pressed: boolean;
  error: string | null;
}
/** What the embedded page may be told to do. */
type AldoCommand =
  | { command: "layout"; layout: "bar" | "full" }
  | { command: "connect" }
  | { command: "disconnect" }
  | { command: "push-to-talk"; enabled: boolean }
  | { command: "press"; pressed: boolean }
  | { command: "text"; text: string }
  | { command: "discuss"; threadId: string; title: string };
/** What the coordinator did or wants shown, relayed by the page. */
type AldoEvent =
  | { type: "action"; tool: string; threadId?: string; title?: string }
  | { type: "navigate"; target: "thread" | "diff" | "approvals"; threadId: string };

interface AldoAgentStore extends AldoFrameState {
  /** The bar is shown at the bottom of the workspace. */
  open: boolean;
  memoryOpen: boolean;
  frame: HTMLIFrameElement | null;
  ready: boolean;
  queued: AldoCommand[];
  openAgent: (options?: { command?: AldoCommand }) => void;
  closeAgent: () => void;
  setMemoryOpen: (open: boolean) => void;
  send: (command: AldoCommand) => void;
  attachFrame: (frame: HTMLIFrameElement | null) => void;
  frameReady: () => void;
  reflect: (state: Partial<AldoFrameState>) => void;
}
const INITIAL_FRAME_STATE: AldoFrameState = {
  phase: "loading",
  live: false,
  said: "",
  heard: "",
  pushToTalk: false,
  pressed: false,
  error: null,
};
export const useAldoAgentStore = create<AldoAgentStore>((set, get) => {
  const deliver = (frame: HTMLIFrameElement | null, command: AldoCommand) => {
    frame?.contentWindow?.postMessage(
      { type: "aldo-agent:command", ...command },
      window.location.origin,
    );
  };
  return {
    ...INITIAL_FRAME_STATE,
    open: false,
    memoryOpen: false,
    frame: null,
    ready: false,
    queued: [],
    openAgent: (options) => {
      const { open, ready, frame } = get();
      set({ open: true });
      const command = options?.command;
      if (command) {
        if (open && ready) deliver(frame, command);
        else set((state) => ({ queued: [...state.queued, command] }));
      }
    },
    closeAgent: () =>
      set({ ...INITIAL_FRAME_STATE, open: false, memoryOpen: false, ready: false, queued: [] }),
    setMemoryOpen: (memoryOpen) => set({ memoryOpen }),
    send: (command) => {
      const { ready, frame } = get();
      if (ready) deliver(frame, command);
      else set((state) => ({ queued: [...state.queued, command] }));
    },
    attachFrame: (frame) => set({ frame, ...(frame ? {} : { ready: false }) }),
    frameReady: () => {
      const { frame, queued } = get();
      set({ ready: true, queued: [] });
      deliver(frame, { command: "layout", layout: "bar" });
      for (const command of queued) deliver(frame, command);
    },
    reflect: (state) => set(state),
  };
});

const PHASE_LABELS: Record<AldoPhase, string> = {
  loading: "Aldo",
  unavailable: "Aldo unavailable",
  idle: "Aldo",
  connecting: "Connecting",
  initializing: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  ended: "Aldo",
};
const TOOL_LABELS: Record<string, string> = {
  start_agent: "Started",
  message_agent: "Messaged",
  interrupt_agent: "Interrupted",
  settle_thread: "Settled",
  unsettle_thread: "Reopened",
  archive_thread: "Archived",
  unarchive_thread: "Restored",
  delete_thread: "Deleted",
  rename_thread: "Renamed",
  set_agent_permissions: "Changed permissions on",
};
export function isAldoThreadId(id: string): boolean {
  return id.startsWith(ALDO_THREAD_PREFIX);
}
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.closest("[data-keybinding-capture]") !== null
  );
}

/** The sidebar entry: shows or hides the bar, and mirrors what Aldo is doing while live. */
export function ManagedDevPcAgent() {
  const { isMobile, setOpenMobile } = useSidebar();
  const openAgent = useAldoAgentStore((state) => state.openAgent);
  const closeAgent = useAldoAgentStore((state) => state.closeAgent);
  const open = useAldoAgentStore((state) => state.open);
  const phase = useAldoAgentStore((state) => state.phase);
  const live = useAldoAgentStore((state) => state.live);
  if (!isManagedDevPc || isLandingDemo()) return null;
  return (
    <button
      type="button"
      onClick={() => {
        if (isMobile) setOpenMobile(false);
        if (open && !live) closeAgent();
        else openAgent();
      }}
      className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm text-sidebar-muted-foreground/80 outline-hidden hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      data-devpc-agent-button
      data-devpc-agent-phase={phase}
      aria-pressed={open}
    >
      <MicIcon
        className={cn(
          "size-5 shrink-0",
          live && "text-emerald-400",
          phase === "speaking" && "animate-pulse",
        )}
        aria-hidden
      />
      <span className="font-medium">{live ? PHASE_LABELS[phase] : "Aldo Agent"}</span>
      {live && phase === "listening" ? (
        <span className="ml-auto size-2 rounded-full bg-emerald-400" aria-hidden />
      ) : null}
    </button>
  );
}

/** Small badge for threads Aldo started. */
export function AldoThreadBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-px text-[10px] font-medium text-emerald-500",
        className,
      )}
      aria-label="Started by Aldo"
      data-devpc-aldo-badge
    >
      <MicIcon className="size-2.5" aria-hidden />
      Aldo
    </span>
  );
}

/** A thread summary for a toast, with the approval the agent is waiting on when there is one. */
function AldoThreadCard({ threadRef }: { threadRef: ScopedThreadRef }) {
  const thread = useThread(threadRef);
  const respond = useAtomCommand(threadEnvironment.respondToApproval, { reportFailure: false });
  const approvals = useMemo(
    () => (thread ? derivePendingApprovals(thread.activities) : []),
    [thread],
  );
  const approval = approvals[0];
  if (!thread) return null;
  const model = thread.modelSelection.model;
  const reasoning = thread.modelSelection.options?.find((option) =>
    ["reasoningEffort", "effort", "reasoning"].includes(option.id),
  )?.value;
  const permissions =
    thread.runtimeMode === "full-access"
      ? "full access"
      : thread.runtimeMode === "approval-required"
        ? "asks before acting"
        : thread.runtimeMode;
  return (
    <div className="flex flex-col gap-2" data-devpc-aldo-card>
      <p className="text-xs text-muted-foreground">
        {model}
        {reasoning ? ` · ${String(reasoning)} reasoning` : ""} · {permissions}
      </p>
      {approval ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs">Waiting on you{approval.detail ? `: ${approval.detail}` : "."}</p>
          <div className="flex flex-wrap gap-1.5">
            {(
              approval.options ?? [
                { decision: "accept" as const, label: "Approve" },
                { decision: "decline" as const, label: "Decline" },
              ]
            ).map((option) => (
              <Button
                key={option.decision}
                size="xs"
                variant={
                  option.decision === "decline" || option.decision === "cancel"
                    ? "outline"
                    : "default"
                }
                onClick={() =>
                  void respond({
                    environmentId: threadRef.environmentId,
                    input: {
                      threadId: threadRef.threadId,
                      requestId: approval.requestId,
                      decision: option.decision,
                    },
                  })
                }
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Lives above the responsive sidebar so navigation does not unmount an opened voice session.
 * The embedded page owns the conversation; this shell mirrors its state, turns its actions
 * into cards, moves the view where Aldo points, nudges the user when a thread needs them,
 * and hosts the memory editor. The bar itself is rendered by the layout (`AldoAgentBar`).
 */
export function ManagedDevPcAgentProvider({ children }: { children: ReactNode }) {
  if (!isManagedDevPc || isLandingDemo()) return children;
  return (
    <>
      {children}
      <AldoAgentShell />
    </>
  );
}

/**
 * The bar at the bottom of the workspace: a waveform, captions and a few controls, in the
 * layout flow so the workspace above stays fully visible and usable on every screen size.
 */
export function AldoAgentBar() {
  const store = useAldoAgentStore;
  const open = useAldoAgentStore((state) => state.open);
  const attachFrame = useCallback(
    (frame: HTMLIFrameElement | null) => store.getState().attachFrame(frame),
    [store],
  );
  if (!isManagedDevPc || isLandingDemo() || !open) return null;
  return (
    <section
      aria-label="Aldo Agent"
      className="shrink-0 border-t border-border bg-black pb-[env(safe-area-inset-bottom)]"
      style={{ height: `calc(${BAR_HEIGHT}px + env(safe-area-inset-bottom))` }}
      data-devpc-agent-view
      data-devpc-agent-layout="bar"
    >
      {/* eslint-disable-next-line react/iframe-missing-sandbox -- trusted same-origin Aldo application with microphone access */}
      <iframe
        ref={attachFrame}
        src={AGENT_URL}
        title="Aldo Agent conversation"
        allow="microphone; autoplay"
        className="block w-full border-0"
        style={{ height: BAR_HEIGHT }}
      />
    </section>
  );
}

function AldoAgentShell() {
  const store = useAldoAgentStore;
  const open = useAldoAgentStore((state) => state.open);
  const memoryOpen = useAldoAgentStore((state) => state.memoryOpen);
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const shells = useThreadShells();
  const activeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const findShell = useCallback(
    (threadId: string): EnvironmentThreadShell | undefined =>
      shells.find((shell) => shell.id === threadId),
    [shells],
  );
  const goToThread = useCallback(
    (ref: ScopedThreadRef) => {
      void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
    },
    [navigate],
  );
  const showThreadToast = useCallback(
    (options: {
      title: ReactNode;
      ref: ScopedThreadRef | null;
      type?: "info" | "success" | "warning" | "error";
      timeout?: number;
      talk?: { threadId: string; title: string };
    }) => {
      const { ref } = options;
      toastManager.add(
        stackedThreadToast({
          type: options.type ?? "info",
          title: options.title,
          ...(ref ? { description: <AldoThreadCard threadRef={ref} /> } : {}),
          timeout: options.timeout ?? 8_000,
          ...(ref ? { actionProps: { children: "Open", onClick: () => goToThread(ref) } } : {}),
          data: {
            leadingIcon: <MicIcon className="size-4 text-emerald-500" aria-hidden />,
            ...(ref ? { threadRef: ref } : {}),
            ...(options.talk
              ? {
                  secondaryActionProps: {
                    children: "Talk about it",
                    onClick: () =>
                      store.getState().openAgent({
                        command: { command: "discuss", ...options.talk! },
                      }),
                  },
                  secondaryActionVariant: "outline" as const,
                }
              : {}),
          },
        }),
      );
    },
    [goToThread, store],
  );

  // Messages from the embedded page.
  useEffect(() => {
    if (!open) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: unknown } & Record<string, unknown>;
      if (typeof data !== "object" || data === null || typeof data.type !== "string") return;
      const state = store.getState();
      switch (data.type) {
        case "aldo-agent:ready":
          state.frameReady();
          break;
        case "aldo-agent:close":
          state.closeAgent();
          break;
        case "aldo-agent:memory":
          state.setMemoryOpen(true);
          break;
        case "aldo-agent:state": {
          const next: Partial<AldoFrameState> = {};
          if (typeof data.phase === "string") next.phase = data.phase as AldoPhase;
          if (typeof data.live === "boolean") next.live = data.live;
          if (typeof data.said === "string") next.said = data.said;
          if (typeof data.heard === "string") next.heard = data.heard;
          if (typeof data.pushToTalk === "boolean") next.pushToTalk = data.pushToTalk;
          if (typeof data.pressed === "boolean") next.pressed = data.pressed;
          if (data.error === null || typeof data.error === "string") next.error = data.error;
          state.reflect(next);
          break;
        }
        case "aldo-agent:event": {
          const aldoEvent = data.event as AldoEvent | undefined;
          if (!aldoEvent || typeof aldoEvent !== "object") return;
          if (aldoEvent.type === "navigate") {
            const shell = findShell(aldoEvent.threadId);
            if (!shell) return;
            const ref = scopeThreadRef(shell.environmentId, shell.id);
            goToThread(ref);
            if (aldoEvent.target === "diff") useRightPanelStore.getState().open(ref, "diff");
            return;
          }
          if (aldoEvent.type === "action") {
            const shell = aldoEvent.threadId ? findShell(aldoEvent.threadId) : undefined;
            const title = shell?.title ?? aldoEvent.title ?? "a thread";
            const label = TOOL_LABELS[aldoEvent.tool] ?? aldoEvent.tool;
            const ref =
              shell && aldoEvent.tool !== "delete_thread"
                ? scopeThreadRef(shell.environmentId, shell.id)
                : null;
            showThreadToast({
              title: `${label} “${title}”`,
              ref,
              type: aldoEvent.tool === "delete_thread" ? "warning" : "success",
            });
          }
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [open, findShell, goToThread, showThreadToast, store]);

  // Keys while the shell has focus: Mod+Shift+A shows Aldo and starts talking, Escape closes
  // the memory editor, and Space held is push-to-talk when that mode is on.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const state = store.getState();
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        if (!state.open) state.openAgent({ command: { command: "connect" } });
        else if (!state.live) state.send({ command: "connect" });
        else state.send({ command: "disconnect" });
        return;
      }
      if (!state.open) return;
      if (event.key === "Escape" && state.memoryOpen) {
        state.setMemoryOpen(false);
        return;
      }
      if (event.key === " " && state.pushToTalk && state.live && !isEditable(event.target)) {
        event.preventDefault();
        if (!event.repeat) state.send({ command: "press", pressed: true });
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const state = store.getState();
      if (event.key === " " && state.open && state.pushToTalk)
        state.send({ command: "press", pressed: false });
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [store]);

  // Nudges: a thread that starts waiting on the user, and Aldo's own threads finishing or
  // failing, each get a card with a way to open it or talk it over. The first snapshot is a
  // baseline; only later transitions are news.
  const seen = useRef<Map<string, { attention: boolean; state: string }> | null>(null);
  useEffect(() => {
    const previous = seen.current;
    const next = new Map<string, { attention: boolean; state: string }>();
    for (const shell of shells) {
      const attention = shell.hasPendingApprovals || shell.hasPendingUserInput;
      const state = shell.latestTurn?.state ?? "idle";
      next.set(shell.id, { attention, state });
      if (!previous) continue;
      const before = previous.get(shell.id);
      if (!before) continue;
      const isActive = activeThreadRef?.threadId === shell.id;
      const ref = scopeThreadRef(shell.environmentId, shell.id);
      const talk = { threadId: shell.id, title: shell.title };
      if (attention && !before.attention && !isActive)
        showThreadToast({
          title: `“${shell.title}” needs you`,
          ref,
          type: "warning",
          timeout: 0,
          talk,
        });
      else if (
        isAldoThreadId(shell.id) &&
        !isActive &&
        before.state === "running" &&
        (state === "completed" || state === "error")
      )
        showThreadToast({
          title: state === "error" ? `“${shell.title}” failed` : `“${shell.title}” finished`,
          ref,
          type: state === "error" ? "error" : "success",
          timeout: 12_000,
          talk,
        });
    }
    seen.current = next;
  }, [shells, activeThreadRef?.threadId, showThreadToast]);

  if (!memoryOpen) return null;
  return createPortal(
    <section
      aria-label="What Aldo remembers"
      className="fixed inset-0 z-[60] flex flex-col bg-black"
      style={isMobile ? { paddingTop: "env(safe-area-inset-top)" } : undefined}
      data-devpc-agent-memory
    >
      <div className="flex h-9 shrink-0 items-center justify-end px-2">
        <button
          type="button"
          className="rounded-md p-1 text-white/70 hover:bg-white/10 hover:text-white"
          aria-label="Close"
          onClick={() => store.getState().setMemoryOpen(false)}
        >
          <XIcon className="size-4" aria-hidden />
        </button>
      </div>
      {/* eslint-disable-next-line react/iframe-missing-sandbox -- trusted same-origin Aldo application */}
      <iframe src={MEMORY_URL} title="What Aldo remembers" className="h-full w-full border-0" />
    </section>,
    document.body,
  );
}

/** Used by the sidebar to badge threads Aldo started. */
export function threadStartedByAldo(threadId: ThreadId): boolean {
  return isAldoThreadId(threadId);
}
