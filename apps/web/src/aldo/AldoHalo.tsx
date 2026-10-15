// Aldo's mark wherever Aldo itself is: a ring of light on a dark disc, broken
// once at the upper right, where a point of light sits. It isn't a face: it's
// still while Aldo is at rest, turns slowly while it thinks, opens an inner
// ring while it listens, and swells and brightens with its voice while it
// speaks. The same at every size, from a feed row's 12px to the call screen's
// 160px, and in every theme (its colors are its own, not the theme's). The
// motions are in presence.css; reduced motion keeps the states, still.

import { useId, type CSSProperties } from "react";

import { cn } from "~/lib/utils";
import { useAldoAssistant } from "./assistantSession";
import type { AldoMood } from "./presence.logic";
import "./presence.css";

/** Where the break's middle sits, in degrees clockwise from three o'clock. */
const BREAK_AT = -45;
/** How much of the ring is the break. */
const BREAK = 0.15;

export function AldoHalo(props: {
  readonly size: number;
  readonly mood?: AldoMood;
  readonly className?: string;
}) {
  const mood = props.mood ?? "idle";
  // Only a halo that speaks or hears follows the voice: the rest don't render with every level.
  const level = useAldoAssistant((s) =>
    mood === "speaking" ? s.levels.aldo : mood === "listening" ? s.levels.mic : 0,
  );
  const id = `aldo-halo-${useId().replace(/[^\w-]/g, "")}`;
  const small = props.size < 20;
  const stroke = props.size >= 80 ? 1.1 : props.size >= 32 ? 1.6 : props.size >= 20 ? 2 : 2.6;
  const r = small ? 8.2 : 9;
  const length = 2 * Math.PI * r;
  const dash = `${length * (1 - BREAK)} ${length * BREAK}`;
  // The ring starts just past the break, going clockwise.
  const start = `rotate(${BREAK_AT + BREAK * 180} 16 16)`;
  const point = (BREAK_AT * Math.PI) / 180;
  return (
    <svg
      aria-hidden
      data-aldo-halo=""
      data-mood={mood}
      viewBox="0 0 32 32"
      width={props.size}
      height={props.size}
      className={cn("block shrink-0 overflow-visible", props.className)}
      style={{ "--aldo-level": Math.min(1, level * 2.5) } as CSSProperties}
    >
      <defs>
        <radialGradient id={`${id}-disc`} cx="50%" cy="35%" r="70%">
          <stop offset="0" stopColor="#1c2129" />
          <stop offset="1" stopColor="#07080a" />
        </radialGradient>
        <linearGradient id={`${id}-ring`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#8fb6ff" />
        </linearGradient>
        {small ? null : (
          <filter id={`${id}-blur`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.4" />
          </filter>
        )}
      </defs>
      <circle cx="16" cy="16" r="16" fill={`url(#${id}-disc)`} />
      <circle
        cx="16"
        cy="16"
        r="15.6"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.09"
        strokeWidth="0.7"
      />
      {small ? null : (
        <g data-aldo-halo-glow="">
          <circle
            cx="16"
            cy="16"
            r={r}
            fill="none"
            stroke="#5f95ff"
            strokeWidth={stroke * 2.2}
            strokeDasharray={dash}
            transform={start}
            filter={`url(#${id}-blur)`}
          />
        </g>
      )}
      {small ? null : (
        <circle
          data-aldo-halo-inner=""
          cx="16"
          cy="16"
          r="5"
          fill="none"
          stroke="#8fb6ff"
          strokeOpacity="0.8"
          strokeWidth={stroke * 0.5}
        />
      )}
      <g data-aldo-halo-ring="">
        {small ? null : (
          <circle
            cx={16 + r * Math.cos(point)}
            cy={16 + r * Math.sin(point)}
            r={stroke * 0.62}
            fill="#fff"
          />
        )}
        <circle
          cx="16"
          cy="16"
          r={r}
          fill="none"
          stroke={`url(#${id}-ring)`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={dash}
          transform={start}
        />
      </g>
    </svg>
  );
}
