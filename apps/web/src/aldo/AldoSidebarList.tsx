// What Aldo adds around the sidebar's thread list: rows standing in while its
// directory hasn't listed the threads yet, and the way to archived ones.

import { Link } from "@tanstack/react-router";
import { ArchiveIcon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import { Skeleton } from "../components/ui/skeleton";
import { isAldoCloud } from "./api";
import { getAldoEnvironments, subscribeAldoEnvironments } from "./directory";
import {
  aldoThreadsLoadState,
  subscribeAldoThreadsSynced,
  type AldoThreadsLoadState,
} from "./shells";

/** No rows yet is loading, not "No threads yet", until the directory and this page's copies are current. */
export function useAldoThreadsState(): AldoThreadsLoadState {
  const listed = useSyncExternalStore(
    subscribeAldoEnvironments,
    () => {
      const environments = getAldoEnvironments();
      return environments === null ? null : environments.length > 0;
    },
    () => null,
  );
  const state = useSyncExternalStore(
    subscribeAldoThreadsSynced,
    aldoThreadsLoadState,
    () => "loading" as const,
  );
  const [overdue, setOverdue] = useState(false);
  const loading = isAldoCloud && (listed === null || (listed && state === "loading"));
  // A blocked local cache must offer recovery even when no request can finish.
  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => setOverdue(true), 15_000);
    return () => window.clearTimeout(timer);
  }, [loading]);
  if (!isAldoCloud || listed === false) return "ready";
  return loading ? (overdue ? "error" : "loading") : state;
}

export function AldoSidebarThreadsError() {
  return (
    <div
      role="status"
      className="flex flex-col gap-2 px-2.5 py-3 text-xs text-sidebar-muted-foreground"
    >
      <p>Some threads couldn’t load.</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="w-fit cursor-pointer rounded-md border border-sidebar-border px-3 py-2 hover:bg-sidebar-row-hover focus-visible:outline-2 focus-visible:outline-ring"
      >
        Retry
      </button>
    </div>
  );
}

export function AldoSidebarThreadsSkeleton() {
  return (
    <ul role="status" aria-label="Loading threads">
      <SkeletonRow title={<Skeleton className="h-3 w-4/5" />} />
      <SkeletonRow title={<Skeleton className="h-3 w-3/5" />} />
      <SkeletonRow title={<Skeleton className="h-3 w-2/3" />} />
    </ul>
  );
}

function SkeletonRow(props: { title: ReactNode }) {
  return (
    <li className="flex h-[4.875rem] flex-col justify-center gap-3 px-2.5">
      <Skeleton className="h-2.5 w-2/5" />
      {props.title}
    </li>
  );
}

export function AldoArchivedThreadsLink() {
  return (
    <Link
      to="/settings/archived"
      className="mt-1 flex h-8 items-center gap-2.5 rounded-md px-2.5 text-xs text-sidebar-muted-foreground/70 outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArchiveIcon aria-hidden className="size-3.5 shrink-0" />
      Archived threads
    </Link>
  );
}
