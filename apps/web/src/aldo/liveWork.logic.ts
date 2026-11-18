// What a working thread is doing right now, in one line: its card in Aldo's
// conversation (AldoLiveCard.tsx) and its row in the status drop-down
// (AldoPresence.tsx) say it the same way. "Running tests", "Editing
// src/app.ts", "Thinking", "Rendering frame 37 of 120", from its machine's live
// shell while this page is connected to it (liveWork.ts). Without that (a
// machine that doesn't report it, or one this page isn't connected to), the
// card says what Aldo's home read has ("Working · 4 min"), never a step that
// may have ended. Pure, so it's tested on its own.

import { elapsed } from "./home.logic";

/** Where a step happens, when there's something to watch: a browser, a desktop, a render. */
export type AldoLiveSurface = "browser" | "windows" | "gpu";

export interface AldoLiveWork {
  /** A tool call under way, thinking, or writing its reply. */
  readonly kind: "tool" | "thinking" | "writing";
  /** The tool call in words, as the thread's own timeline says it ("Running tests"). */
  readonly doing: string | null;
  /** When this step started. */
  readonly since: string;
  /** Its plan, when its agent keeps one: on step `done + 1` of `total`. */
  readonly plan?: { readonly done: number; readonly total: number } | null;
  /** Where the step happens, while there's something to watch there. */
  readonly surface?: AldoLiveSurface | null;
  /** The site, for a step in the browser. */
  readonly site?: string | null;
  /** A render under way on the GPU computer, as Blender there says it. */
  readonly render?: AldoLiveRender | null;
}

/** A render on the GPU computer: the frame it's on, of how many when it says. */
export interface AldoLiveRender {
  readonly frame: number;
  readonly frames: number | null;
  /** What's left, from the frames so far; null until there's a frame to go by. */
  readonly leftMs: number | null;
}

export interface AldoLiveLine {
  /** One line, present tense: "Running tests". */
  readonly text: string;
  /** When the step started, once it's run a minute: the line then says how long. */
  readonly since: string | null;
}

/** A step this new says no time: "Running tests", then "Running tests · 2 min". */
const SAY_TIME_AFTER_MS = 60_000;

/** The step in one line, or null when there's no live step to say. */
export function liveLineOf(work: AldoLiveWork | null, now: number): AldoLiveLine | null {
  if (!work) return null;
  const text = work.render
    ? `Rendering frame ${work.render.frame}${work.render.frames ? ` of ${work.render.frames}` : ""}`
    : work.kind === "thinking"
      ? "Thinking"
      : work.kind === "writing"
        ? "Writing its reply"
        : work.doing;
  if (!text) return null;
  // A render says how far it is instead.
  const long = !work.render && now - Date.parse(work.since) >= SAY_TIME_AFTER_MS;
  return { text, since: long ? work.since : null };
}

/** How long the step has run, once that's worth saying: "2 min". */
export function liveLineTime(line: AldoLiveLine, now: number): string | null {
  return line.since ? elapsed(line.since, now) : null;
}

/** The line with its time: "Running tests · 2 min". */
export function liveLineText(line: AldoLiveLine, now: number): string {
  const time = liveLineTime(line, now);
  return time ? `${line.text} · ${time}` : line.text;
}

/** What's left of a render, in words: "6 min left", "about an hour left". */
export function renderLeft(ms: number | null): string | null {
  if (ms === null || ms <= 0) return null;
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "about an hour left" : `about ${hours} h left`;
}

/** What the plan's at: "Step 3 of 6"; null without one. */
export function planWords(plan: AldoLiveWork["plan"]): string | null {
  if (!plan || plan.total < 2) return null;
  return `Step ${Math.min(plan.done + 1, plan.total)} of ${plan.total}`;
}
