// How a finished result's standing looks (finished.logic.ts), wherever it's
// shown: the Finished group (AldoFinished.tsx) and the conversation's finished
// lines (AldoFeed.tsx). Amber with an alert for what failed, a green check
// only for what shipped, quiet for the rest, each with a mark that says it
// without the color.

import { AlertCircleIcon, CheckIcon, CircleDashedIcon, ClockIcon, PauseIcon } from "lucide-react";

import { PullRequestGlyph } from "../components/pullRequest/pullRequestIcons";
import { cn } from "~/lib/utils";
import { type AldoResultState } from "./finished.logic";

/** Its color: amber for what failed, green only for what shipped, quiet for the rest. */
export function toneClass(state: AldoResultState): string {
  if (state.tone === "failing") return "text-warning-foreground";
  if (state.tone === "shipped") return "text-success-foreground";
  return "text-muted-foreground";
}

/** How where it stands reads beside its words: its color, and weight for what failed. */
export function resultToneClass(state: AldoResultState): string {
  return cn(toneClass(state), state.tone === "failing" && "font-medium");
}

/** What it is: a pull request (a draft's own glyph), at its color. */
export function ResultGlyph(props: {
  readonly state: AldoResultState;
  readonly className?: string;
}) {
  const Icon =
    props.state.tone === "draft"
      ? PullRequestGlyph.draft
      : props.state.tone === "shipped"
        ? PullRequestGlyph.merged
        : PullRequestGlyph.pullRequest;
  return (
    <Icon
      aria-hidden
      className={cn("size-4 shrink-0", toneClass(props.state), props.className)}
      strokeWidth={1.75}
    />
  );
}

/** The mark that says where it stands without the color, if any: failing, running, coming, held, done. */
function StatusMark(props: { readonly state: AldoResultState; readonly className: string }) {
  const { state, className } = props;
  switch (state.tone) {
    case "failing":
      return <AlertCircleIcon aria-hidden className={className} strokeWidth={1.75} />;
    case "running":
      return <CircleDashedIcon aria-hidden className={className} strokeWidth={1.75} />;
    case "merging":
      return <ClockIcon aria-hidden className={className} strokeWidth={1.75} />;
    case "yours":
      return state.pullRequest?.held ? (
        <PauseIcon aria-hidden className={className} strokeWidth={1.75} />
      ) : null;
    case "shipped":
    case "done":
      return <CheckIcon aria-hidden className={className} strokeWidth={2.25} />;
    default:
      return null;
  }
}

/** Whether it has a mark of its own (StatusMark), rather than only its pull request's glyph. */
function marked(state: AldoResultState): boolean {
  return state.tone === "yours"
    ? state.pullRequest?.held === true
    : state.tone !== "draft" && state.tone !== "quiet";
}

/** Where it stands, as a line's mark (AldoFeed.tsx): its status mark, or else the pull request's glyph. */
export function ResultIcon(props: { readonly state: AldoResultState }) {
  if (!marked(props.state)) return <ResultGlyph state={props.state} />;
  return (
    <StatusMark state={props.state} className={cn("size-4 shrink-0", toneClass(props.state))} />
  );
}

/** Where it stands, with a mark that says it without the color: "2 checks failing", "Merges in 9 min". */
export function ResultStatus(props: {
  readonly state: AldoResultState;
  readonly className?: string;
}) {
  const { state } = props;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 text-[12px] leading-[18px] tabular-nums",
        resultToneClass(state),
        props.className,
      )}
    >
      <StatusMark state={state} className="size-3.5 shrink-0" />
      <span>{state.words}</span>
    </span>
  );
}
