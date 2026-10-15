// What Aldo did to a thread, shown live in its conversation (and in the peek):
// the thread as Aldo's home read has it now (working, waiting on the user,
// done) as an agent's status card: what it last said, its pull requests
// (merged in place once green), and the ways to peek at it or open it. What
// it asks is answered at the conversation's end (AldoUpNext.tsx). An Aldo without the home read, or a thread it doesn't list yet, shows
// the one line Aldo's action always had.

import { ArrowUpRightIcon, EyeIcon, FolderGit2Icon, GlobeIcon, SparklesIcon } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";

import { PullRequestGlyph } from "../components/pullRequest/pullRequestIcons";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { cn } from "~/lib/utils";
import { mergeFollowedPullRequest, TONE_VARIANT } from "./AldoHomeBoard";
import { ThreadLink } from "./AldoHomeInbox";
import type { AldoHome, AldoHomeConversation, AldoHomePullRequest, AldoHomeTarget } from "./cloud";
import { refreshAldoHome, useAldoHomeFeed } from "./homeFeed";
import {
  elapsed,
  isStuck,
  needsYouKind,
  relativeTime,
  sameTarget,
  shipLaneOf,
  stageLabel,
  stageTone,
  WORKING_STATES,
} from "./home.logic";

/** Peeks at a thread beside Aldo's conversation (the home screen gives it); absent elsewhere. */
export const AldoPeekContext = createContext<((target: AldoHomeTarget) => void) | null>(null);

/** Where a conversation's repositories are, in a word: "aldo", "aldo + t3code", or General. */
export function reposLabel(repos: ReadonlyArray<string>): string {
  return repos.length === 0 ? "General" : repos.map((r) => r.split("/").at(-1) ?? r).join(" + ");
}

/** A conversation's pull requests that are still going, or shipped lately. */
export function pullRequestsOf(
  home: AldoHome,
  target: AldoHomeTarget,
  now: number,
): ReadonlyArray<AldoHomePullRequest> {
  return home.pullRequests.filter(
    (pr) => sameTarget(pr.thread, target) && shipLaneOf(pr, now) !== null,
  );
}

/** The dot that says how a conversation stands. */
export function StateDot(props: {
  readonly conversation: AldoHomeConversation;
  readonly now: number;
  readonly className?: string;
}) {
  const c = props.conversation;
  const kind = needsYouKind(c);
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        kind === "failed"
          ? "bg-destructive"
          : kind || isStuck(c, props.now)
            ? "bg-warning"
            : WORKING_STATES.has(c.state)
              ? "animate-pulse bg-primary"
              : c.state === "done"
                ? "bg-success"
                : "bg-muted-foreground/50",
        props.className,
      )}
    />
  );
}

/** How long it's been at what it's doing: "for 4 min", "waiting 12 min", "finished 1 h ago". */
export function stateSince(c: AldoHomeConversation, now: number): string {
  if (needsYouKind(c)) return `waiting ${elapsed(c.at, now)}`;
  if (c.state === "done") return `finished ${relativeTime(c.at, now)}`;
  return `for ${elapsed(c.at, now)}`;
}

