// How many wait on the user out of view, above the composer on a wide
// screen. Aldo's conversation puts each card where it came up
// (AldoUpNext.tsx), so one can sit far above what's being read, or below
// it; this says so, and a tap brings the nearest into view. A phone has its
// Needs you tab for this (AldoSimpleRail.tsx).

import { useEffect, useState, type RefObject } from "react";

import { cn } from "~/lib/utils";
import { revealAldoCard } from "./AldoUpNext";
import { nearestOutOfView, needsYouWords } from "./needsYou.logic";
import { showAldoDecisionKey } from "./show";

/** What's in the conversation that waits on the user: a card, or a thread paused mid-turn. */
const WAITING = "[data-aldo-decision], [data-aldo-paused]";
/** The conversation fades out over its first and last 12px: a card there isn't read. */
const EDGE = 12;

/** Where each card in the conversation is against what's being read. */
function cardsIn(box: HTMLElement) {
  const view = box.getBoundingClientRect();
  return [...box.querySelectorAll<HTMLElement>(WAITING)].map((card) => {
    const rect = card.getBoundingClientRect();
    const where: "above" | "in" | "below" =
      rect.bottom <= view.top + EDGE ? "above" : rect.top >= view.bottom - EDGE ? "below" : "in";
    return { card, where };
  });
}

export function NeedsYouPill(props: {
  readonly scroller: RefObject<HTMLElement | null>;
  /** How many wait on the user in all: decisions and paused threads, folded ones too. */
  readonly total: number;
  readonly className?: string;
}) {
  const { scroller, total } = props;
  const [out, setOut] = useState(0);
  useEffect(() => {
    const box = scroller.current;
    if (!box || total === 0) return;
    let frame = 0;
    // Once a frame at most, however fast it scrolls or changes.
    const measure = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const seen = cardsIn(box).filter((c) => c.where === "in").length;
        setOut(Math.max(0, total - seen));
      });
    };
    measure();
    box.addEventListener("scroll", measure, { passive: true });
    const resized = new ResizeObserver(measure);
    resized.observe(box);
    // Cards come, go and unfold as the conversation goes on.
    const changed = new MutationObserver(measure);
    changed.observe(box, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      box.removeEventListener("scroll", measure);
      resized.disconnect();
      changed.disconnect();
    };
  }, [scroller, total]);
  const words = needsYouWords(Math.min(out, total), total);
  if (!words) return null;
  return (
    <button
      type="button"
      data-aldo-needs-you=""
      data-aldo-arrive=""
      className={cn(
        "flex h-8 items-center gap-2 rounded-full border border-foreground/[0.10] bg-popover ps-3 pe-3.5 font-medium text-[13px] shadow-composer outline-none focus-visible:ring-2 focus-visible:ring-ring dark:shadow-composer-dark",
        props.className,
      )}
      onClick={() => {
        const box = scroller.current;
        if (!box) return;
        const card = nearestOutOfView(cardsIn(box));
        if (card) {
          revealAldoCard(card);
          return;
        }
        // None drawn out of view: the rest are folded under a group's "more", wherever it sits.
        const folded = box.querySelector<HTMLElement>("[data-aldo-folded]")?.dataset.aldoFolded;
        if (!folded || !showAldoDecisionKey(folded)) box.scrollTo({ top: box.scrollHeight });
      }}
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-warning" />
      {words}
    </button>
  );
}
