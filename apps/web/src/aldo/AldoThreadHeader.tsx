import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { EllipsisIcon } from "lucide-react";
import { useState, type ReactNode, type Ref } from "react";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { useIsMobile } from "../hooks/useMediaQuery";
import { cn } from "../lib/utils";
import { useRightPanelStore } from "../rightPanelStore";
import { AldoBrowsingChip } from "./AldoBrowsingChip";
import { AldoPreviewsControl } from "./AldoPreviewsControl";
import {
  AldoHomeButton,
  AldoThreadBreadcrumb,
  ProjectThreads,
  aldoCardRow,
  aldoThreadProject,
} from "./AldoThreadBreadcrumb";
import type { AldoPickedPlace } from "./AldoPlaceTile";
import { useAldoDeveloperTools } from "./developerTools";
import { aldoHandoffFor } from "./handoffs.logic";
import { useAldoHomeRead } from "./homeFeed";

interface ThreadProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly place: AldoPickedPlace | null;
  readonly working: boolean;
  readonly titleEditor: ReactNode;
  /** Opens the thread's actions (rename, move, pin, archive…); drafts have none. */
  readonly onActions?: ((button: HTMLElement) => void) | undefined;
}

/**
 * A phone's app bar: back to Home, then the title over its project and status.
 * The title opens everything about the thread: its full title, its actions and
 * its project's other threads.
 */
function AldoThreadAppBar(props: ThreadProps) {
  const [open, setOpen] = useState(false);
  const project = aldoThreadProject(props.place);
  const subtitle = [project?.name, props.working ? "Working" : null].filter(Boolean).join(" · ");
  const close = () => setOpen(false);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <span className="-ml-1.5 flex">
        <AldoHomeButton back />
      </span>
      {props.titleEditor ?? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label={`About this thread: ${props.title}`}
                className="flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col justify-center rounded-lg px-1.5 text-left outline-none hover:bg-accent active:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              />
            }
          >
            <h2 className="truncate font-medium text-[15px] leading-5">{props.title}</h2>
            {subtitle ? (
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs leading-4">
                {props.working ? (
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-info" />
                ) : null}
                <span className="truncate">{subtitle}</span>
              </span>
            ) : null}
          </PopoverTrigger>
          <PopoverPopup width="md" align="start" animateContent={false}>
            {open ? (
              <>
                <div className="px-2">
                  <p className="wrap-break-word font-medium text-base leading-6">{props.title}</p>
                  {props.working ? (
                    <p className="mt-1 flex items-center gap-1.5 text-muted-foreground text-xs">
                      <span aria-hidden className="size-1.5 rounded-full bg-info" />
                      Working
                    </p>
                  ) : null}
                </div>
                {props.onActions ? (
                  <button
                    type="button"
                    aria-label={`Thread actions for ${props.title}`}
                    onClick={(event) => {
                      props.onActions?.(event.currentTarget);
                      close();
                    }}
                    className={`${aldoCardRow} mt-2`}
                  >
                    <EllipsisIcon aria-hidden className="size-4 text-muted-foreground" />
                    Thread actions
                  </button>
                ) : null}
                {project ? (
                  <div className="mt-2 border-t pt-1">
                    <ProjectThreads
                      primary={project.primary}
                      current={props.environmentId}
                      currentThread={props.threadId}
                      close={close}
                      label={`Threads in ${project.name}`}
                    />
                  </div>
                ) : null}
              </>
            ) : null}
          </PopoverPopup>
        </Popover>
      )}
    </div>
  );
}

/**
 * An Aldo thread's header: the app bar on phones, the breadcrumbs on desktops,
 * then the same controls on both (Preview when there is one, one menu for the
 * rest). The right panel's own toggle stays on desktops (ChatView); phones open
 * it from the menu.
 */
export function AldoThreadHeader({
  isServerThread,
  actionsRef,
  actionsClassName,
  ...props
}: ThreadProps & {
  readonly isServerThread: boolean;
  readonly actionsRef: Ref<HTMLDivElement>;
  readonly actionsClassName: string;
}) {
  const phone = useIsMobile();
  const developer = useAldoDeveloperTools();
  const { home } = useAldoHomeRead();
  const takeover = aldoHandoffFor(home, {
    environmentId: props.environmentId,
    threadId: props.threadId,
  });
  const threadRef = scopeThreadRef(props.environmentId, props.threadId);
  const openBrowser = () => useRightPanelStore.getState().open(threadRef, "workspaceBrowser");

  const layout = (controls: { gpu: ReactNode; preview: ReactNode; tools: ReactNode }) => (
    <>
      {phone ? (
        <AldoThreadAppBar {...props} />
      ) : (
        <AldoThreadBreadcrumb
          key={`${props.environmentId}:${props.threadId}`}
          title={props.title}
          titleEditor={props.titleEditor}
          place={props.place}
          environmentId={props.environmentId}
          threadId={props.threadId}
          working={props.working}
          onActions={props.onActions}
        />
      )}
      <div
        ref={actionsRef}
        data-chat-header-actions
        // On phones the menu's icon lines up with the edge; a bordered Preview keeps the gutter.
        className={cn(
          "flex shrink-0 items-center justify-end gap-2 max-md:-mr-1.5",
          actionsClassName,
        )}
      >
        {isServerThread ? (
          <AldoBrowsingChip
            environmentId={props.environmentId}
            threadId={props.threadId}
            onOpenBrowser={openBrowser}
          />
        ) : null}
        {controls.gpu}
        {controls.preview}
        {controls.tools}
      </div>
    </>
  );

  // Nothing to preview, and no tools, before the thread's agent has started.
  if (!isServerThread) return layout({ gpu: null, preview: null, tools: null });
  return (
    <AldoPreviewsControl
      environmentId={props.environmentId}
      threadId={props.threadId}
      onOpenBrowser={openBrowser}
      workspace={
        phone
          ? {
              // Without the developer tools, the panel has no terminal or diff.
              label: developer ? "Files, terminal and changes" : "Files and more",
              open: () => useRightPanelStore.getState().toggleVisibility(threadRef),
            }
          : undefined
      }
      compactPreview={phone && takeover !== null}
    >
      {layout}
    </AldoPreviewsControl>
  );
}
