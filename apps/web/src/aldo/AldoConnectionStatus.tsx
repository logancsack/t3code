// How a connection that stopped working says so, once, on its own row: a dot
// and what happened (since when, where Aldo knows), beside its Reconnect.

import type { ReactNode } from "react";

/** "Oct 19" for an ISO time, or null for one that isn't. */
function shortDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function AldoBrokenStatus(props: {
  /** When it stopped (ISO), where Aldo says. */
  readonly since?: string | undefined;
  /** What the service said, if anything. */
  readonly children?: ReactNode;
}) {
  const since = shortDate(props.since);
  return (
    <span className="inline-flex items-start gap-1.5 text-warning-foreground">
      <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" />
      <span>
        {since
          ? `Stopped working ${since}, so agents can’t use it`
          : "Stopped working, so agents can’t use it"}
        {props.children ? <span className="text-muted-foreground">. {props.children}</span> : null}
      </span>
    </span>
  );
}
