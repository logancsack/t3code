// The working row's line in threads that aren't code (progress.logic.ts):
// "Step 5 of 6 · Setting up your seller account · 18 min". The time ticks on
// its own text node, as MessagesTimeline's WorkingTimer does, so nothing
// re-renders each second.

import { memo, useEffect, useRef } from "react";

import { aldoElapsedWords, aldoProgressHead, type AldoPlanStep } from "./progress.logic";

function elapsedSince(startedAt: string): string {
  const started = Date.parse(startedAt);
  return aldoElapsedWords(Number.isFinite(started) ? Date.now() - started : 0);
}

const AldoElapsed = memo(function AldoElapsed({ startedAt }: { startedAt: string }) {
  const textRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const update = () => {
      if (textRef.current) textRef.current.textContent = elapsedSince(startedAt);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return (
    <span ref={textRef} className="tabular-nums">
      {elapsedSince(startedAt)}
    </span>
  );
});

export const AldoProgressLine = memo(function AldoProgressLine(props: {
  /** The plan the turn is working through, if its agent keeps one. */
  readonly plan: ReadonlyArray<AldoPlanStep> | null;
  /** The step under way in plain words, for a turn without a plan. */
  readonly words: string | null;
  /** When the turn started. */
  readonly startedAt: string;
}) {
  return (
    <>
      {aldoProgressHead(props.plan, props.words)} · <AldoElapsed startedAt={props.startedAt} />
    </>
  );
});
