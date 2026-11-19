// A finished result opened in place (AldoFinished.tsx): its receipt, with what
// to do about it. Loaded when one is first opened, so the home screen's first
// load doesn't carry it.

import {
  AlertCircleIcon,
  ArrowUpRightIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleDashedIcon,
  ClockIcon,
  LoaderCircleIcon,
  PauseIcon,
  RotateCwIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { PullRequestGlyph } from "../components/pullRequest/pullRequestIcons";
import { cn } from "~/lib/utils";
import { confirmQuickChoice } from "./AldoBrief";
import { askAldoAbout, ThreadLink } from "./AldoHomeInbox";
import { ResultGlyph } from "./AldoResultMark";
import { decideAldoOutcome } from "./decide";
import { type AldoDecision } from "./decisions.logic";
import {
  checksLine,
  followupsLine,
  mergeWords,
  pullRequestState,
  type AldoFinishedResult,
} from "./finished.logic";
import { elapsed } from "./home.logic";
import { type AldoHomePullRequest } from "./homeApi";
import { refreshAldoHome } from "./homeFeed";
import { setAldoMergeHold } from "./mergeHold";
import { completeAldo } from "./presenceReactions";
import { FOCUS, ICON_BUTTON, PRIMARY, SECONDARY, SURFACE } from "./surface";
import AldoTaskResult from "./AldoTaskResult";

/** A pull request's page on its host, at its checks or its changes (GitHub's tabs; elsewhere, the page). */
function pullRequestPage(url: string, tab: "checks" | "files"): string {
  return /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(url)
    ? `${url.replace(/\/$/, "")}/${tab}`
    : url;
}

/** A result opened: its receipt, with what to do about it. */
export default function ResultCard(props: {
  readonly result: AldoFinishedResult;
  readonly now: number;
  readonly onClose: () => void;
}) {
  const r = props.result;
  const c = r.conversation;
  const pr = r.state.pullRequest ?? r.pullRequests[0]!;
  const card = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState<"merge" | "hold" | null>(null);
  useEffect(() => {
    // Opened, focus goes to it, so a keyboard carries on from there.
    card.current?.focus({ preventScroll: true });
  }, []);
  const ago = elapsed(r.at, props.now);
  const who = (
    <>
      <span className="truncate">
        {pr.repo.split("/").at(-1)} #{pr.number}
      </span>
      <span aria-hidden>·</span>
      <span className="shrink-0 tabular-nums">
        finished {ago === "just now" ? ago : `${ago} ago`}
      </span>
    </>
  );
  const merge = async () => {
    const decision: AldoDecision = {
      kind: "merge",
      key: `merge:${pr.repo}#${pr.number}`,
      pullRequest: pr,
    };
    if (!(await confirmQuickChoice(decision, { kind: "merge" }))) return;
    setBusy("merge");
    const { outcome } = await decideAldoOutcome(decision, { kind: "merge" });
    setBusy(null);
    if (outcome === "done") {
      completeAldo();
      void refreshAldoHome();
    }
  };
  const hold = async () => {
    setBusy("hold");
    await setAldoMergeHold(pr, true);
    setBusy(null);
  };
  const failing = r.state.tone === "failing";
  const checks = checksLine(pr.checks);
  const followups = followupsLine(pr.followups);
  const total = pr.checks ? pr.checks.passed + pr.checks.failed + pr.checks.running : 0;
  const evidence: ReadonlyArray<{
    readonly key: string;
    readonly icon: ReactNode;
    readonly text: ReactNode;
    readonly className?: string;
  }> = [
    ...(r.pullRequests.length > 1
      ? r.pullRequests.map((p) => {
          const state = pullRequestState(p, props.now);
          return {
            key: `pr:${p.repo}#${p.number}`,
            icon: <ResultGlyph state={state} className="size-[15px]" />,
            text: (
              <>
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground/85 underline decoration-foreground/25 underline-offset-4 hover:decoration-foreground/60"
                >
                  #{p.number} {p.title}
                </a>
                <span className="text-muted-foreground"> · {state.words}</span>
              </>
            ),
          };
        })
      : [
          {
            key: "pr",
            icon: (
              <PullRequestGlyph.pullRequest
                aria-hidden
                className="size-[15px] text-muted-foreground"
                strokeWidth={1.75}
              />
            ),
            text: (
              <>
                #{pr.number} {pr.title}
                {/* Its changes are a button below, except beside the checks that failed. */}
                {failing ? (
                  <span className="text-muted-foreground">
                    {" · "}
                    <a
                      href={pullRequestPage(pr.url, "files")}
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground/85 underline decoration-foreground/25 underline-offset-4 hover:decoration-foreground/60"
                    >
                      View changes
                    </a>
                  </span>
                ) : null}
              </>
            ),
          },
        ]),
    ...(checks && !failing && r.pullRequests.length === 1
      ? [
          {
            key: "checks",
            icon:
              pr.checks!.running > 0 ? (
                <CircleDashedIcon aria-hidden className="size-[15px]" strokeWidth={1.75} />
              ) : (
                <CheckIcon
                  aria-hidden
                  className="size-[15px] text-success-foreground"
                  strokeWidth={2.25}
                />
              ),
            text: checks,
            ...(pr.checks!.running === 0 ? { className: "text-success-foreground" } : {}),
          },
        ]
      : []),
    ...(followups
      ? [
          {
            key: "followups",
            icon: <RotateCwIcon aria-hidden className="size-[15px]" strokeWidth={1.75} />,
            text: followups,
          },
        ]
      : []),
  ];
  return (
    <article
      ref={card}
      tabIndex={-1}
      aria-label={c.title}
      className={cn(SURFACE, FOCUS, "flex w-full flex-col gap-3.5 p-4 sm:p-5")}
      data-aldo-finished-result={r.key}
      onKeyDown={(event) => {
        if (event.key === "Escape" && event.target === event.currentTarget) props.onClose();
      }}
    >
      <header className="flex flex-col gap-1.5">
        <div className="-my-1 flex min-h-8 items-center gap-2">
          <ResultGlyph state={r.state} />
          <ThreadLink
            target={c.thread}
            className={cn(
              FOCUS,
              "flex min-w-0 items-center gap-1.5 rounded-md text-[12px] text-muted-foreground leading-[18px] hover:text-foreground",
            )}
          >
            {who}
          </ThreadLink>
          <span className="ml-auto flex items-center">
            <button
              type="button"
              aria-label="Close"
              aria-expanded
              className={ICON_BUTTON}
              onClick={props.onClose}
            >
              <ChevronDownIcon aria-hidden className="size-4 rotate-180" strokeWidth={1.75} />
            </button>
            <span className="-me-1.5">
              <ThreadLink target={c.thread} className={ICON_BUTTON} label="Open the thread">
                <ArrowUpRightIcon className="size-4" strokeWidth={1.75} />
              </ThreadLink>
            </span>
          </span>
        </div>
        <h4 className="text-balance font-semibold text-[16px] leading-[22px] tracking-[-0.01em]">
          {c.title}
        </h4>
      </header>
      {failing ? (
        <div className="flex items-start gap-2.5 rounded-xl bg-warning/8 px-3 py-2.5 text-[13px] text-warning-foreground leading-5">
          <AlertCircleIcon aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 flex-1">
            {pr.stage === "deploy-failed"
              ? "It merged, and its deploy failed."
              : pr.checks && pr.checks.failed > 0 && total > 0
                ? `${pr.checks.failed} of ${total} checks fail.`
                : "Its checks fail."}
          </span>
        </div>
      ) : null}
      {c.summary ? (
        <p className="line-clamp-4 text-[14px] text-muted-foreground leading-6 dark:text-foreground/70">
          {c.summary}
        </p>
      ) : null}
      {c.result ? <AldoTaskResult result={c.result} compact /> : null}
      <ul className="flex flex-col gap-2 text-[13px] leading-5">
        {evidence.map((item) => (
          <li key={item.key} className="flex items-start gap-2.5">
            <span
              aria-hidden
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground",
                item.className,
              )}
            >
              {item.icon}
            </span>
            <span className={cn("min-w-0 flex-1 text-foreground/80", item.className)}>
              {item.text}
            </span>
          </li>
        ))}
      </ul>
      {r.state.tone === "merging" && pr.mergesAt ? (
        <MergeComing pr={pr} now={props.now} busy={busy === "hold"} onHold={() => void hold()} />
      ) : null}
      {pr.held ? (
        <div className="flex min-h-11 items-center gap-2.5 rounded-xl bg-foreground/[0.045] py-1.5 ps-3 pe-1.5 text-[13px] text-foreground/80 leading-5 dark:bg-white/[0.05]">
          <PauseIcon
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
          />
          <span className="min-w-0 flex-1">You held Aldo's merge, so it waits for yours.</span>
          <button
            type="button"
            disabled={busy !== null}
            className={cn(
              FOCUS,
              "inline-flex h-11 shrink-0 items-center rounded-full bg-foreground/[0.08] px-4 font-medium text-[14px] text-foreground transition-colors hover:bg-foreground/[0.12] disabled:opacity-50",
            )}
            onClick={() => void setAldoMergeHold(pr, false)}
          >
            Let Aldo merge it
          </button>
        </div>
      ) : null}
      <Actions result={r} pr={pr} busy={busy} onMerge={() => void merge()} />
    </article>
  );
}

