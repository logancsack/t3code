// What Aldo adds around the sidebar's thread list: rows standing in while its
// directory hasn't listed the threads yet, and the way to archived ones.

import { Link } from "@tanstack/react-router";
import { ArchiveIcon } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";

import { Skeleton } from "../components/ui/skeleton";
import { isAldoCloud } from "./api";
import { getAldoEnvironments, subscribeAldoEnvironments } from "./directory";
import { aldoThreadsSynced, subscribeAldoThreadsSynced } from "./shells";

/** No rows yet is loading, not "No threads yet", until the directory and this page's copies are current. */
export function useAldoThreadsLoading(): boolean {
  const listed = useSyncExternalStore(
    subscribeAldoEnvironments,
    () => {
      const environments = getAldoEnvironments();
      return environments === null ? null : environments.length > 0;
    },
    () => null,
  );
  const synced = useSyncExternalStore(subscribeAldoThreadsSynced, aldoThreadsSynced, () => false);
  return isAldoCloud && (listed === null || (listed && !synced));
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
