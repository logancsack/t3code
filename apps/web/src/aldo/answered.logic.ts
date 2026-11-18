// An answer the user sent from here, before Aldo's home read has caught up with
// it. A thread asleep when it was answered reports nothing until its machine is
// up and has taken the answer, so the read keeps saying it waits on the same
// question for a minute or more; the card has to go the moment the answer is
// sent, not then. Until the read moves on, the conversation is shown as carrying
// on with the answer (homeFeed.ts keeps these and applies them to every read).
// Pure, so it's tested on its own.

import { isPausedMidTurn } from "./home.logic";
import type { AldoHome, AldoHomeConversation } from "./homeApi";

/**
 * What a conversation waits on the user to answer: the question or approval it
 * asks (its request) or the plan it proposes; a thread paused mid-turn, the
 * Continue that carries it on (named by when it paused). Null when it waits on
 * nothing of the kind (a handoff is answered in its own card).
 */
export function askOf(c: AldoHomeConversation): string | null {
  if (isPausedMidTurn(c)) return `paused:${c.stateAt ?? c.at}`;
  if (c.state !== "waiting") return null;
  if (c.pending) return c.pending.kind === "handoff" ? null : c.pending.requestId;
  return c.plan?.id ?? null;
}

export interface AldoHold {
  /** What was answered (askOf). */
  readonly ask: string;
  /** When it was sent. */
  readonly at: string;
  /**
   * Until when a read that still has it waiting is taken as behind, once Aldo
   * has the answer. Without it the answer is still on its way here.
   */
  readonly until?: number;
}

/** By conversation (its `ref`). */
export type AldoHolds = Readonly<Record<string, AldoHold>>;

/**
 * How long Aldo's read may stay behind an answer it took. A machine that sleeps
 * wakes, takes it and reports within a few minutes; a thread that still asks
 * the same after this is asking it, and its card comes back.
 */
export const HOLD_MS = 10 * 60_000;

/** A conversation as it is once its answer is on its way: carrying on with it, not waiting. */
export function carryingOn(c: AldoHomeConversation, hold: AldoHold): AldoHomeConversation {
  const { pending: _pending, plan: _plan, summary: _summary, ...rest } = c;
  return {
    ...rest,
    // Its computer wakes for the answer (a thread that's asleep would read as paused mid-turn).
    state: c.machine === "running" ? "working" : "starting",
    at: hold.at,
    stateAt: hold.at,
  };
}

/**
 * Aldo's read with the answers sent from here held out, and the holds that
 * still apply: one the read has caught up with (its conversation asks
 * something else, or nothing, or is gone) or that outlived HOLD_MS is let go.
 * The same home comes back when nothing is held.
 */
export function withHolds(
  home: AldoHome,
  holds: AldoHolds,
  now: number,
): { readonly home: AldoHome; readonly holds: AldoHolds } {
  const refs = Object.keys(holds);
  if (refs.length === 0) return { home, holds };
  const kept: Record<string, AldoHold> = {};
  const conversations = home.conversations.map((c) => {
    const hold = holds[c.ref];
    if (!hold || askOf(c) !== hold.ask || (hold.until !== undefined && hold.until <= now)) return c;
    kept[c.ref] = hold;
    return carryingOn(c, hold);
  });
  const same = refs.length === Object.keys(kept).length;
  return {
    home: Object.keys(kept).length === 0 ? home : { ...home, conversations },
    holds: same ? holds : kept,
  };
}
