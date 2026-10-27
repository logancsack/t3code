// A thread, live in Aldo's conversation: one card that changes in place as the
// thread works (its title, then the step it's on in one line, and beside it
// what its browser, the Windows computer or the GPU computer shows), opening
// where it is to where it works, what it last said, its pull requests and the
// way into the thread. What it asks is answered at the conversation's end
// (AldoUpNext.tsx), where its status takes the user. Finished, it settles into
// a line. An Aldo without the home read, or a thread it doesn't list yet,
// shows the one line Aldo's action always had. The bar's peek (AldoPeek.tsx)
// uses the pieces here too.

import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

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
import { AldoLiveView } from "./AldoLiveView";
import { useAldoArrive } from "./arrive";
import { refreshAldoHome, useAldoHomeFeed } from "./homeFeed";
import { useAldoLiveNow, useAldoLiveWork } from "./liveWork";
import {
  liveLineOf,
  liveLineTime,
  planWords,
  renderLeft,
  type AldoLiveSurface,
  type AldoLiveWork,
} from "./liveWork.logic";
import { revealAldoCard, SHOW_ALDO_THREAD, showAldoDecisionOf } from "./show";
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
import { FOCUS, INSET, PRIMARY, SECONDARY, SURFACE } from "./surface";
import { clockAt, stalledOf, threadCardOf } from "./threadCard.logic";

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

/** What there is to watch of a thread's work: its browser, the Windows computer, or a render on the GPU computer. */
function surfaceOf(c: AldoHomeConversation, work: AldoLiveWork | null): AldoLiveSurface | null {
  if (work?.surface) return work.surface;
  if (c.browsing) return "browser";
  const using = c.computers?.find((computer) => computer.status === "running");
  return using?.computer === "windows" || using?.computer === "gpu" ? using.computer : null;
}

const WATCHING: Record<AldoLiveSurface, string> = {
  browser: "Its browser",
  windows: "The Windows computer's screen",
  gpu: "The GPU computer's latest frame",
};

/** The live line, its time ticking on its own, coming in as it changes; the time never cut off. */
function LiveLine(props: { readonly work: AldoLiveWork }) {
  const now = useAldoLiveNow();
  const line = liveLineOf(props.work, now);
  if (!line) return null;
  const time = liveLineTime(line, now);
  return (
    <span key={line.text} className="flex min-w-0" data-aldo-live-line="">
      <span className="truncate">{line.text}</span>
      {time ? <span className="shrink-0 whitespace-pre tabular-nums">{` · ${time}`}</span> : null}
    </span>
  );
}

/** A thread that's finished, settled where its card was: a line, as finished work is everywhere in the conversation. */
function SettledRow(props: { readonly conversation: AldoHomeConversation; readonly now: number }) {
  const open = useContext(AldoOpenContext);
  const c = props.conversation;
  const className = cn(
    FOCUS,
    "group flex min-h-10 w-full max-w-[94%] items-center gap-2.5 self-start rounded-md text-left text-[14px] text-muted-foreground leading-5 sm:min-h-8",
  );
  const body = (
    <>
      <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center">
        <CheckIcon className="size-4 text-success-foreground" strokeWidth={2.25} />
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground/85 group-hover:underline group-hover:decoration-foreground/30 group-hover:underline-offset-4">
        <span className="sr-only">Finished: </span>
        {c.title}
      </span>
      <span className="shrink-0 text-[12px] tabular-nums">
        {clockAt(c.stateAt ?? c.at, props.now)}
      </span>
    </>
  );
  const key = `${c.thread.environmentId}:${c.thread.threadId}`;
  return open ? (
    <button
      type="button"
      className={className}
      data-aldo-live-card=""
      data-aldo-thread-card={key}
      onClick={(event) => open(c.thread, event.currentTarget)}
    >
      {body}
    </button>
  ) : (
    <ThreadLink target={c.thread} className={className}>
      {body}
    </ThreadLink>
  );
}

