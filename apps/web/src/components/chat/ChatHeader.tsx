import { AldoThreadBreadcrumb } from "~/aldo/AldoThreadBreadcrumb";
import { useAldoPlaceOf } from "~/aldo/places";
import {
  type EnvironmentId,
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ChevronDownIcon } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { isTrailingDoubleClick } from "../Sidebar.logic";
import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import { OpenInPicker } from "./OpenInPicker";
import { useRemoteOpenState, type RemoteOpenMode } from "../../remoteOpen";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useT3ProjectFileScripts } from "~/hooks/useT3ProjectFileScripts";
import { useThreadActionMenu } from "~/hooks/useThreadActionMenu";
import { readLocalApi } from "~/localApi";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { observeResponsiveBreakpointFade, usePanelAnimationSettings } from "../../panelAnimations";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "../WorkspaceBreadcrumb";
import { cn } from "~/lib/utils";
import { AldoBrowsingChip } from "~/aldo/AldoBrowsingChip";
import { AldoPreviewsControl } from "~/aldo/AldoPreviewsControl";
import { isAldoCloud, isAldoEnvironmentId } from "~/aldo/api";
import { AldoMoveThreadPicker, useAldoMovesThreads } from "~/aldo/AldoThreadPlace";
import { useAldoKeptRepo } from "~/aldo/keptRepo";
import { draftTitle } from "~/aldo/places.logic";
import { useRightPanelStore } from "~/rightPanelStore";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  /** Drafts have no server thread yet, so the title carries no action menu. */
  isServerThread: boolean;
  activeProject: EnvironmentProject | null;
  openInCwd: string | null;
  activeProjectScripts: ReadonlyArray<ProjectScript> | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  rightPanelOpen: boolean;
  onNewThreadInProject: () => void;
  onOpenProjectSettings?: (() => void) | undefined;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateProjectScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteProjectScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
  /** Aldo: sends the user's message to a sent thread's agent (moving the thread is one it hands off). */
  onSendAldoMessage?: ((text: string) => Promise<boolean>) | undefined;
}

/**
 * Rename commit rule shared with the sidebar's inline rename: trim, reject
 * empty (the caller toasts), and skip the mutation when nothing changed.
 */
export function resolveRenameCommit(input: {
  readonly title: string;
  readonly originalTitle: string;
}): { action: "commit"; title: string } | { action: "reject-empty" } | { action: "noop" } {
  const trimmed = input.title.trim();
  if (trimmed.length === 0) return { action: "reject-empty" };
  if (trimmed === input.originalTitle) return { action: "noop" };
  return { action: "commit", title: trimmed };
}

// How long a click on the thread title waits before opening the action menu,
// so a double-click-to-rename can cancel it first. Only the native desktop
// menu needs this: it swallows input while open, so the wait must cover the
// OS double-click interval. The browser fallback menu keeps seeing DOM
// events (the second click dismisses it and dblclick still fires), so it
// opens immediately.
const TITLE_MENU_OPEN_DELAY_MS = 500;
// Matches the @3xl/header-actions container breakpoint owned by this header.
const HEADER_ACTIONS_EXPANDED_BREAKPOINT_REM = 48;

