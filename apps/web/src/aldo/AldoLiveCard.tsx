// What Aldo did to a thread, shown live in its conversation: the thread as
// Aldo's home read has it now (working, waiting on the user, done), as a card
// that opens it when tapped: its title, where it works, what it last said
// and its pull requests with how their checks stand. What it asks is answered
// at the conversation's end (AldoUpNext.tsx), where its status takes the
// user. An Aldo without the home read, or a thread it doesn't list yet, shows
// the one line Aldo's action always had. The bar's peek (AldoPeek.tsx) uses
// the pieces here too.

import { createContext, useContext, useState, type ReactNode } from "react";

import { PullRequestGlyph } from "../components/pullRequest/pullRequestIcons";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { ContinueButton } from "./AldoContinue";
import { cn } from "~/lib/utils";
import { mergeFollowedPullRequest, TONE_VARIANT } from "./AldoHomeBoard";
import { askAldoAbout, ThreadLink } from "./AldoHomeInbox";
import {
  type AldoHome,
  type AldoHomeConversation,
  type AldoHomePullRequest,
  type AldoHomeTarget,
} from "./homeApi";
import { useAldoArrive } from "./arrive";
import { refreshAldoHome, useAldoHomeFeed } from "./homeFeed";
import { showAldoDecisionOf } from "./show";
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
import { FOCUS, INSET, PRIMARY, SURFACE } from "./surface";
import { stalledOf, threadCardOf } from "./threadCard.logic";

/**
 * Opens a thread Aldo's conversation shows (the home screen and the bar give
 * it), growing out of `from` where it can; absent elsewhere.
 */
export const AldoOpenContext = createContext<
  ((target: AldoHomeTarget, from?: HTMLElement | null) => void) | null
>(null);

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
  return `for ${elapsed(c.stateAt ?? c.at, now)}`;
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

/** A pull request on a thread's card: its number and title, then its checks as they run. */
function PullRequestRow(props: { readonly pullRequest: AldoHomePullRequest }) {
  const pr = props.pullRequest;
  const checks = pr.checks;
  const total = checks ? checks.passed + checks.failed + checks.running : 0;
  return (
    <div className="flex items-start gap-2 text-[13px] text-muted-foreground leading-5">
      <PullRequestGlyph.pullRequest className="mt-[3px] size-3.5 shrink-0" aria-hidden />
      <a
        href={pr.url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 break-words text-foreground/85 hover:underline hover:decoration-foreground/30 hover:underline-offset-4"
      >
        #{pr.number} {pr.title}
      </a>
      <span
        className={cn(
          "shrink-0 tabular-nums",
          checks && checks.failed > 0 && "text-destructive-foreground",
        )}
      >
        {checks && total > 0 && pr.status === "watching" && pr.stage !== "green"
          ? checks.failed > 0
            ? `${checks.failed} failing`
            : `${checks.passed}/${total} checks`
          : stageLabel(pr)}
      </span>
    </div>
  );
}

const DOT = {
  working: "bg-primary",
  quiet: "bg-muted-foreground/50",
  done: "bg-success",
  attention: "bg-warning",
  problem: "bg-destructive",
} as const;

const TONE = {
  quiet: "",
  attention: "border-warning/40 bg-warning-surface",
  problem: "border-destructive/35 bg-destructive/[0.04]",
} as const;

const STATUS_TEXT = {
  quiet: "text-muted-foreground",
  attention: "text-warning-foreground",
  problem: "text-destructive-foreground",
} as const;

/**
 * A thread Aldo acted on, live: where it stands in a few plain words, what it
 * last said, its pull requests, and the one thing to do about it (carry it on
 * when it paused, go to what it asks, ask Aldo about a failure). `label` says
 * what Aldo did ("Started a thread"); `fallback` is the line shown when the
 * home read doesn't have it.
 */
export function AldoThreadCard(props: {
  readonly target: AldoHomeTarget;
  readonly label: string;
  readonly fallback: ReactNode;
}) {
  const home = useAldoHomeFeed((s) => s.home);
  const open = useContext(AldoOpenContext);
  const arrive = useAldoArrive();
  const conversation = home?.conversations.find((c) => sameTarget(c.thread, props.target));
  if (!home || !conversation) return props.fallback;
  const c = conversation;
  const now = Date.now();
  const view = threadCardOf(home, c, now);
  const stalled = stalledOf(home, c, now);
  const kind = needsYouKind(c);
  const pullRequests = pullRequestsOf(home, c.thread, now);
  const text = view.body ?? c.summary;
  const title = "font-medium text-[15px] leading-[22px] tracking-[-0.005em]";
  const toWhatItAsks =
    kind === "plan"
      ? "Review the plan"
      : kind === "waiting" || kind === "handoff"
        ? "Open it"
        : "Answer below";
  return (
    // The whole card opens the thread for a pointer; its title is the link, for a keyboard and a reader.
    <div
      {...arrive}
      data-aldo-live-card=""
      className={cn(SURFACE, TONE[view.tone], "group w-full px-4 py-3.5", open && "cursor-pointer")}
      onClick={(event) => {
        // Its own links and buttons, and words being selected, keep their click.
        const target = event.target as HTMLElement;
        if (!open || target.closest("a, button") || window.getSelection()?.toString()) return;
        open(c.thread, event.currentTarget);
      }}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[12px] leading-[18px]">
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[view.dot])} />
          <span className={cn("min-w-0 flex-1 font-semibold", STATUS_TEXT[view.tone])}>
            {view.status}
          </span>
        </div>
        <div className="min-w-0">
          <ThreadLink
            target={c.thread}
            className={cn(
              FOCUS,
              title,
              "line-clamp-2 break-words rounded-sm text-left group-hover:underline group-hover:decoration-foreground/25 group-hover:underline-offset-4",
            )}
          >
            {c.title}
          </ThreadLink>
          <p className="break-words text-[12px] text-muted-foreground leading-[18px]">
            {c.browsing ? c.browsing.site : reposLabel(c.repos)}
          </p>
        </div>
        {text ? (
          <p className="line-clamp-3 break-words text-[14px] text-muted-foreground leading-5 dark:text-foreground/70">
            {text}
          </p>
        ) : null}
        {view.quote ? (
          <blockquote className={cn(INSET, "break-words text-[14px] leading-5")}>
            {view.quote}
          </blockquote>
        ) : null}
        {pullRequests.map((pr) => (
          <PullRequestRow key={`${pr.repo}#${pr.number}`} pullRequest={pr} />
        ))}
        {view.action === "continue" || view.action === "fix" ? (
          <ContinueButton conversation={c} blocked={stalled?.blocked} />
        ) : view.action === "ask" ? (
          <button
            type="button"
            className={cn(PRIMARY, "w-full")}
            onClick={() => askAldoAbout(c.title)}
          >
            Ask Aldo about it
          </button>
        ) : view.action === "show" ? (
          open ? (
            <button
              type="button"
              className={cn(PRIMARY, "w-full")}
              // To its card at the end; what no card answers opens the thread.
              onClick={(event) => {
                if (!showAldoDecisionOf(c.thread)) open(c.thread, event.currentTarget);
              }}
            >
              {toWhatItAsks}
            </button>
          ) : (
            <ThreadLink target={c.thread} className={cn(PRIMARY, "w-full")}>
              Open it
            </ThreadLink>
          )
        ) : null}
      </div>
    </div>
  );
}
