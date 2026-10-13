// The Library: what agents made and shared. In a thread that isn't code it's
// a right-panel tab: the files its turns made, each opening beside the thread,
// and what it shared by link. Settings → Shared files lists everything the
// user's agents shared. A shared one says who can open it, and can be copied,
// opened, or stopped (its link stops working at once). Grouping and labels are
// in library.logic.ts.

import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import {
  CheckIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LibraryBigIcon,
  LinkIcon,
  LoaderCircleIcon,
  LockIcon,
  Share2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { SettingsSection } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { toastManager } from "../components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
import { useRightPanelStore } from "../rightPanelStore";
import type { WorkLogEntry } from "../session-logic";
import type { TurnDiffSummary } from "../types";
import { AldoMadeThumb, aldoAskToShare } from "./AldoMadeCards";
import {
  AldoApiError,
  fetchAldoShares,
  getAldoEnvironments,
  stopAldoShare,
  subscribeAldoEnvironments,
} from "./cloud";
import {
  aldoLibraryGroups,
  aldoShareAudience,
  aldoShareItem,
  aldoShareProject,
  aldoShareViews,
  aldoThreadLibrary,
  type AldoLibraryItem,
  type AldoShareView,
} from "./library.logic";
import { ALDO_MADE_KIND_LABEL } from "./made.logic";
import { formatMailSize } from "./mail.logic";
import { aldoSharesByTurn } from "./workLabels.logic";

/** Aldo lists this many shares at most. */
const MOST_LISTED = 200;

/** Shares from other threads shown in a thread's Library, where Aldo can't say which are its own. */
const ELSEWHERE_SHOWN = 8;

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/**
 * Aldo's list of shares: undefined until read, null from an Aldo without one.
 * Read again when `key` changes (a turn ended, a share was made) and when the
 * window comes back into focus.
 */
function useAldoShares(key: string) {
  const [shares, setShares] = useState<ReadonlyArray<AldoShareView> | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // Only the latest read's answer shows.
  const latest = useRef(0);
  const refresh = useCallback(() => {
    const request = ++latest.current;
    fetchAldoShares()
      .then((next) => {
        if (request !== latest.current) return;
        setShares(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (request === latest.current) setError(messageOf(cause));
      });
  }, []);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  useEffect(() => {
    refresh();
  }, [key, refresh]);
  const removed = useCallback((id: string) => {
    // A read already on its way may predate the removal.
    latest.current += 1;
    setShares((current) => (current ? current.filter((share) => share.id !== id) : current));
  }, []);
  return { shares, error, refresh, removed };
}

function AudienceBadge(props: { readonly share: AldoShareView }) {
  const audience = aldoShareAudience(props.share);
  const Icon = props.share.public ? GlobeIcon : LockIcon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 font-medium text-[11px]",
              props.share.public
                ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                : "bg-muted text-muted-foreground",
            )}
          />
        }
      >
        <Icon className="size-3" />
        {audience.label}
      </TooltipTrigger>
      <TooltipPopup>{audience.detail}</TooltipPopup>
    </Tooltip>
  );
}

