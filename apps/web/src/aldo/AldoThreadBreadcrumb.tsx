import { Link, useNavigate } from "@tanstack/react-router";
import {
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
import { aldoLayersActive, closeAldoThread } from "./layers";
import { breadcrumbProjectName, breadcrumbProjectThreads } from "./breadcrumbs.logic";
import { refreshAldoHome, useAldoHomeRead } from "./homeFeed";
import type { AldoPickedPlace } from "./AldoPlaceTile";

const crumbButton =
  "inline-flex min-h-12 min-w-12 cursor-pointer items-center justify-center gap-2 rounded-md px-2 text-muted-foreground outline-none hover:bg-accent hover:text-foreground active:bg-accent focus-visible:ring-2 focus-visible:ring-ring";

/** A project destination that reveals its name on touch and uses the account read, never waking machines. */
function ProjectThreads({
  primary,
  current,
  currentThread,
  close,
}: {
  readonly primary: string;
  readonly current: string;
  readonly currentThread: string;
  readonly close: () => void;
}) {
  const { home, error, supported } = useAldoHomeRead();
  const threads = home ? breadcrumbProjectThreads(home.conversations, primary) : [];
  return (
    <>
      <p className="mt-2 text-muted-foreground text-xs">Threads in this project</p>
      {error || supported === false ? (
        <div className="mt-3 space-y-2 text-sm">
          <p>Couldn’t load this project’s threads.</p>
          <Button size="sm" variant="outline" onClick={() => void refreshAldoHome()}>
            Try again
          </Button>
        </div>
      ) : !home ? (
        <p role="status" className="py-4 text-muted-foreground text-sm">
          Loading threads…
        </p>
      ) : threads.length === 0 ? (
        <p className="py-4 text-muted-foreground text-sm">No threads to show yet.</p>
      ) : null}
      <ul className="mt-2 max-h-80 overflow-y-auto">
        {threads.map((thread) => (
          <li key={thread.ref}>
            <Link
              to="/$environmentId/$threadId"
              params={{
                environmentId: thread.thread.environmentId as EnvironmentId,
                threadId: thread.thread.threadId as ThreadId,
              }}
              onClick={close}
              aria-current={
                thread.thread.environmentId === current && thread.thread.threadId === currentThread
                  ? "page"
                  : undefined
              }
              className="flex min-h-12 flex-col justify-center rounded-md px-2 py-2 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-accent"
            >
              <span className="wrap-anywhere">{thread.title || "Untitled thread"}</span>
              {thread.thread.environmentId === current &&
              thread.thread.threadId === currentThread ? (
                <span className="text-muted-foreground text-xs">Current thread</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Compact breadcrumbs: the project becomes a named icon on phones; full titles open on tap. */
export function AldoThreadBreadcrumb({
  title,
  place,
  environmentId,
  threadId,
  titleEditor,
  onActions,
}: {
  readonly title: string;
  readonly place: AldoPickedPlace | null;
  readonly environmentId: string;
  readonly threadId: string;
  readonly titleEditor?: ReactNode;
  readonly onActions?: ((button: HTMLButtonElement) => void) | undefined;
}) {
  const navigate = useNavigate();
  const [titleOpen, setTitleOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const primary = place?.repos[0];
  const projectName = place && primary ? breadcrumbProjectName(place.name, place.repos) : null;
  return (
    <WorkspaceBreadcrumb
      ariaLabel="Thread breadcrumb"
      className="flex-1 [&>ol]:gap-0 sm:[&>ol]:gap-1"
    >
      <WorkspaceBreadcrumbItem>
        <button
          type="button"
          aria-label="Home"
          onClick={() => {
            if (aldoLayersActive()) closeAldoThread();
            else void navigate({ to: "/" });
          }}
          className={crumbButton}
        >
          <HomeIcon aria-hidden className="size-[18px]" />
        </button>
      </WorkspaceBreadcrumbItem>
      {projectName && primary ? (
        <>
          <WorkspaceBreadcrumbSeparator>
            <ChevronRightIcon className="size-3" />
          </WorkspaceBreadcrumbSeparator>
          <WorkspaceBreadcrumbItem className="sm:shrink">
            <Popover open={projectOpen} onOpenChange={setProjectOpen}>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    aria-label={`${projectName}: show project threads`}
                    className={`${crumbButton} max-w-44`}
                  />
                }
              >
                <FolderIcon aria-hidden className="size-4 shrink-0" />
                <span className="hidden truncate text-sm sm:block">{projectName}</span>
              </PopoverTrigger>
              <PopoverPopup align="start" width="md" animateContent={false}>
                <PopoverTitle>
                  <span className="block wrap-anywhere leading-5">{projectName}</span>
                </PopoverTitle>
                {projectOpen ? (
                  <ProjectThreads
                    primary={primary}
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
      <WorkspaceBreadcrumbSeparator>
        <ChevronRightIcon className="size-3" />
      </WorkspaceBreadcrumbSeparator>
      <WorkspaceBreadcrumbItem current className="flex-1">
        {titleEditor ?? (
          <Popover open={titleOpen} onOpenChange={setTitleOpen}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label={`Read full thread title: ${title}`}
                  className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md px-2 text-left outline-none hover:bg-accent active:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                />
              }
            >
              <h2 className="line-clamp-2 min-w-0 wrap-anywhere text-sm leading-5 sm:line-clamp-1">
                {title}
              </h2>
              <ChevronDownIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
            </PopoverTrigger>
            <PopoverPopup width="md" align="start">
              <PopoverTitle>
                <span className="block wrap-anywhere leading-6">{title}</span>
              </PopoverTitle>
              {onActions ? (
                <button
                  type="button"
                  aria-label={`Thread actions for ${title}`}
                  onClick={(event) => {
                    onActions(event.currentTarget);
                    setTitleOpen(false);
                  }}
                  className={`${crumbButton} mt-2 w-full text-sm`}
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
