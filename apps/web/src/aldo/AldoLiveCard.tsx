// What Aldo did to a thread, shown live in its conversation: the thread as
// Aldo's home read has it now (working, waiting on the user, done), as a card
// that opens it when tapped: its title, where it works, what it last said
// and its pull requests with how their checks stand. What it asks is answered
// at the conversation's end (AldoUpNext.tsx), where its status takes the
// user. An Aldo without the home read, or a thread it doesn't list yet, shows
// the one line Aldo's action always had. The bar's peek (AldoPeek.tsx) uses
// the pieces here too.

import { CheckIcon } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";

import { PullRequestGlyph } from "../components/pullRequest/pullRequestIcons";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { cn } from "~/lib/utils";
import { mergeFollowedPullRequest, TONE_VARIANT } from "./AldoHomeBoard";
import { ThreadLink } from "./AldoHomeInbox";
import type { AldoHome, AldoHomeConversation, AldoHomePullRequest, AldoHomeTarget } from "./cloud";
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
import { FOCUS, SURFACE } from "./surface";

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

/** A pull request on a thread's card: its number and title, then its checks as they run. */
function PullRequestRow(props: { readonly pullRequest: AldoHomePullRequest }) {
  const pr = props.pullRequest;
  const checks = pr.checks;
  const total = checks ? checks.passed + checks.failed + checks.running : 0;
  return (
    <div className="flex items-center gap-2 text-[13px] text-muted-foreground leading-5">
      <PullRequestGlyph.pullRequest className="size-3.5 shrink-0" aria-hidden />
      <a
        href={pr.url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 truncate text-foreground/85 hover:underline hover:decoration-foreground/30 hover:underline-offset-4"
      >
        #{pr.number} {pr.title}
      </a>
      <span
        className={cn(
          "ml-auto shrink-0 tabular-nums",
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
  const open = useContext(AldoOpenContext);
  const arrive = useAldoArrive();
  const conversation = home?.conversations.find((c) => sameTarget(c.thread, props.target));
  if (!home || !conversation) return props.fallback;
  const c = conversation;
  const now = Date.now();
  const kind = needsYouKind(c);
  const pullRequests = pullRequestsOf(home, c.thread, now);
  const working = WORKING_STATES.has(c.state);
  const needs = cn(
    FOCUS,
    "flex items-center gap-1.5 rounded-full px-1 text-foreground/80 hover:text-foreground",
  );
  const needsYou = (
    <>
      <span aria-hidden className="size-1.5 rounded-full bg-warning" />
      Needs you
    </>
  );
  const status =
    kind === "failed" ? (
      <span className="text-destructive-foreground">Stopped</span>
    ) : kind && open ? (
      // To its card at the end; what no card answers (a thread whose computer slept) opens the thread.
      <button
        type="button"
        className={needs}
        onClick={(event) => {
          if (!showAldoDecisionOf(c.thread)) open(c.thread, event.currentTarget);
        }}
      >
        {needsYou}
      </button>
    ) : kind ? (
      <ThreadLink target={c.thread} label={`Needs you: open ${c.title}`} className={needs}>
        {needsYou}
      </ThreadLink>
    ) : working ? (
      // Long work leaves the screen still: how long it's been at it (once it's a minute) says it's going.
      <span>
        {Date.parse(c.stateAt ?? c.at) > now - 60_000
          ? "Working"
          : `Working · ${elapsed(c.stateAt ?? c.at, now)}`}
      </span>
    ) : c.state === "done" ? (
      <span className="flex items-center gap-1">
        <CheckIcon aria-hidden className="size-3.5 text-success-foreground" strokeWidth={2.25} />
        Done
      </span>
    ) : (
      <span>Idle</span>
    );
  const title = "font-medium text-[15px] leading-[22px] tracking-[-0.005em]";
  return (
    // The whole card opens the thread for a pointer; its title is the link, for a keyboard and a reader.
    <div
      {...arrive}
      data-aldo-live-card=""
      className={cn(SURFACE, "group w-full px-4 py-3.5", open && "cursor-pointer")}
      onClick={(event) => {
        // Its own links and buttons, and words being selected, keep their click.
        const target = event.target as HTMLElement;
        if (!open || target.closest("a, button") || window.getSelection()?.toString()) return;
        open(c.thread, event.currentTarget);
      }}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <ThreadLink
              target={c.thread}
              className={cn(
                FOCUS,
                title,
                "block max-w-full truncate rounded-sm text-left group-hover:underline group-hover:decoration-foreground/25 group-hover:underline-offset-4",
              )}
            >
              {c.title}
            </ThreadLink>
            <p className="truncate text-[12px] text-muted-foreground leading-[18px]">
              {c.browsing ? c.browsing.site : reposLabel(c.repos)}
            </p>
          </div>
          <span className="mt-0.5 flex shrink-0 items-center text-[12px] text-muted-foreground leading-[18px] tabular-nums">
            {status}
          </span>
        </div>
        {c.summary ? (
          <p className="line-clamp-2 text-[14px] text-muted-foreground leading-5 dark:text-foreground/70">
            {c.summary}
          </p>
        ) : null}
        {pullRequests.map((pr) => (
          <PullRequestRow key={`${pr.repo}#${pr.number}`} pullRequest={pr} />
        ))}
      </div>
    </div>
  );
}
