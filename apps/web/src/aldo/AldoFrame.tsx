import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { cn } from "../lib/utils";
import { useAldoAssistant } from "./assistantSession";
import { ALDO_MARK_PATHS } from "./AldoMark";
import { frameComposite, framePaint, frameRgb } from "./frame.logic";
import { presenceState, type AldoPresenceState } from "./presence.logic";
import { SUCCESS_MS, useAldoPresenceReactions } from "./presenceReactions";
import "./frame.css";

function useReaction(
  aware: boolean,
  kind: "successAt" | "acknowledgedAt",
  duration: number,
): { active: boolean; at: number } {
  const at = useAldoPresenceReactions((s) => (aware ? s[kind] : 0));
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!at) return;
    const remaining = at + duration - Date.now();
    if (remaining <= 0) return;
    const start = setTimeout(() => setActive(true), 0);
    const stop = setTimeout(() => setActive(false), remaining);
    return () => {
      clearTimeout(start);
      clearTimeout(stop);
    };
  }, [at, duration]);
  return { active, at };
}

/** The original Open Frame polygons; CSS changes only opacity and clipping. */
export function AldoFrame({
  size,
  state: base = "idle",
  aware = false,
  className,
}: {
  readonly size: number;
  readonly state?: AldoPresenceState;
  readonly aware?: boolean;
  readonly className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [visible, setVisible] = useState(true);
  const [paint, setPaint] = useState<CSSProperties>({});
  const reading = useAldoPresenceReactions((s) => aware && s.reading);
  const acknowledgement = useReaction(aware, "acknowledgedAt", 220);
  const success = useReaction(aware, "successAt", SUCCESS_MS);
  const resolved = aware ? presenceState(base, { reading, success: success.active }) : base;
  const state =
    acknowledgement.active && ["idle", "working", "needs-you"].includes(resolved)
      ? "acknowledgement"
      : resolved;
  const animate = visible && !reduced;
  // Only the visible speaking/listening mark receives audio updates.
  const level = useAldoAssistant((s) =>
    !animate ? 0 : state === "speaking" ? s.levels.aldo : state === "listening" ? s.levels.mic : 0,
  );

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const repaint = () => {
      // Composite translucent ancestor surfaces, including sidebar hover tints.
      const layers: (readonly number[])[] = [];
      for (let node: Element | null = element; node; node = node.parentElement) {
        const color = frameRgb(getComputedStyle(node).backgroundColor);
        if (color) layers.push(color);
        if (color?.[3] === 1) break;
      }
      const fallback = frameRgb(getComputedStyle(element).getPropertyValue("--background")) ?? [
        1, 1, 1,
      ];
      const backdrop = layers
        .toReversed()
        .reduce((back, front) => frameComposite(front, back), [...fallback]);
      const next = framePaint(backdrop);
      setPaint({
        "--aldo-frame-ink": next.color,
        "--aldo-frame-floor": next.floor,
        "--aldo-frame-low": next.low,
      } as CSSProperties);
    };
    repaint();
    const observer = new MutationObserver(repaint);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let intersecting = true;
    const update = () => setVisible(intersecting && document.visibilityState !== "hidden");
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            intersecting = entry?.isIntersecting ?? true;
            update();
          });
    observer?.observe(element);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  const amount = Math.min(1, Math.max(0, level * 2.5));
  const paths = ALDO_MARK_PATHS.map((d, i) => (
    <path key={d} data-frame-stroke={i ? "right" : "left"} d={d} />
  ));
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      data-aldo-frame=""
      data-state={state}
      data-motion={animate ? "on" : "off"}
      style={{ ...paint, width: size, height: size }}
    >
      <svg
        key={`${state}:${state === "success" ? success.at : acknowledgement.at}`}
        viewBox="0 0 42 32"
        fill="currentColor"
      >
        <g data-frame-layer="base">{paths}</g>
        <g
          data-frame-layer="overlay"
          style={
            state === "listening" || state === "speaking"
              ? {
                  clipPath:
                    state === "listening"
                      ? `inset(${82 * (1 - amount)}% 0 0)`
                      : `inset(0 0 ${78 * (1 - amount)}%)`,
                }
              : undefined
          }
        >
          {paths}
        </g>
      </svg>
    </span>
  );
}
