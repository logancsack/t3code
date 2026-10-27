// A thread's live work inside its card in Aldo's conversation (AldoLiveCard.tsx):
// what its browser or the Windows computer shows, or the GPU computer's latest
// frame with how far the render is (liveFrames.ts). Small beside the card's
// title; the card's width once the card is opened. It takes frames only while
// someone can see it: half of it on screen, the page showing, and no more than
// LIVE_AT_ONCE small ones at a time (the most recently shown). Otherwise it
// keeps its last frame, and says how old a frame is once it isn't live. It
// never wakes a machine or keeps one up: a machine that isn't running has no
// frames.

import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import type { AldoHomeTarget } from "./homeApi";
import { type AldoLiveFrame, aldoLiveFrames, GPU_EVERY_MS } from "./liveFrames";
import type { AldoLiveSurface } from "./liveWork.logic";
import { useAldoPageVisible } from "./pageVisibility";

/** A small view takes a frame this often; an opened one, this often; a render's, as often as it's read. */
const SMALL_EVERY_MS = 3_000;
const OPEN_EVERY_MS = 500;

function paceOf(surface: AldoLiveSurface, open: boolean): number {
  return surface === "gpu" ? GPU_EVERY_MS : open ? OPEN_EVERY_MS : SMALL_EVERY_MS;
}

/** Small views taking frames at once; the rest keep their last. */
const LIVE_AT_ONCE = 2;
/** A frame this much older than the view's pace isn't live. */
const LATE_MS = 4_000;

/** Small views taking frames now, the most recently shown last. */
const live: Array<() => void> = [];
/** Each view's last frame, so a view opened or shown again starts from it. */
const last = new Map<string, AldoLiveFrame>();

function useOnScreen(ref: React.RefObject<HTMLElement | null>): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setOn(entry!.intersectionRatio >= 0.5), {
      threshold: [0, 0.5, 1],
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return on;
}

/** Whether this small view may take frames: one of the LIVE_AT_ONCE most recently shown. */
function useTurn(wanted: boolean): boolean {
  const [turn, setTurn] = useState(false);
  useEffect(() => {
    if (!wanted) return;
    const lose = () => setTurn(false);
    live.push(lose);
    setTurn(true);
    while (live.length > LIVE_AT_ONCE) live.shift()!();
    return () => {
      const at = live.indexOf(lose);
      if (at >= 0) live.splice(at, 1);
      setTurn(false);
    };
  }, [wanted]);
  return turn;
}

export function AldoLiveView(props: {
  readonly target: AldoHomeTarget;
  readonly surface: AldoLiveSurface;
  readonly open: boolean;
  /** For a render: how far it is, 0 to 1. */
  readonly progress?: number | null;
  /** What it shows, for a screen reader: "Its browser, on nextjs.org". */
  readonly label: string;
  readonly className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(box);
  const showing = useAldoPageVisible();
  const wanted = onScreen && showing;
  const turn = useTurn(wanted && !props.open);
  const active = wanted && (props.open || turn);
  const { surface, open } = props;
  const { environmentId, threadId } = props.target;
  const key = `${environmentId}\n${threadId}\n${surface}`;
  const [frame, setFrame] = useState<AldoLiveFrame | null>(() => last.get(key) ?? null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const element = box.current;
    if (!active || !element) return;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    return aldoLiveFrames(surface, { environmentId, threadId }).watch(
      { width: Math.round(element.clientWidth * scale), everyMs: paceOf(surface, open) },
      (next) => {
        last.set(key, next);
        setFrame(next);
      },
    );
  }, [active, open, surface, environmentId, threadId, key]);
  // Whether the frame shown is live, looked at once a second.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const pace = paceOf(surface, open);
  const fresh = frame !== null && active && now - frame.at < pace + LATE_MS;
  const age = frame ? Math.max(0, Math.round((now - frame.at) / 1000)) : null;
  return (
    <div
      ref={box}
      role="img"
      aria-label={props.label}
      className={cn(
        "relative aspect-[16/10] shrink-0 overflow-hidden bg-foreground/[0.06] ring-1 ring-foreground/[0.08] dark:bg-white/[0.06] dark:ring-white/[0.08]",
        open ? "w-full rounded-xl" : "w-24 rounded-lg",
        props.className,
      )}
      data-aldo-live-view={surface}
    >
      {frame ? (
        <img
          src={frame.url}
          alt=""
          draggable={false}
          className="absolute inset-0 size-full object-cover object-top"
        />
      ) : null}
      {open && frame ? (
        <span className="absolute start-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-0.5 font-medium text-[11px] text-white leading-4 tabular-nums">
          {fresh ? <span aria-hidden className="size-1.5 rounded-full bg-white" /> : null}
          {fresh ? "Live" : age !== null && age < 60 ? `${age} s ago` : "Paused"}
        </span>
      ) : null}
      {props.progress !== undefined && props.progress !== null ? (
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-black/30">
          <span
            className="block h-full bg-white transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${Math.round(props.progress * 100)}%` }}
          />
        </span>
      ) : null}
    </div>
  );
}
