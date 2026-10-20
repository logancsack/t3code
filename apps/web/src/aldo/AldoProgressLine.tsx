// The working row's line in threads that aren't code (progress.logic.ts):
// "Step 5 of 6 · Setting up your seller account · 18 min". The time ticks on
// its own, so the row doesn't re-render each second.

import { memo, useEffect, useState } from "react";

import { aldoElapsedWords, aldoProgressHead, type AldoPlanStep } from "./progress.logic";

function elapsedSince(startedAt: string): string {
  const started = Date.parse(startedAt);
  return aldoElapsedWords(Number.isFinite(started) ? Date.now() - started : 0);
}

const AldoElapsed = memo(function AldoElapsed({ startedAt }: { startedAt: string }) {
  const [text, setText] = useState(() => elapsedSince(startedAt));
  useEffect(() => {
    const update = () => setText(elapsedSince(startedAt));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return <span className="tabular-nums">{text}</span>;
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
