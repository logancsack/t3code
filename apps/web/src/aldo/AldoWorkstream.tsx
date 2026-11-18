// A thread as Aldo mentions it, wherever it does (a reply's label in
// AldoAssistant.tsx, the brief's groups in AldoBrief.tsx): the glyph for where
// it stands (a hand when it needs the user, a dot in a ring while it works,
// still, since work runs for hours; a check once it's done, a clock while
// it's put off), and a tap that opens it, in place where the page can
// (AldoOpenContext), else by its link.

import { Link, useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { CircleCheckIcon, CircleDotIcon, ClockIcon, HandIcon } from "lucide-react";
import { useContext, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { AldoOpenContext } from "./AldoLiveCard";
import type { AldoOpenTarget } from "./assistant.logic";
import type { WorkstreamState } from "./workstream.logic";

export function WorkstreamGlyph(props: {
  readonly state: WorkstreamState;
  readonly className?: string;
}) {
  const className = cn("size-3.5", props.className);
  if (props.state === "needs")
    return <HandIcon className={cn(className, "text-warning-foreground")} strokeWidth={2} />;
  if (props.state === "working")
    return <CircleDotIcon className={cn(className, "text-primary")} strokeWidth={2} />;
  if (props.state === "done")
    return <CircleCheckIcon className={cn(className, "text-success-foreground")} strokeWidth={2} />;
  return <ClockIcon className={cn(className, "text-muted-foreground")} strokeWidth={2} />;
}

export function threadLink(target: AldoOpenTarget, children: ReactNode, className?: string) {
  return (
    <Link
      to="/$environmentId/$threadId"
      params={{
        environmentId: target.environmentId as EnvironmentId,
        threadId: target.threadId as ThreadId,
      }}
      className={className}
    >
      {children}
    </Link>
  );
}

/**
 * The whole of `children` as one target that opens the thread: a button that
 * opens it in place where the page can, else its link. `onOpen` may take the
 * tap first (true when it did), as a decision's card does for what it asks.
 */
export function OpenThread(props: {
  readonly target: AldoOpenTarget;
  readonly className?: string;
  readonly children: ReactNode;
  readonly onOpen?: () => boolean;
}) {
  const open = useContext(AldoOpenContext);
  const navigate = useNavigate();
  if (!open && !props.onOpen) return threadLink(props.target, props.children, props.className);
  return (
    <button
      type="button"
      className={props.className}
      onClick={(event) => {
        if (props.onOpen?.()) return;
        if (open) open(props.target, event.currentTarget);
        else
          void navigate({
            to: "/$environmentId/$threadId",
            params: {
              environmentId: props.target.environmentId as EnvironmentId,
              threadId: props.target.threadId as ThreadId,
            },
          });
      }}
    >
      {props.children}
    </button>
  );
}
