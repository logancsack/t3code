// A call on GPT-Live, without the network or the page. Its transcript comes as
// fragments on the session's timeline, for both speakers at once (it's full
// duplex), with nothing marking where a turn ends: a speaker's turn is their
// words until they've been quiet for `gapMs` of the timeline, or until it's
// flushed (a delegation needs the user's last words now). Finished turns come
// out oldest first. Aldo's phone bridge groups them the same way
// (phone-relay/transcript.ts).

import type { AldoAssistantPhase } from "./assistant.logic";

export interface AldoLiveTurn {
  readonly role: "user" | "assistant";
  readonly text: string;
}

interface OpenTurn {
  text: string;
  readonly start: number;
  end: number;
}

export class AldoLiveTranscript {
  private readonly open = new Map<AldoLiveTurn["role"], OpenTurn>();
  /** The furthest the timeline has been seen, and when (wall clock), to tell how long it's been quiet. */
  private seen = { at: 0, wall: 0 };
  readonly turns: AldoLiveTurn[] = [];

  constructor(
    private readonly onTurn: (turn: AldoLiveTurn) => void = () => {},
    private readonly gapMs = 1_200,
  ) {}

  /** A fragment: who, what, and where it falls on the session's timeline (ms). */
  add(
    role: AldoLiveTurn["role"],
    delta: string,
    start: number,
    end: number,
    wall = Date.now(),
  ): void {
    const turn = this.open.get(role);
    if (turn && start - turn.end > this.gapMs) this.finish(role);
    const current = this.open.get(role);
    if (current) {
      current.text += delta;
      current.end = Math.max(current.end, end);
    } else if (delta.trim()) {
      this.open.set(role, { text: delta, start, end });
    }
    if (end >= this.seen.at) this.seen = { at: end, wall };
  }

  /** A turn that didn't come as speech (what the user typed on the call): it ends what's being said, and is the newest. */
  note(turn: AldoLiveTurn): void {
    this.flush();
    const text = turn.text.trim();
    if (text) this.turns.push({ role: turn.role, text });
  }

  /** Where the timeline is now, from the last fragment and the time since. */
  now(wall = Date.now()): number {
    return this.seen.at + Math.max(0, wall - this.seen.wall);
  }

  /** How long since `role` last said anything still in an open turn (timeline ms); Infinity when nothing is. */
  quietFor(role: AldoLiveTurn["role"], wall = Date.now()): number {
    const turn = this.open.get(role);
    return turn ? this.now(wall) - turn.end : Number.POSITIVE_INFINITY;
  }

  /** What `role` is saying now, in a turn that hasn't ended. */
  saying(role: AldoLiveTurn["role"]): string {
    return this.open.get(role)?.text.trim() ?? "";
  }

  /**
   * Ends the turns whose speaker has been quiet long enough, oldest first. A
   * turn waits for one that began before it, so the turns stay in the order
   * they began ("mm-hmm" under the user's words comes after them).
   */
  settle(wall = Date.now()): void {
    for (const role of this.order()) {
      if (this.quietFor(role, wall) <= this.gapMs) return;
      this.finish(role);
    }
  }

  /** Ends every open turn, or `role`'s and any that began before it (Aldo's question, before the user's quick "yes"). */
  flush(role?: AldoLiveTurn["role"]): void {
    const until = role ? this.open.get(role)?.start : Number.POSITIVE_INFINITY;
    if (until === undefined) return;
    for (const each of this.order()) if (this.open.get(each)!.start <= until) this.finish(each);
  }

  /** The finished turns, then what's still being said (which began after them): all of the conversation so far. */
  all(): AldoLiveTurn[] {
    return [
      ...this.turns,
      ...this.order().map((role) => ({ role, text: this.saying(role) })),
    ].filter((turn) => turn.text);
  }

  private order(): AldoLiveTurn["role"][] {
    return [...this.open.entries()].sort((a, b) => a[1].start - b[1].start).map(([role]) => role);
  }

  private finish(role: AldoLiveTurn["role"]): void {
    const turn = this.open.get(role);
    if (!turn) return;
    this.open.delete(role);
    const text = turn.text.trim();
    if (!text) return;
    const done = { role, text };
    this.turns.push(done);
    this.onTurn(done);
  }
}

/** How recently someone spoke (timeline ms) for the orb to show them speaking. */
const SPEAKING_MS = 700;

/**
 * Where a GPT-Live call is, as the orb shows it: whoever spoke last moments
 * ago, else thinking while a delegation runs, else listening. Aldo speaking
 * wins over the user (full duplex: a "mm-hmm" under their words is Aldo
 * listening).
 */
export function livePhase(state: {
  readonly phase: AldoAssistantPhase;
  readonly userQuietMs: number;
  readonly aldoQuietMs: number;
  readonly delegating: number;
}): AldoAssistantPhase {
  if (state.phase === "idle" || state.phase === "error" || state.phase === "connecting")
    return state.phase;
  if (state.userQuietMs < SPEAKING_MS && state.userQuietMs <= state.aldoQuietMs) return "hearing";
  if (state.aldoQuietMs < SPEAKING_MS) return "speaking";
  if (state.delegating > 0) return "thinking";
  return "listening";
}

/**
 * Whether a call has been quiet long enough to hang up: nobody has said
 * anything for `idleMs` (wall clock) and nothing is being worked on. GPT-Live
 * bills every connected second, so a call left open is closed.
 */
export function idleCall(state: {
  readonly lastSpokeAt: number;
  readonly delegating: number;
  readonly now: number;
  readonly idleMs: number;
}): boolean {
  return state.delegating === 0 && state.now - state.lastSpokeAt >= state.idleMs;
}

/**
 * A high estimate of the tokens in `text`, for what one update to the voice
 * takes (500 tokens): about three characters of English a token, and any
 * other character (Japanese, emoji, accented letters) a token and a half.
 */
export function liveTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const char of text) {
    if (char.charCodeAt(0) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 3 + other * 1.5);
}

/** The longest start of `text` that fits in `tokens`, cut with an ellipsis when it doesn't all fit. */
export function cutForLive(text: string, tokens: number): string {
  if (liveTokens(text) <= tokens) return text;
  let used = 1.5;
  let end = 0;
  for (const char of text) {
    used += char.charCodeAt(0) < 128 ? 1 / 3 : 1.5;
    if (used > tokens) break;
    end += char.length;
  }
  return `${text.slice(0, end)}…`;
}

/**
 * `text` as updates of at most `tokens` each, a paragraph at a time where
 * paragraphs fit, for instructions and context too long for one.
 */
export function splitForLive(text: string, tokens: number): string[] {
  const parts: string[] = [];
  for (const paragraph of text.split("\n\n")) {
    const last = parts.at(-1);
    if (last !== undefined && liveTokens(`${last}\n\n${paragraph}`) <= tokens) {
      parts[parts.length - 1] = `${last}\n\n${paragraph}`;
      continue;
    }
    let rest = paragraph;
    while (liveTokens(rest) > tokens) {
      const head = cutForLive(rest, tokens).slice(0, -1);
      if (!head) break;
      parts.push(head);
      rest = rest.slice(head.length);
    }
    if (rest) parts.push(rest);
  }
  return parts;
}
