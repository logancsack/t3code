// When a working turn has stopped moving, in threads that aren't code: after a
// few minutes with nothing new from its agent (no step, no words, no browser
// change), the working line says "No progress for 4 min" and offers a way
// forward (AldoStall.tsx). Anything the thread records counts as something
// new: a step starting, updating or ending, a helper's progress, the agent's
// words, and those words as they stream in (their record keeps one time until
// they end, so the page notes when they grow).

import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import type { ChatMessage } from "../types";

/** How long a turn goes with nothing new before the working line says so. */
export const ALDO_STALL_AFTER_MS = 4 * 60_000;

/** What the working line says while the agent waits on the user (aldoWorkingWords): not a stall. */
export const ALDO_WAITING_WORDS = "Waiting for you";

/** What Nudge sends the agent. */
export const ALDO_NUDGE = "Where are you? Carry on, or tell me what's stuck.";

/** What Ask Aldo starts the summon bar with. */
export function aldoStallQuestion(minutes: number): string {
  return `This thread has made no progress for ${minutes} minutes. What's it stuck on?`;
}

const NEVER = Number.NEGATIVE_INFINITY;

function timeOf(iso: string | null): number {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(ms) ? ms : NEVER;
}

export interface AldoProgress {
  /** When the thread last showed a sign of life, as its records say (ISO), or null. */
  readonly at: string | null;
  /** Changes with every sign of life, words streaming in included. */
  readonly key: string;
}

/** The thread's latest sign of life, from its activities and its agent's messages. */
export function aldoThreadProgress(
  activities: ReadonlyArray<Pick<OrchestrationThreadActivity, "createdAt">>,
  messages: ReadonlyArray<
    Pick<ChatMessage, "role" | "text" | "streaming" | "createdAt" | "updatedAt">
  >,
): AldoProgress {
  let at: string | null = null;
  let atMs = NEVER;
  let streamed = 0;
  const stamps: string[] = [];
  for (const activity of activities) stamps.push(activity.createdAt);
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    stamps.push(message.createdAt, message.updatedAt);
    if (message.streaming) streamed += message.text.length;
  }
  for (const stamp of stamps) {
    const ms = timeOf(stamp);
    if (ms > atMs) {
      atMs = ms;
      at = stamp;
    }
  }
  return { at, key: `${at ?? ""}|${streamed}` };
}

/**
 * Whole minutes the turn has gone without progress, once that's long enough
 * to say so, else null. Counted from the latest of: the thread's last sign of
 * life as its records say, the turn's start, and when this page last saw
 * something new (words streaming in, or anything, whatever the two clocks say).
 */
export function aldoStalledMinutes(input: {
  readonly at: string | null;
  readonly startedAt: string | null;
  readonly seenAt: number | null;
  readonly now: number;
}): number | null {
  const last = Math.max(timeOf(input.at), timeOf(input.startedAt), input.seenAt ?? NEVER);
  if (last === NEVER) return null;
  const quiet = input.now - last;
  return quiet >= ALDO_STALL_AFTER_MS ? Math.floor(quiet / 60_000) : null;
}