/**
 * A thread, live, as one card that changes in place: its title and, while it
 * works, the step it's on in one line ("Running tests"), with what it's doing
 * in its browser, on the Windows computer or on the GPU computer beside it.
 * Opened, it shows that large, where the thread works, what it last said, its
 * pull requests and the way into it. What needs the user (a question, a
 * failure, a stall) says so with the one thing to do, opened or not. Once it's
 * finished it settles into a line. `label` says what Aldo did ("Started a
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
  const work = useAldoLiveWork(props.target);
  const [opened, setOpened] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const key = `${props.target.environmentId}:${props.target.threadId}`;
  // Taken to from the status drop-down: open where it is, then into view.
  useEffect(() => {
    const onShow = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== key || !card.current) return;
      event.preventDefault();
      setOpened(true);
      const element = card.current;
      requestAnimationFrame(() => requestAnimationFrame(() => revealAldoCard(element)));
    };
    window.addEventListener(SHOW_ALDO_THREAD, onShow);
    return () => window.removeEventListener(SHOW_ALDO_THREAD, onShow);
  }, [key]);
  const conversation = home?.conversations.find((c) => sameTarget(c.thread, props.target));
  if (!home || !conversation) return props.fallback;
  const c = conversation;
  const now = Date.now();
  if (c.state === "done") return <SettledRow conversation={c} now={now} />;
  const view = threadCardOf(home, c, now);
  const stalled = stalledOf(home, c, now);
  const kind = needsYouKind(c);
  // A step is live only while the thread works: what needs the user, or has stalled, says that instead.
  const live = c.state === "working" && view.dot === "working" ? work : null;
  const line = live ? liveLineOf(live, now) : null;
  const surface = live || c.state === "working" ? surfaceOf(c, live) : null;
  const render = live?.render ?? null;
  const progress = render?.frames ? (render.frame - 1) / render.frames : null;
  const pullRequests = pullRequestsOf(home, c.thread, now);
  // What it asks has its own card where it came up (AldoUpNext.tsx): this one says so in its line.
  const answeredThere = kind !== null && kind !== "paused";
  const asks = view.tone !== "quiet" && !answeredThere;
  const text = view.body ?? c.summary;
  const toWhatItAsks =
    kind === "plan"
      ? "Review the plan"
      : kind === "waiting" || kind === "handoff"
        ? "Open it"
        : "Answer below";
  const where = live?.site ?? c.browsing?.site ?? null;
  const computer =
    surface === "windows" || surface === "gpu"
      ? c.computers?.find((one) => one.computer === surface && one.status === "running")
      : undefined;
  const details = [
    planWords(live?.plan ?? null),
    render ? renderLeft(render.leftMs) : null,
    computer
      ? `${surface === "gpu" ? "GPU" : "Windows"} computer, ${computer.creditsPerHour} credits an hour`
      : null,
    where ?? (c.repos.length > 0 ? reposLabel(c.repos) : null),
  ].filter(Boolean);
  const action =
    view.action === "continue" || view.action === "fix" ? (
      <ContinueButton conversation={c} blocked={stalled?.blocked} />
    ) : view.action === "ask" ? (
      <button type="button" className={cn(PRIMARY, "w-full")} onClick={() => askAldoAbout(c.title)}>
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
    ) : null;
  return (
    <div
      {...arrive}
      ref={card}
      data-aldo-live-card=""
      data-aldo-thread-card={key}
      className={cn(SURFACE, TONE[view.tone], "w-full outline-none")}
    >
      <button
        type="button"
        aria-expanded={opened}
        className={cn(FOCUS, "flex w-full items-center gap-3 rounded-[20px] px-4 py-3 text-left")}
        onClick={() => setOpened((v) => !v)}
      >
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 block break-words font-medium text-[15px] leading-[22px] tracking-[-0.005em]">
            {c.title}
          </span>
          <span
            className={cn(
              "flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px]",
              STATUS_TEXT[view.tone],
              view.tone !== "quiet" && "font-medium",
            )}
          >
            <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT[view.dot])} />
            {line && live ? (
              <LiveLine work={live} />
            ) : (
              <span className="block truncate">{view.status}</span>
            )}
          </span>
        </span>
        {surface && !opened ? (
          <AldoLiveView
            target={c.thread}
            surface={surface}
            open={false}
            progress={progress}
            label={`${WATCHING[surface]}${where ? `, on ${where}` : ""}`}
          />
        ) : (
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
              opened && "rotate-180",
            )}
            strokeWidth={1.75}
          />
        )}
      </button>
      {opened || asks ? (
        <div className="flex flex-col gap-2.5 px-4 pb-3.5">
          {opened && surface ? (
            <AldoLiveView
              target={c.thread}
              surface={surface}
              open
              progress={progress}
              label={`${WATCHING[surface]}${where ? `, on ${where}` : ""}`}
            />
          ) : null}
          {opened && details.length > 0 ? (
            <p className="text-[12px] text-muted-foreground leading-[18px] tabular-nums">
              {details.join(" · ")}
            </p>
          ) : null}
          {text && (opened || asks) ? (
            <p
              className={cn(
                "break-words text-[14px] text-muted-foreground leading-5 dark:text-foreground/70",
                opened ? "line-clamp-4" : "line-clamp-2",
              )}
            >
              {text}
            </p>
          ) : null}
          {view.quote ? (
            <blockquote className={cn(INSET, "break-words text-[14px] leading-5")}>
              {view.quote}
            </blockquote>
          ) : null}
          {opened
            ? pullRequests.map((pr) => (
                <PullRequestRow key={`${pr.repo}#${pr.number}`} pullRequest={pr} />
              ))
            : null}
          {asks || opened ? action : null}
          {opened ? (
            open ? (
              <button
                type="button"
                className={cn(SECONDARY, "w-full")}
                onClick={(event) => open(c.thread, event.currentTarget)}
              >
                Open the thread
              </button>
            ) : (
              <ThreadLink target={c.thread} className={cn(SECONDARY, "w-full")}>
                Open the thread
              </ThreadLink>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