function CopyLinkButton(props: { readonly url: string; readonly className: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={cn(props.className, "inline-flex items-center gap-1")}
      onClick={() => {
        void navigator.clipboard?.writeText(props.url).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <CheckIcon className="size-3.5" /> : <LinkIcon className="size-3.5" />}
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

/** One thing in the Library: open it (beside the thread, when it's a file there), and its share's actions. */
function LibraryRow(props: {
  readonly item: AldoLibraryItem;
  readonly threadRef: ScopedThreadRef | null;
  readonly workspaceRoot: string | undefined;
  /** Where it came from, on the full list. */
  readonly place?: { readonly label: string; readonly threadRef: ScopedThreadRef | null } | null;
  readonly onStopped: (id: string) => void;
}) {
  const { item, threadRef, place } = props;
  const share = item.share;
  const url = share?.url ?? item.url;
  const [confirming, setConfirming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const canOpen = item.path !== null && threadRef !== null;
  const open = () => {
    if (item.path && threadRef) useRightPanelStore.getState().openFile(threadRef, item.path);
  };
  const stop = async () => {
    if (!share) return;
    setStopping(true);
    try {
      await stopAldoShare(share.id);
      props.onStopped(share.id);
      toastManager.add({ type: "success", title: `Stopped sharing ${share.title}` });
    } catch (cause) {
      // Already stopped (another tab, or the agent): it's gone either way.
      if (cause instanceof AldoApiError && cause.status === 404) props.onStopped(share.id);
      else {
        toastManager.add({
          type: "error",
          title: "Couldn't stop sharing",
          description: messageOf(cause),
        });
      }
    } finally {
      setStopping(false);
      setConfirming(false);
    }
  };
  const kindLabel = item.kind ? ALDO_MADE_KIND_LABEL[item.kind] : "File";
  const detail = [
    item.fileName ?? kindLabel,
    share && share.bytes > 0 ? formatMailSize(share.bytes) : null,
    share ? aldoShareViews(share.views) : null,
    item.shared && !url ? "Shared" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const action = "rounded-md px-1.5 py-0.5 font-medium text-primary hover:bg-accent";
  return (
    <li className="rounded-xl border border-border/60 bg-card/30 p-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default"
          disabled={!canOpen}
          onClick={open}
          aria-label={canOpen ? `Open ${item.name}` : undefined}
        >
          <AldoMadeThumb
            kind={item.kind}
            path={item.path}
            threadRef={threadRef}
            workspaceRoot={props.workspaceRoot}
          />
          <span className="min-w-0">
            <span className="block truncate font-medium text-sm">{item.name}</span>
            <span className="block truncate text-muted-foreground text-xs">{detail}</span>
          </span>
        </button>
        {share ? <AudienceBadge share={share} /> : null}
      </div>
      {confirming && share ? (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2 text-xs">
          <span className="me-auto text-muted-foreground">Its link stops working at once.</span>
          <Button
            size="xs"
            variant="ghost"
            disabled={stopping}
            onClick={() => setConfirming(false)}
          >
            Keep
          </Button>
          <Button size="xs" variant="destructive" disabled={stopping} onClick={() => void stop()}>
            {stopping ? <LoaderCircleIcon className="animate-spin" /> : null}
            Stop sharing
          </Button>
        </div>
      ) : url || (threadRef && item.path && !item.shared) || place ? (
        <div className="mt-1 flex flex-wrap items-center gap-0.5 ps-12 text-xs">
          {place ? (
            <span className="me-1 min-w-0 truncate text-muted-foreground">
              {place.threadRef ? (
                <Link
                  to="/$environmentId/$threadId"
                  params={{
                    environmentId: place.threadRef.environmentId as EnvironmentId,
                    threadId: place.threadRef.threadId as ThreadId,
                  }}
                  className="hover:text-foreground hover:underline"
                >
                  {place.label}
                </Link>
              ) : (
                place.label
              )}
            </span>
          ) : null}
          {url ? (
            <>
              <CopyLinkButton url={url} className={action} />
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(action, "inline-flex items-center gap-1")}
              >
                <ExternalLinkIcon className="size-3.5" />
                Open link
              </a>
            </>
          ) : threadRef && item.path && !item.shared ? (
            <button
              type="button"
              className={action}
              onClick={() => aldoAskToShare(threadRef, item.path!)}
              aria-label={`Ask the agent to share ${item.name} by link`}
            >
              Share
            </button>
          ) : null}
          {share ? (
            <button
              type="button"
              className="rounded-md px-1.5 py-0.5 font-medium text-muted-foreground hover:bg-accent hover:text-destructive-foreground"
              onClick={() => setConfirming(true)}
            >
              Stop sharing
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function LibraryGroups(props: {
  readonly items: ReadonlyArray<AldoLibraryItem>;
  readonly threadRef: ScopedThreadRef | null;
  readonly workspaceRoot: string | undefined;
  readonly placeOf?: (item: AldoLibraryItem) => {
    readonly label: string;
    readonly threadRef: ScopedThreadRef | null;
  } | null;
  readonly onStopped: (id: string) => void;
}) {
  const groups = useMemo(
    () => aldoLibraryGroups(props.items, (item) => item.at, new Date()),
    [props.items],
  );
  return (
    <>
      {groups.map((group) => (
        <section key={group.when} aria-label={group.label}>
          <h3 className="mb-1.5 px-1 font-medium text-muted-foreground text-xs">{group.label}</h3>
          <ul className="flex flex-col gap-2">
            {group.items.map((item) => (
              <LibraryRow
                key={item.key}
                item={item}
                threadRef={props.threadRef}
                workspaceRoot={props.workspaceRoot}
                place={props.placeOf?.(item) ?? null}
                onStopped={props.onStopped}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function AllSharedLink(props: { readonly label: string }) {
  return (
    <Link
      to="/settings/shared"
      className="inline-flex items-center gap-0.5 px-1 text-muted-foreground text-xs hover:text-foreground"
    >
      {props.label}
      <ChevronRightIcon className="size-3.5" />
    </Link>
  );
}

const NO_CHECKPOINTS: ReadonlyArray<TurnDiffSummary> = [];

/** The right panel's Library, for a thread that isn't code. */
export function AldoLibraryPanel(props: {
  readonly threadRef: ScopedThreadRef;
  readonly checkpoints: ReadonlyArray<TurnDiffSummary> | undefined;
  readonly workLogEntries: ReadonlyArray<WorkLogEntry>;
  readonly workspaceRoot: string | undefined;
}) {
  const checkpoints = props.checkpoints ?? NO_CHECKPOINTS;
  const sharesByTurn = useMemo(
    () => new Map(aldoSharesByTurn(props.workLogEntries)),
    [props.workLogEntries],
  );
  const recorded = [...sharesByTurn.values()].reduce((sum, list) => sum + list.length, 0);
  // A turn that ends, or a share made, is worth reading Aldo's list again.
  const { shares, error, refresh, removed } = useAldoShares(`${checkpoints.length}:${recorded}`);
  const library = useMemo(
    () =>
      aldoThreadLibrary({
        turns: checkpoints,
        sharesByTurn,
        workspaceRoot: props.workspaceRoot,
        shares: shares ?? null,
        environmentId: props.threadRef.environmentId,
      }),
    [checkpoints, sharesByTurn, props.workspaceRoot, shares, props.threadRef.environmentId],
  );
  const elsewhere = useMemo(
    () => library.elsewhere.slice(0, ELSEWHERE_SHOWN).map(aldoShareItem),
    [library.elsewhere],
  );
  const empty = library.items.length === 0 && elsewhere.length === 0;
  if (empty && shares === undefined && !error) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (empty && !error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <LibraryBigIcon aria-hidden className="size-6 text-muted-foreground/60" />
        <p className="font-medium text-sm">Nothing yet</p>
        <p className="max-w-60 text-muted-foreground text-xs">
          What the agent makes and shares here shows up in this list: sheets, documents, decks,
          PDFs, images and pages.
        </p>
        {shares ? <AllSharedLink label="Everything your agents shared" /> : null}
      </div>
    );
  }
  return (
    <ScrollArea className="h-full min-h-0">
      <div className="flex flex-col gap-4 p-3">
        {error && shares === undefined ? (
          <p className="px-1 text-muted-foreground text-xs">
            Couldn't read what's shared: {error}{" "}
            <button type="button" className="font-medium text-primary" onClick={refresh}>
              Try again
            </button>
          </p>
        ) : null}
        <LibraryGroups
          items={library.items}
          threadRef={props.threadRef}
          workspaceRoot={props.workspaceRoot}
          onStopped={removed}
        />
        {elsewhere.length > 0 ? (
          <section aria-label="Shared by your agents">
            <h3 className="mb-1.5 px-1 font-medium text-muted-foreground text-xs">
              Shared by your agents
            </h3>
            <ul className="flex flex-col gap-2">
              {elsewhere.map((item) => (
                <LibraryRow
                  key={item.key}
                  item={item}
                  threadRef={null}
                  workspaceRoot={undefined}
                  onStopped={removed}
                />
              ))}
            </ul>
          </section>
        ) : null}
        {shares ? <AllSharedLink label="Everything your agents shared" /> : null}
      </div>
    </ScrollArea>
  );
}

/** A thread's place in the directory, by its computer, to link to it. */
function useThreadOf(): (environmentId: string | undefined) => {
  readonly label: string;
  readonly threadRef: ScopedThreadRef;
} | null {
  const environments = useSyncExternalStore(
    subscribeAldoEnvironments,
    getAldoEnvironments,
    () => null,
  );
  return useCallback(
    (environmentId) => {
      const environment = environmentId
        ? environments?.find((entry) => entry.environmentId === environmentId)
        : undefined;
      return environment
        ? {
            label: environment.label,
            threadRef: {
              environmentId: environment.environmentId as EnvironmentId,
              threadId: environment.threadId as ThreadId,
            },
          }
        : null;
    },
    [environments],
  );
}

/** Settings → Shared files: everything the user's agents shared, by when, and where from where Aldo says. */
export function AldoSharedFilesPanel() {
  const { shares, error, removed } = useAldoShares("");
  const threadOf = useThreadOf();
  const [project, setProject] = useState<string | null>(null);
  const projects = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const share of shares ?? []) {
      const place = aldoShareProject(share.repos);
      if (place && !byKey.has(place.key)) byKey.set(place.key, place.label);
    }
    return [...byKey].map(([key, label]) => ({ key, label }));
  }, [shares]);
  const items = useMemo(
    () =>
      (shares ?? [])
        .filter((share) => project === null || aldoShareProject(share.repos)?.key === project)
        .map(aldoShareItem),
    [shares, project],
  );
  const placeOf = useCallback(
    (item: AldoLibraryItem) => {
      const thread = threadOf(item.share?.environmentId);
      const where = aldoShareProject(item.share?.repos)?.label;
      const label = [...new Set([where, thread?.label].filter(Boolean))].join(" · ");
      return label ? { label, threadRef: thread?.threadRef ?? null } : null;
    },
    [threadOf],
  );
  return (
    <SettingsSection title="Shared files" icon={<Share2Icon className="size-4" />}>
      <p className="px-3 text-muted-foreground text-sm sm:px-4">
        Pages and files your agents shared by link, newest first. A public link opens for anyone who
        has it; one only you can open asks for your Aldo sign-in. Stop sharing turns its link off at
        once and deletes the shared copy; the agent's own file stays where it is.
      </p>
      {shares === null ? (
        <p className="px-3 text-muted-foreground text-sm sm:px-4">
          This Aldo server doesn't list shared files yet.
        </p>
      ) : null}
      {error ? <p className="px-3 text-destructive-foreground text-sm sm:px-4">{error}</p> : null}
      {shares === undefined && !error ? (
        <LoaderCircleIcon className="mx-4 size-4 animate-spin text-muted-foreground" />
      ) : null}
      {shares && shares.length === 0 ? (
        <p className="px-3 text-muted-foreground text-sm sm:px-4">
          Nothing shared yet. When an agent shares a page or a file by link, it shows up here.
        </p>
      ) : null}
      {projects.length > 1 ? (
        <div
          className="flex flex-wrap gap-1.5 px-3 sm:px-4"
          role="group"
          aria-label="Where it came from"
        >
          {[{ key: null, label: "All" }, ...projects].map((entry) => (
            <Button
              key={entry.key ?? "all"}
              size="xs"
              variant={project === entry.key ? "outline" : "ghost-muted"}
              aria-pressed={project === entry.key}
              onClick={() => setProject(entry.key)}
            >
              {entry.label}
            </Button>
          ))}
        </div>
      ) : null}
      {items.length > 0 ? (
        <div className="flex flex-col gap-4 px-3 pt-1 sm:px-4">
          <LibraryGroups
            items={items}
            threadRef={null}
            workspaceRoot={undefined}
            placeOf={placeOf}
            onStopped={removed}
          />
          {shares && shares.length >= MOST_LISTED ? (
            <p className="px-1 text-muted-foreground text-xs">The {MOST_LISTED} most recent.</p>
          ) : null}
        </div>
      ) : null}
    </SettingsSection>
  );
}
