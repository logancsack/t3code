import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  FolderIcon,
  HomeIcon,
} from "lucide-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../components/WorkspaceBreadcrumb";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../components/ui/popover";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { aldoLayersActive, closeAldoThread } from "./layers";
import { breadcrumbProjectName, breadcrumbProjectThreads } from "./breadcrumbs.logic";
import { refreshAldoHome, useAldoHomeRead } from "./homeFeed";
import { aldoHeaderControl } from "./AldoPreviewsControl";
import type { AldoPickedPlace } from "./AldoPlaceTile";

/** A crumb: a 32px pill with a pointer. */
const crumbButton = cn(aldoHeaderControl, "h-8 min-w-8 gap-2 rounded-md px-2");

/** A full-width row in a thread card or sheet. */
export const aldoCardRow =
  "flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-md px-2 text-left text-sm outline-none hover:bg-accent active:bg-accent focus-visible:ring-2 focus-visible:ring-ring md:min-h-9";

/** The project a thread works in, named for people ("Aldo", not "aldo + t3code"). */
export function aldoThreadProject(
  place: AldoPickedPlace | null,
): { readonly name: string; readonly primary: string } | null {
  const primary = place?.repos[0];
  return place && primary
    ? { name: breadcrumbProjectName(place.name, place.repos), primary }
    : null;
}

/**
 * Home is the floor: a thread lies over it, so going home closes the thread as
 * Back does. `back` is the phone's app bar arrow: 36px, 48px to touch.
 */
export function AldoHomeButton({ back = false }: { readonly back?: boolean }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      aria-label="Home"
      onClick={() => {
        if (aldoLayersActive()) closeAldoThread();
        else void navigate({ to: "/" });
      }}
      className={back ? `${aldoHeaderControl} size-9` : crumbButton}
    >
      {back ? (
        <ArrowLeftIcon aria-hidden className="size-5" />
      ) : (
        <HomeIcon aria-hidden className="size-[18px]" />
      )}
    </button>
  );
}

/** Says a thread's agent is working: a still dot (nothing repaints) and words for screen readers. */
function AldoWorkingDot() {
  return (
    <span className="flex size-1.5 shrink-0 rounded-full bg-info">
      <span className="sr-only">Working</span>
    </span>
  );
}

/** A project's threads, from the account's Home read (never wakes machines). */
export function ProjectThreads({
  primary,
  current,
  currentThread,
  close,
  label = "Threads in this project",
}: {
  readonly primary: string;
  readonly current: string;
  readonly currentThread: string;
  readonly close: () => void;
  readonly label?: string;
}) {
  const { home, error, supported } = useAldoHomeRead();
  const threads = home ? breadcrumbProjectThreads(home.conversations, primary) : [];
  return (
    <>
      <p className="mt-2 px-2 text-muted-foreground text-xs">{label}</p>
      {error || supported === false ? (
        <div className="mt-3 space-y-2 px-2 text-sm">
          <p>Couldn’t load this project’s threads.</p>
          <Button size="sm" variant="outline" onClick={() => void refreshAldoHome()}>
            Try again
          </Button>
        </div>
      ) : !home ? (
        <p role="status" className="px-2 py-4 text-muted-foreground text-sm">
          Loading threads…
        </p>
      ) : threads.length === 0 ? (
        <p className="px-2 py-4 text-muted-foreground text-sm">No threads to show yet.</p>
      ) : null}
      <ul className="mt-1 max-h-80 overflow-y-auto">
        {threads.map((thread) => {
          const here =
            thread.thread.environmentId === current && thread.thread.threadId === currentThread;
          return (
            <li key={thread.ref}>
              <Link
                to="/$environmentId/$threadId"
                params={{
                  environmentId: thread.thread.environmentId as EnvironmentId,
                  threadId: thread.thread.threadId as ThreadId,
                }}
                onClick={close}
                aria-current={here ? "page" : undefined}
                className="flex min-h-12 flex-col justify-center rounded-md px-2 py-2 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-accent md:min-h-9"
              >
                <span className="wrap-break-word">{thread.title || "Untitled thread"}</span>
                {here ? (
                  <span className="text-muted-foreground text-xs">Current thread</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * Home › project › thread in one row, for desktops (phones get the app bar in
 * AldoThreadHeader). The title is the row's only flexible part, so it keeps
 * its room.
 */
export function AldoThreadBreadcrumb({
  title,
  place,
  environmentId,
  threadId,
  titleEditor,
  working = false,
  onActions,
}: {
  readonly title: string;
  readonly place: AldoPickedPlace | null;
  readonly environmentId: string;
  readonly threadId: string;
  readonly titleEditor?: ReactNode;
  readonly working?: boolean;
  readonly onActions?: ((button: HTMLButtonElement) => void) | undefined;
}) {
  const [titleOpen, setTitleOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const project = aldoThreadProject(place);
  const separator = (
    <WorkspaceBreadcrumbSeparator className="text-muted-foreground/50">
      <ChevronRightIcon className="size-3.5" />
    </WorkspaceBreadcrumbSeparator>
  );
  return (
    <WorkspaceBreadcrumb ariaLabel="Thread breadcrumb" className="min-w-0 flex-1 [&>ol]:gap-1">
      <WorkspaceBreadcrumbItem>
        <AldoHomeButton />
      </WorkspaceBreadcrumbItem>
      {project ? (
        <>
          {separator}
          <WorkspaceBreadcrumbItem className="shrink">
            <Popover open={projectOpen} onOpenChange={setProjectOpen}>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    aria-label={`${project.name}: show project threads`}
                    className={`${crumbButton} max-w-44`}
                  />
                }
              >
                <FolderIcon aria-hidden className="size-4 shrink-0" />
                <span className="truncate text-sm">{project.name}</span>
              </PopoverTrigger>
              <PopoverPopup align="start" width="md" animateContent={false}>
                <PopoverTitle>
                  <span className="block wrap-break-word px-2 leading-5">{project.name}</span>
                </PopoverTitle>
                {projectOpen ? (
                  <ProjectThreads
                    primary={project.primary}
                    current={environmentId}
                    currentThread={threadId}
                    close={() => setProjectOpen(false)}
                  />
                ) : null}
              </PopoverPopup>
            </Popover>
          </WorkspaceBreadcrumbItem>
        </>
      ) : null}
      {separator}
      <WorkspaceBreadcrumbItem current className="min-w-16 flex-1">
        {titleEditor ?? (
          <Popover open={titleOpen} onOpenChange={setTitleOpen}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label={`Read full thread title: ${title}`}
                  className="flex min-h-8 min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-left outline-none hover:bg-accent active:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                />
              }
            >
              {working ? <AldoWorkingDot /> : null}
              <h2 className="line-clamp-1 min-w-0 wrap-break-word text-sm leading-[18px]">
                {title}
              </h2>
              <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            </PopoverTrigger>
            <PopoverPopup width="md" align="start">
              <PopoverTitle>
                <span className="block wrap-break-word px-2 leading-6">{title}</span>
              </PopoverTitle>
              {onActions ? (
                <button
                  type="button"
                  aria-label={`Thread actions for ${title}`}
                  onClick={(event) => {
                    onActions(event.currentTarget);
                    setTitleOpen(false);
                  }}
                  className={`${aldoCardRow} mt-2`}
                >
                  <EllipsisIcon aria-hidden className="size-4" />
                  Thread actions
                </button>
              ) : null}
            </PopoverPopup>
          </Popover>
        )}
      </WorkspaceBreadcrumbItem>
    </WorkspaceBreadcrumb>
  );
}