/** The merge Aldo makes on its own: when, and Hold (from an Aldo that can hold one). */
function MergeComing(props: {
  readonly pr: AldoHomePullRequest;
  readonly now: number;
  readonly busy: boolean;
  readonly onHold: () => void;
}) {
  const { pr } = props;
  const words = mergeWords(pr.mergesAt!, props.now);
  // "Aldo merges it in 9 min", or "at 3:24 PM"; past that, it waits for the agent to be idle.
  const when =
    words === "Merging"
      ? "Aldo merges it as soon as its agent is idle"
      : `Aldo merges it ${words.replace(/^Merges /, "")}`;
  return (
    <div className="flex min-h-11 items-center gap-2.5 rounded-xl bg-foreground/[0.045] py-1.5 ps-3 pe-1.5 text-[13px] text-foreground/80 leading-5 dark:bg-white/[0.05]">
      <ClockIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 tabular-nums">
        {when}
        {pr.held === undefined ? "." : ", unless you hold it."}
      </span>
      {pr.held === undefined ? null : (
        <button
          type="button"
          disabled={props.busy}
          className={cn(
            FOCUS,
            "inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-foreground/[0.08] px-4 font-medium text-[14px] text-foreground transition-colors hover:bg-foreground/[0.12] disabled:opacity-50",
          )}
          onClick={props.onHold}
        >
          {props.busy ? (
            <LoaderCircleIcon aria-hidden className="size-3.5 animate-spin" strokeWidth={1.75} />
          ) : (
            <PauseIcon aria-hidden className="size-3.5" strokeWidth={1.75} />
          )}
          Hold
        </button>
      )}
    </div>
  );
}

