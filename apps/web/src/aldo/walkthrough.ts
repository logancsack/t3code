// Going through what waits on the user with Aldo, one at a time, on a call
// (the call screen shows it, AldoCallScreen.tsx). The page holds the list
// (decisions.logic.ts) and which one is up; Aldo is told each as it comes up
// and puts it to the user, with what it would pick when it has a reason. The
// user answers out loud (Aldo acts on it, as on any call) or taps a choice
// (the page acts, decide.ts, and tells Aldo what they chose). Either way the
// decision leaves the home read and the next one comes up; skipping moves on
// too. Hanging up ends it.

import { create } from "zustand";

import { aldoAssistantLive, connectAldo, tellAldoCall } from "./assistantSession";
import { decisionBrief, type AldoDecision } from "./decisions.logic";

export interface AldoWalkthroughState {
  readonly active: boolean;
  /** The decisions to go through, in order (their keys, and each as it was when the walk-through began). */
  readonly decisions: ReadonlyArray<AldoDecision>;
  /** The one that's up; `decisions.length` once they've all been gone through. */
  readonly index: number;
  /** What the brief would pick, by decision. */
  readonly suggestions: Readonly<Record<string, string>>;
}

export const useAldoWalkthrough = create<AldoWalkthroughState>(() => ({
  active: false,
  decisions: [],
  index: 0,
  suggestions: {},
}));

const set = (patch: Partial<AldoWalkthroughState>) => useAldoWalkthrough.setState(patch);
const get = () => useAldoWalkthrough.getState();

/** How Aldo is told to go through them, the first time. */
export function walkthroughOpening(decision: AldoDecision, count: number): string {
  return [
    `The user wants to go through what's waiting on them, one at a time: ${count === 1 ? "there's 1" : `there are ${count}`}. Their screen shows each one with its choices as it comes up, and they can answer you out loud or tap.`,
    "For each one: say what it is in one or two short sentences, about 25 words, plainly (their screen shows the details, so don't read them out). Say what you'd pick only when what you know about them (their notes, what they decided before) gives you a real reason, in a few words; never guess. Then stop and let them answer.",
    "When they answer out loud, act on it right away (answer_thread, decide_approval, approve_plan or merge_pull_request, quoting their words), then say it's done in a few words. If they tap instead, you'll be told. Never bring up the next one yourself: you'll be told what's next.",
    `First, 1 of ${count}: ${decisionBrief(decision)}`,
    "Start with a quick word that you're going through them, then put this one to them.",
  ].join("\n\n");
}

/** How Aldo is told about the next one, after the last was decided or skipped. */
export function walkthroughNext(
  previous: string,
  next: AldoDecision | null,
  position: number,
  count: number,
): string {
  if (!next)
    return `${previous} That was the last one. Tell them that's everything for now, in a few words, warmly, and ask if there's anything else.`;
  return `${previous} Next, ${position} of ${count}: ${decisionBrief(next)} Acknowledge the last one in a couple of words, then put this one to them.`;
}

/**
 * Starts going through `decisions` with Aldo: on the call that's on, or on
 * one that starts now, which opens with the first of them.
 */
export function startAldoWalkthrough(
  decisions: ReadonlyArray<AldoDecision>,
  suggestions: Readonly<Record<string, string>> = {},
): void {
  const first = decisions[0];
  if (!first) return;
  set({ active: true, decisions, index: 0, suggestions });
  const opening = walkthroughOpening(first, decisions.length);
  if (aldoAssistantLive()) tellAldoCall(opening, { respond: true });
  else void connectAldo({ opening });
}

/**
 * The one that's up was decided (`how`, in words, when the user tapped: Aldo
 * acted itself when they said it) or skipped: the next one comes up.
 */
export function advanceAldoWalkthrough(outcome: "decided" | "skipped", how?: string): void {
  const { active, decisions, index } = get();
  if (!active || index >= decisions.length) return;
  const next = index + 1;
  set({ index: next });
  const previous =
    outcome === "skipped"
      ? "The user skipped that one for now."
      : how
        ? `The user tapped: they ${how}. It's done.`
        : "That one's decided.";
  tellAldoCall(walkthroughNext(previous, decisions[next] ?? null, next + 1, decisions.length), {
    respond: true,
  });
}

/** Ends it (the call goes on, unless it's what ended). */
export function stopAldoWalkthrough(note?: string): void {
  if (!get().active) return;
  set({ active: false, decisions: [], index: 0, suggestions: {} });
  if (note) tellAldoCall(note, { respond: false });
}
