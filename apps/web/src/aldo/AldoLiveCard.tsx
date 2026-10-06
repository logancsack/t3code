// What Aldo did to a thread, shown live in its conversation (and in the peek):
// the thread as Aldo's home read has it now (working, waiting on the user,
// done), what it last said, what it asks (answered in place), its pull
// requests (merged in place once green), and the ways to peek at it or open
// it. An Aldo without the home read, or a thread it doesn't list yet, shows
// the one line Aldo's action always had.

import { ArrowUpRightIcon, EyeIcon, GitPullRequestIcon } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { cn } from "~/lib/utils";
import { mergeFollowedPullRequest, TONE_VARIANT } from "./AldoHomeBoard";
import { PendingForm, ThreadLink } from "./AldoHomeInbox";
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
      <GitPullRequestIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
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
  return (
    <div
      className={cn(
        "flex w-full flex-col gap-1.5 rounded-xl border bg-card/40 p-3",
        kind ? "border-warning/50" : "border-border/60",
      )}
      data-aldo-live-card=""
    >
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <StateDot conversation={c} now={now} />
        <span className="truncate">
          {props.label} · {reposLabel(c.repos)}
        </span>
        <span className="ml-auto shrink-0">{stateSince(c, now)}</span>
      </div>
      <ThreadLink
        target={c.thread}
        className="min-w-0 truncate font-medium text-sm hover:underline"
      >
        {c.title}
      </ThreadLink>
      {c.summary && kind !== "approval" && kind !== "question" ? (
        <p className="line-clamp-2 text-muted-foreground text-xs">{c.summary}</p>
      ) : null}
      {kind ? (
        <div className="mt-1">
          <PendingForm conversation={c} onActed={() => void refreshAldoHome()} />
        </div>
      ) : null}
      {pullRequests.map((pr) => (
        <PullRequestLine key={`${pr.repo}#${pr.number}`} pullRequest={pr} />
      ))}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {peek ? (
          <Button size="compact" variant="outline" onClick={() => peek(c.thread)}>
            <EyeIcon />
            Peek
          </Button>
        ) : null}
        <Button size="compact" variant="ghost" render={<ThreadLink target={c.thread} />}>
          Open thread
          <ArrowUpRightIcon />
        </Button>
      </div>
    </div>
  );
}
