// The home screen's "Now" strip: what's waiting on the user and what's
// running, pinned above Aldo's conversation so nothing scrolls out of sight
// (home.logic.ts nowItems). Each one peeks at its thread, or its approval.

import { GitPullRequestIcon, MailIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import type { AldoPeekTarget } from "./AldoPeek";
import { nowDetail, type NowItem } from "./home.logic";

function peekOf(item: NowItem): AldoPeekTarget | null {
  switch (item.kind) {
    case "approval":
      return { kind: "approval", id: item.approval.id };
    case "merge":
      return item.pullRequest.thread ? { kind: "thread", target: item.pullRequest.thread } : null;
    default:
      return { kind: "thread", target: item.conversation.thread };
  }
}

function nameOf(item: NowItem): string {
  switch (item.kind) {
    case "approval":
      return item.approval.title;
    case "merge":
      return `#${item.pullRequest.number} ${item.pullRequest.title}`;
    default:
      return item.conversation.title;
  }
}

export function AldoNowStrip(props: {
  readonly items: ReadonlyArray<NowItem>;
  readonly now: number;
  /** The item peeked at now, marked. */
  readonly active: string | null;
  readonly onPeek: (peek: AldoPeekTarget, key: string) => void;
  readonly className?: string;
}) {
  if (props.items.length === 0) return null;
  return (
    <nav
      aria-label="Now"
      className={cn("flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]", props.className)}
    >
      {props.items.map((item) => {
        const peek = peekOf(item);
        return (
          <button
            key={item.key}
            type="button"
            disabled={!peek}
            aria-pressed={props.active === item.key}
            className={cn(
              "flex h-9 max-w-72 shrink-0 items-center gap-2 rounded-lg border border-border/70 bg-card/60 px-2.5 text-xs transition-colors hover:bg-accent",
              props.active === item.key && "border-primary/50 bg-primary/5",
            )}
            onClick={() => (peek ? props.onPeek(peek, item.key) : undefined)}
          >
            {item.kind === "approval" ? (
              <MailIcon className="size-3.5 shrink-0 text-warning-foreground" aria-hidden />
            ) : item.kind === "merge" ? (
              <GitPullRequestIcon
                className="size-3.5 shrink-0 text-success-foreground"
                aria-hidden
              />
            ) : (
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  item.kind === "needs" ? "bg-warning" : "animate-pulse bg-primary",
                )}
              />
            )}
            <span className="min-w-0 truncate font-medium text-foreground">{nameOf(item)}</span>
            <span className="shrink-0 text-muted-foreground">{nowDetail(item, props.now)}</span>
          </button>
        );
      })}
    </nav>
  );
}