/** What to do about it: the one thing first-weighted, a look at it beside. */
function Actions(props: {
  readonly result: AldoFinishedResult;
  readonly pr: AldoHomePullRequest;
  readonly busy: "merge" | "hold" | null;
  readonly onMerge: () => void;
}) {
  const { pr } = props;
  const tone = props.result.state.tone;
  const title = props.result.conversation.title;
  const look = (tab: "checks" | "files", label: string) => (
    <a href={pullRequestPage(pr.url, tab)} target="_blank" rel="noreferrer" className={SECONDARY}>
      {label}
      <ArrowUpRightIcon aria-hidden className="-me-1 size-4" strokeWidth={1.75} />
    </a>
  );
  if (tone === "merging" || tone === "yours")
    return (
      <div className="grid grid-cols-2 gap-2">
        {look("files", "View changes")}
        <button
          type="button"
          className={PRIMARY}
          disabled={props.busy !== null}
          onClick={props.onMerge}
        >
          {props.busy === "merge" ? (
            <LoaderCircleIcon aria-hidden className="size-4 animate-spin" strokeWidth={1.75} />
          ) : null}
          {tone === "merging" ? "Merge now" : "Merge"}
        </button>
      </div>
    );
  return (
    <div className="grid grid-cols-2 gap-2">
      {tone === "failing" ? look("checks", "View checks") : look("files", "View changes")}
      <ThreadLink target={props.result.conversation.thread} className={PRIMARY}>
        Open
      </ThreadLink>
      <button
        type="button"
        className={cn(FOCUS, "col-span-2 min-h-11 rounded-full text-sm text-muted-foreground")}
        onClick={() => askAldoAbout(title)}
      >
        Ask Aldo about it
      </button>
    </div>
  );
}
