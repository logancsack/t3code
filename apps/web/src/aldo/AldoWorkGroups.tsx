// What a "Worked 31 min · 84 steps" row opens to (MessagesTimeline's
// work-summary row): the work in plain-word groups (workRows.logic.ts), each
// with its time and what it did, and the technical log behind a second click.

import {
  ChevronRightIcon,
  FileTextIcon,
  GlobeIcon,
  LinkIcon,
  MailIcon,
  MessageCircleQuestionIcon,
  SearchIcon,
  SparklesIcon,
  SquareTerminalIcon,
  type LucideIcon,
} from "lucide-react";
import { memo, useMemo } from "react";

import { cn } from "~/lib/utils";
import type { WorkLogEntry } from "../session-logic";
import {
  aldoDurationWords,
  aldoStepCount,
  aldoWorkGroups,
  type AldoWorkGroupKind,
} from "./workRows.logic";

const GROUP_ICON: Record<AldoWorkGroupKind, LucideIcon> = {
  research: SearchIcon,
  site: GlobeIcon,
  make: FileTextIcon,
  share: LinkIcon,
  ask: MessageCircleQuestionIcon,
  app: MailIcon,
  other: SparklesIcon,
};

export const AldoWorkGroups = memo(function AldoWorkGroups(props: {
  readonly entries: ReadonlyArray<WorkLogEntry>;
  /** When the work ended; null while it's under way. */
  readonly endedAt: string | null;
  readonly logOpen: boolean;
  readonly onToggleLog: () => void;
}) {
  const { entries, endedAt, logOpen, onToggleLog } = props;
  const groups = useMemo(() => aldoWorkGroups(entries, endedAt), [entries, endedAt]);
  const steps = useMemo(() => aldoStepCount(entries), [entries]);
  return (
    <div className="mt-1 overflow-hidden rounded-xl border border-border/60 bg-card/30">
      {groups.map((group) => {
        const Icon = GROUP_ICON[group.kind];
        return (
          <section key={group.key} className="border-b border-border/40 px-3.5 py-2.5">
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
              <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{group.title}</span>
              {group.elapsedMs !== null ? (
                <span className="ms-auto shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
                  {aldoDurationWords(group.elapsedMs)}
                </span>
              ) : null}
            </div>
            {group.items.length > 0 ? (
              <ul className="mt-1.5 list-disc space-y-0.5 ps-10 text-[13px] leading-snug text-muted-foreground">
                {group.items.map((item) => (
                  <li key={item} className="break-words">
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
      <button
        type="button"
        aria-expanded={logOpen}
        data-scroll-anchor-ignore
        onClick={onToggleLog}
        className="-mt-px flex w-full cursor-pointer items-center gap-1.5 border-t border-border/40 px-3.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
      >
        <SquareTerminalIcon aria-hidden className="size-3.5 shrink-0" />
        <span>
          {logOpen
            ? "Hide the technical log"
            : steps > 0
              ? `Show the technical log (${steps} ${steps === 1 ? "step" : "steps"})`
              : "Show the technical log"}
        </span>
        <ChevronRightIcon
          aria-hidden
          className={cn("size-3.5 shrink-0 transition-transform", logOpen && "rotate-90")}
        />
      </button>
    </div>
  );
});