export function shouldShowOpenInPicker(input: {
  readonly activeProjectName: string | undefined;
  readonly activeThreadEnvironmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly remoteOpenMode: RemoteOpenMode;
}): boolean {
  if (!input.activeProjectName) return false;
  if (
    input.primaryEnvironmentId !== null &&
    input.activeThreadEnvironmentId === input.primaryEnvironmentId
  ) {
    return true;
  }
  // Remote environments get the picker in deep-link mode (or its explicit
  // "no SSH route" state). Non-primary local backends (e.g. WSL) keep it
  // hidden, matching pre-remote behavior.
  return input.remoteOpenMode !== "local-exec";
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  draftId,
  activeThreadTitle,
  isServerThread,
  activeProject,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  rightPanelOpen,
  onNewThreadInProject,
  onOpenProjectSettings,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onSendAldoMessage,
}: ChatHeaderProps) {
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  const headerActionsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const actions = headerActionsRef.current;
    const container = actions?.parentElement;
    if (!actions || !container) return;
    return observeResponsiveBreakpointFade({
      target: actions,
      container,
      active: panelAnimationsActive,
      durationMs: panelAnimationDurationMs,
      breakpoint: { value: HEADER_ACTIONS_EXPANDED_BREAKPOINT_REM, unit: "rem" },
    });
  }, [panelAnimationDurationMs, panelAnimationsActive]);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const activeProjectName = activeProject?.title;
  const activeProjectCwd = activeProject?.workspaceRoot ?? null;
  const fileScripts = useT3ProjectFileScripts(
    activeThreadEnvironmentId,
    activeProjectScripts ? activeProjectCwd : null,
  );
  const remoteOpenState = useRemoteOpenState(activeThreadEnvironmentId);
  // Aldo's machines have no SSH route from the user's computer to open an editor on.
  const showOpenInPicker =
    !isAldoEnvironmentId(activeThreadEnvironmentId) &&
    shouldShowOpenInPicker({
      activeProjectName,
      activeThreadEnvironmentId,
      primaryEnvironmentId,
      remoteOpenMode: remoteOpenState.mode,
    });
  const activeThreadRef = useMemo(
    () => scopeThreadRef(activeThreadEnvironmentId, activeThreadId),
    [activeThreadEnvironmentId, activeThreadId],
  );
  // Aldo: a General thread, or one in a project Aldo keeps, isn't software
  // work (and Aldo syncs it itself), so no git actions, editors or scripts.
  const aldoKeptRepo = useAldoKeptRepo(activeThreadEnvironmentId);
  // Aldo: where the thread works leads the header. A draft moves from its
  // composer's chip; a sent thread moves here, as a handoff its agent makes.
  const aldoThread = isAldoCloud && isAldoEnvironmentId(activeThreadEnvironmentId);
  const aldoPlace = useAldoPlaceOf(aldoThread ? activeThreadEnvironmentId : null, activeProject);
  const aldoDraft = aldoThread && !isServerThread && draftId !== undefined;
  const aldoMoves = useAldoMovesThreads() && aldoThread && isServerThread && !!onSendAldoMessage;
  const [aldoMoveOpen, setAldoMoveOpen] = useState(false);
  const aldoPlaceAnchorRef = useRef<HTMLSpanElement | null>(null);
  // A draft's title is its first line until it's sent, and it's untitled before that.
  const aldoDraftPrompt = useComposerDraftStore((store) =>
    aldoDraft && draftId ? (store.getComposerDraft(draftId)?.prompt ?? "") : "",
  );
  const aldoDraftTitle = aldoDraft
    ? draftTitle(
        replaceComposerContextReferences(aldoDraftPrompt, (occurrence) => occurrence.label),
      )
    : null;
  const shownTitle = aldoDraft ? (aldoDraftTitle ?? "Untitled") : activeThreadTitle;
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  // Inline rename, keyed by thread: navigating away drops an in-progress
  // rename instead of committing stale text. Cleared on thread change (not
  // just hidden) so returning to the thread doesn't revive the old draft.
  const [renaming, setRenaming] = useState<{ threadId: ThreadId; title: string } | null>(null);
  if (renaming !== null && renaming.threadId !== activeThreadId) {
    setRenaming(null);
  }
  const renamingTitle = renaming?.threadId === activeThreadId ? renaming.title : null;
  const renameCommittedRef = useRef(false);
  const startRename = useCallback(() => {
    renameCommittedRef.current = false;
    setRenaming({ threadId: activeThreadId, title: activeThreadTitle });
  }, [activeThreadId, activeThreadTitle]);
  const commitRename = useCallback(
    (title: string) => {
      setRenaming(null);
      const resolution = resolveRenameCommit({ title, originalTitle: activeThreadTitle });
      if (resolution.action === "reject-empty") {
        toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
        return;
      }
      if (resolution.action === "noop") return;
      void updateThreadMetadata({
        environmentId: activeThreadEnvironmentId,
        input: { threadId: activeThreadId, title: resolution.title },
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
    },
    [activeThreadEnvironmentId, activeThreadId, activeThreadTitle, updateThreadMetadata],
  );
  const { openMenu, closeMenu } = useThreadActionMenu({
    threadRef: isServerThread ? activeThreadRef : null,
    projectCwd: activeProjectCwd,
    onStartRename: startRename,
    onMoveThread: aldoMoves ? () => setAldoMoveOpen(true) : undefined,
  });
  const titleButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleMenuTimerRef = useRef<number | null>(null);
  const cancelPendingTitleMenu = useCallback(() => {
    if (titleMenuTimerRef.current === null) return;
    clearTimeout(titleMenuTimerRef.current);
    titleMenuTimerRef.current = null;
  }, []);
  // Drop a pending menu-open when the thread changes or the header unmounts,
  // so it can never fire for a thread the user already left.
  useEffect(
    () => () => {
      cancelPendingTitleMenu();
    },
    [activeThreadId, cancelPendingTitleMenu],
  );
  const openTitleMenuNow = useCallback(() => {
    cancelPendingTitleMenu();
    const rect = titleButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    openMenu({ x: rect.left, y: rect.bottom + 4 });
  }, [cancelPendingTitleMenu, openMenu]);
  const openMenuFromTitle = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      // The trailing click of a double-click belongs to rename, not the menu.
      if (isTrailingDoubleClick(event.detail)) return;
      // Keyboard activation and the explicit chevron affordance can never be
      // the first half of a double-click, so they open without waiting.
      const clickedChevron =
        (event.target as HTMLElement).closest("[data-thread-title-chevron]") !== null;
      if (event.detail === 0 || clickedChevron || window.desktopBridge === undefined) {
        openTitleMenuNow();
        return;
      }
      // Stay pending long enough for dblclick to cancel the open before the
      // native menu appears and swallows the second click.
      cancelPendingTitleMenu();
      titleMenuTimerRef.current = window.setTimeout(() => {
        titleMenuTimerRef.current = null;
        openTitleMenuNow();
      }, TITLE_MENU_OPEN_DELAY_MS);
    },
    [cancelPendingTitleMenu, openTitleMenuNow],
  );
  const handleTitleDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      // The chevron is the explicit menu affordance; only the title text renames.
      if ((event.target as HTMLElement).closest("[data-thread-title-chevron]") !== null) return;
      cancelPendingTitleMenu();
      closeMenu();
      startRename();
    },
    [cancelPendingTitleMenu, closeMenu, startRename],
  );
  const handleHeaderContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      if (renamingTitle !== null) return;
      // The right-side controls (git, scripts, open-in) keep their own
      // behavior; only the breadcrumb area opens the thread menu.
      if ((event.target as HTMLElement).closest("[data-chat-header-actions]")) return;
      if (!isServerThread && onOpenProjectSettings === undefined) return;
      cancelPendingTitleMenu();
      event.preventDefault();
      if (!isServerThread) {
        const api = readLocalApi();
        if (!api) return;
        void api.contextMenu
          .show([{ id: "project-settings", label: "Project settings", icon: "settings" }], {
            x: event.clientX,
            y: event.clientY,
          })
          .then((action) => {
            if (action === "project-settings") onOpenProjectSettings?.();
          });
        return;
      }
      openMenu({ x: event.clientX, y: event.clientY });
    },
    [cancelPendingTitleMenu, isServerThread, onOpenProjectSettings, openMenu, renamingTitle],
  );
  const handleRenameKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter") {
        renameCommittedRef.current = true;
        commitRename(event.currentTarget.value);
      } else if (event.key === "Escape") {
        renameCommittedRef.current = true;
        setRenaming(null);
      }
    },
    [commitRename],
  );

  const renderProjectMenu = (
    openInMenuItems: ReactNode | null,
    projectScriptMenuItems: ReactNode | null,
  ) => (
    <Menu>
      <MenuTrigger
        aria-label={`Project menu for ${activeProjectName}`}
        render={
          <button
            type="button"
            className="-mx-1 inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        {activeProject ? <ProjectFavicon project={activeProject} className="size-3.5" /> : null}
        {/* A phone keeps the title readable: the project shows as its icon. */}
        <span className="max-w-40 truncate text-sm font-medium max-sm:sr-only">
          {activeProjectName}
        </span>
        <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
      </MenuTrigger>
      <MenuPopup align="start" className="min-w-52">
        <MenuItem onClick={onNewThreadInProject}>New thread</MenuItem>
        {openInMenuItems || projectScriptMenuItems ? <MenuSeparator /> : null}
        {openInMenuItems}
        {openInMenuItems && projectScriptMenuItems ? <MenuSeparator /> : null}
        {projectScriptMenuItems}
      </MenuPopup>
    </Menu>
  );

  let projectControl: ReactNode = null;
  if (activeProjectName && aldoKeptRepo) {
    projectControl = renderProjectMenu(null, null);
  } else if (activeProjectName && activeProjectScripts) {
    projectControl = (
      <ProjectScriptsControl
        scripts={activeProjectScripts}
        fileScripts={fileScripts}
        keybindings={keybindings}
        preferredScriptId={preferredScriptId}
        onRunScript={onRunProjectScript}
        onAddScript={onAddProjectScript}
        onUpdateScript={onUpdateProjectScript}
        onDeleteScript={onDeleteProjectScript}
        renderMenuItems={(projectScriptMenuItems) =>
          showOpenInPicker ? (
            <OpenInPicker
              environmentId={activeThreadEnvironmentId}
              keybindings={keybindings}
              availableEditors={availableEditors}
              openInCwd={openInCwd}
              renderMenuItems={(openInMenuItems) =>
                renderProjectMenu(openInMenuItems, projectScriptMenuItems)
              }
            />
          ) : (
            renderProjectMenu(null, projectScriptMenuItems)
          )
        }
      />
    );
  } else if (activeProjectName && showOpenInPicker) {
    projectControl = (
      <OpenInPicker
        environmentId={activeThreadEnvironmentId}
        keybindings={keybindings}
        availableEditors={availableEditors}
        openInCwd={openInCwd}
        renderMenuItems={(openInMenuItems) => renderProjectMenu(openInMenuItems, null)}
      />
    );
  } else if (activeProject) {
    projectControl = (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <ProjectFavicon project={activeProject} className="size-3.5" />
        <span className="max-w-40 truncate text-sm font-medium text-muted-foreground max-sm:sr-only">
          {activeProjectName}
        </span>
      </span>
    );
  }

  const titleEditor =
    renamingTitle !== null ? (
      <input
        autoFocus
        aria-label="Thread title"
        className="min-w-0 flex-1 rounded-sm bg-transparent text-sm font-medium text-foreground outline-none ring-1 ring-ring/50 focus:ring-ring"
        defaultValue={renamingTitle}
        onBlur={(event) => {
          if (renameCommittedRef.current) return;
          commitRename(event.currentTarget.value);
        }}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={handleRenameKeyDown}
      />
    ) : null;
  return (
    <div
      className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 sm:gap-3"
      onContextMenu={handleHeaderContextMenu}
    >
      {aldoThread ? (
        <span ref={aldoPlaceAnchorRef} className="flex min-w-0 flex-1">
          <AldoThreadBreadcrumb
            key={`${activeThreadEnvironmentId}:${activeThreadId}`}
            title={shownTitle}
            titleEditor={titleEditor}
            place={aldoPlace}
            environmentId={activeThreadEnvironmentId}
            threadId={activeThreadId}
            onActions={
              isServerThread
                ? (button) => {
                    const rect = button.getBoundingClientRect();
                    openMenu({ x: rect.left, y: rect.bottom + 4 });
                  }
                : undefined
            }
          />
          {aldoMoves ? (
            <AldoMoveThreadPicker
              environmentId={activeThreadEnvironmentId}
              project={activeProject}
              onSendMessage={onSendAldoMessage!}
              open={aldoMoveOpen}
              onOpenChange={setAldoMoveOpen}
              anchor={aldoPlaceAnchorRef}
            />
          ) : null}
        </span>
      ) : (
        <WorkspaceBreadcrumb
          ariaLabel="Thread breadcrumb"
          className="flex-1 overflow-clip [overflow-clip-margin:2px]"
        >
          {/* The project always leads the header: knowing which project a
            thread lives in is priority zero, and the thread title alone
            doesn't answer it. */}
          {activeProject || aldoDraft ? (
            <>
              <WorkspaceBreadcrumbItem className="shrink">{projectControl}</WorkspaceBreadcrumbItem>
              <WorkspaceBreadcrumbSeparator>
                <WorkspaceBreadcrumbText>/</WorkspaceBreadcrumbText>
              </WorkspaceBreadcrumbSeparator>
            </>
          ) : null}
          <WorkspaceBreadcrumbItem current className="min-w-10 flex-1">
            {renamingTitle !== null ? (
              titleEditor
            ) : isServerThread ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      ref={titleButtonRef}
                      type="button"
                      aria-label={`Thread actions for ${activeThreadTitle}`}
                      aria-haspopup="menu"
                      onClick={openMenuFromTitle}
                      onDoubleClick={handleTitleDoubleClick}
                      onBlur={cancelPendingTitleMenu}
                      className="group/thread-title inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-sm text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  }
                >
                  <h2 className="min-w-0">
                    <WorkspaceBreadcrumbText>{activeThreadTitle}</WorkspaceBreadcrumbText>
                  </h2>
                  <ChevronDownIcon
                    aria-hidden
                    data-thread-title-chevron
                    className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/thread-title:opacity-100 group-focus-visible/thread-title:opacity-100 max-sm:hidden"
                  />
                </TooltipTrigger>
                <TooltipPopup side="top">{activeThreadTitle}</TooltipPopup>
              </Tooltip>
            ) : aldoDraft && aldoDraftTitle === null ? (
              <h2 className="min-w-0 flex-1 truncate text-muted-foreground/70 text-sm italic">
                Untitled
              </h2>
            ) : (
              <Tooltip>
                <TooltipTrigger render={<h2 aria-label={shownTitle} className="min-w-0 flex-1" />}>
                  <WorkspaceBreadcrumbText>{shownTitle}</WorkspaceBreadcrumbText>
                </TooltipTrigger>
                <TooltipPopup side="top">{shownTitle}</TooltipPopup>
              </Tooltip>
            )}
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
      )}
      <div
        ref={headerActionsRef}
        data-chat-header-actions
        className={cn(
          "flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3",
          // Reserve the right panel toggle (32px, 28px at sm) with its 1px edge inset, plus the
          // same gap the actions keep between themselves (gap-2, gap-3 at @3xl) so the toggle
          // does not sit against the last action. The page header adds 8px more right padding
          // at sm.
          rightPanelOpen ? "pr-0" : "pr-10.25 sm:pr-7.25 @3xl/header-actions:pr-8.25",
          "[[data-panel-animations=true]_&]:motion-safe:transition-[padding-right] [[data-panel-animations=true]_&]:motion-safe:duration-(--panel-animation-duration) [[data-panel-animations=true]_&]:motion-safe:ease-out",
        )}
      >
        {isAldoCloud && isAldoEnvironmentId(activeThreadEnvironmentId) && isServerThread ? (
          <AldoBrowsingChip
            environmentId={activeThreadEnvironmentId}
            threadId={activeThreadId}
            onOpenBrowser={() =>
              useRightPanelStore
                .getState()
                .open(scopeThreadRef(activeThreadEnvironmentId, activeThreadId), "workspaceBrowser")
            }
          />
        ) : null}
        {/* Nothing to preview before the thread's agent has started. */}
        {isAldoCloud && isAldoEnvironmentId(activeThreadEnvironmentId) && isServerThread ? (
          <AldoPreviewsControl
            environmentId={activeThreadEnvironmentId}
            threadId={activeThreadId}
            onOpenBrowser={() =>
              useRightPanelStore
                .getState()
                .open(scopeThreadRef(activeThreadEnvironmentId, activeThreadId), "workspaceBrowser")
            }
          />
        ) : null}
      </div>
    </div>
  );
});