/** A pull request, its stage, and Merge once it's green. */
export function PullRequestLine(props: { readonly pullRequest: AldoHomePullRequest }) {
  const pr = props.pullRequest;
  const [merging, setMerging] = useState(false);
  const mergeable = pr.status === "watching" && pr.stage === "green";
  return (
    <div className="flex items-center gap-2 text-xs">
      <PullRequestGlyph.pullRequest
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <a
        href={pr.url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 truncate text-foreground/90 hover:underline"
      >
        #{pr.number} {pr.title}
      </a>
      <Badge variant={TONE_VARIANT[stageTone(pr)]} size="sm" className="shrink-0">
        {stageLabel(pr)}
      </Badge>
      {mergeable ? (
        <Button
          size="compact"
          className="ml-auto shrink-0"
          disabled={merging}
          onClick={() =>
            void mergeFollowedPullRequest(pr, () => setMerging(true)).then((merged) => {
              setMerging(false);
              if (merged) void refreshAldoHome();
            })
          }
        >
          {merging ? "Merging…" : "Merge"}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A thread Aldo acted on, live. `label` says what Aldo did ("Started a
 * thread"); `fallback` is the line shown when the home read doesn't have it.
 */
export function AldoThreadCard(props: {
  readonly target: AldoHomeTarget;
  readonly label: string;
  readonly fallback: ReactNode;
}) {
  const home = useAldoHomeFeed((s) => s.home);
  const peek = useContext(AldoPeekContext);
  const conversation = home?.conversations.find((c) => sameTarget(c.thread, props.target));
  if (!home || !conversation) return props.fallback;
  const c = conversation;
  const now = Date.now();
  const kind = needsYouKind(c);
  const pullRequests = pullRequestsOf(home, c.thread, now);
  const [tone, status] =
    kind === "failed"
      ? ["bg-destructive/10 text-destructive-foreground", "Stopped"]
      : kind
        ? ["bg-warning/12 text-warning-foreground", "Needs you"]
        : WORKING_STATES.has(c.state)
          ? ["bg-primary/10 text-primary", "Working"]
          : c.state === "done"
            ? ["bg-success/12 text-success-foreground", "Done"]
            : ["bg-muted text-muted-foreground", "Idle"];
  // What it asks is answered at the conversation's end (AldoUpNext.tsx), not here too.
  return (
    <div
      data-aldo-arrive=""
      className="flex w-full flex-col gap-2.5 self-start rounded-[22px] bg-card p-3.5 sm:max-w-[88%] shadow-black/5 shadow-sm ring-1 ring-border/50 dark:bg-white/[0.06] dark:shadow-none dark:ring-0"
      data-aldo-live-card=""
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-black/[0.05] dark:bg-white/[0.07]"
        >
          {c.browsing ? (
            <GlobeIcon className="size-4 text-foreground/70" />
          ) : c.repos.length > 0 ? (
            <FolderGit2Icon className="size-4 text-foreground/70" />
          ) : (
            <SparklesIcon className="size-4 text-foreground/70" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <ThreadLink
            target={c.thread}
            className="block truncate font-medium text-[15px] leading-snug hover:underline"
          >
            {c.title}
          </ThreadLink>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
            <span
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-full px-2 py-px font-medium text-[11px]",
                tone,
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full bg-current",
                  status === "Working" && "animate-pulse",
                )}
              />
              {status}
              {status === "Working" ? ` · ${elapsed(c.stateAt ?? c.at, now)}` : null}
            </span>
            <span className="truncate">
              {props.label} · {c.browsing ? c.browsing.site : reposLabel(c.repos)}
            </span>
          </p>
        </div>
      </div>
      {c.summary && kind !== "approval" ? (
        <p className="line-clamp-2 text-muted-foreground text-sm">{c.summary}</p>
      ) : null}
      {pullRequests.map((pr) => (
        <PullRequestLine key={`${pr.repo}#${pr.number}`} pullRequest={pr} />
      ))}
      <div className="flex gap-2">
        {peek ? (
          <button
            type="button"
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-black/[0.05] font-medium text-sm hover:bg-black/[0.08] dark:bg-white/[0.07] dark:hover:bg-white/[0.11]"
            onClick={() => peek(c.thread)}
          >
            <EyeIcon className="size-4" />
            Peek
          </button>
        ) : null}
        <ThreadLink
          target={c.thread}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-black/[0.05] font-medium text-sm hover:bg-black/[0.08] dark:bg-white/[0.07] dark:hover:bg-white/[0.11]"
        >
          Open
          <ArrowUpRightIcon className="size-4" />
        </ThreadLink>
      </div>
    </div>
  );
}
