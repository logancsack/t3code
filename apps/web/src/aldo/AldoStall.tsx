// A turn that has stopped moving says so, in threads that aren't code: after
// a few minutes with nothing new from its agent, the working line (the
// timeline's working row) reads "No progress for 4 min · Nudge · Stop · Ask
// Aldo" (stall.logic.ts says when). Nudge writes to the agent the way a
// message sent mid-turn goes (it steers the turn, or waits behind it); Stop is
// the composer's stop button; Ask Aldo opens the summon bar about this thread.
// Not while the agent waits on the user. ChatView says what it knows about the
// thread on screen (useAldoStallSignals) and its working row asks
// (useAldoStall), so the timeline between them needn't carry it.

import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { ChatMessage } from "../types";
import { useAldoAssistantAvailable } from "./AldoAssistant";
import { openAldoSummonWith } from "./AldoSummon";
import { isAldoCloud } from "./cloud";
import { aldoHandoffFor } from "./handoffs.logic";
import { useAldoHomeFeed } from "./homeFeed";
import {
  ALDO_NUDGE,
  ALDO_WAITING_WORDS,
  aldoStalledMinutes,
  aldoStallQuestion,
  aldoThreadProgress,
} from "./stall.logic";

/** How often the working line looks again while a turn runs. */
const TICK_MS = 30_000;

interface AldoStallSignals {
  /** When the thread last showed a sign of life, as its records say. */
  readonly at: string | null;
  /** When this page last saw something new in the thread (words streaming in included). */
  readonly seenAt: number | null;
  /** An approval or a question is open: the turn waits on the user. */
  readonly waitingOnYou: boolean;
  /** Nudged since the last sign of life: Nudge waits for the next. */
  readonly nudged: boolean;
  readonly nudge: (() => void) | null;
  /** Stops the turn; settles once it has been asked to. */
  readonly stop: () => Promise<unknown>;
}

// The thread on screen's signals (there's one thread page at a time).
let onScreen: { readonly threadKey: string; readonly signals: AldoStallSignals } | null = null;
const listeners = new Set<() => void>();

function publish(next: typeof onScreen): void {
  if (next === onScreen) return;
  onScreen = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Says what the working line needs to tell a stall, for the thread on screen (nothing outside Aldo). */
export function useAldoStallSignals(input: {
  readonly threadKey: string | null;
  readonly activities: ReadonlyArray<Pick<OrchestrationThreadActivity, "createdAt">>;
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly waitingOnYou: boolean;
  /** The thread, for whether Aldo has its agent waiting on the user in its browser (a handoff). */
  readonly target: { readonly environmentId: string; readonly threadId: string } | null;
  /** Sends a message to the agent; false when it couldn't go. */
  readonly send: ((text: string) => Promise<boolean>) | null;
  readonly stop: () => unknown;
}): void {
  const { threadKey, activities, messages, target, send, stop } = input;
  // A handoff waits on the user outside the turn's own requests: it isn't a stall either.
  const home = useAldoHomeFeed((s) => s.home);
  const waitingOnYou =
    input.waitingOnYou || (target !== null && aldoHandoffFor(home, target) !== null);
  const { at, key } = useMemo(
    () => (isAldoCloud ? aldoThreadProgress(activities, messages) : { at: null, key: "" }),
    [activities, messages],
  );
  // When this page saw the thread's progress change, kept per thread: one
  // just opened hasn't made progress by being opened.
  const progressKey = `${threadKey ?? ""}|${key}`;
  const [seen, setSeen] = useState({ threadKey, progressKey, at: null as number | null });
  useEffect(() => {
    setSeen((before) =>
      before.progressKey === progressKey
        ? before
        : { threadKey, progressKey, at: before.threadKey === threadKey ? Date.now() : null },
    );
  }, [threadKey, progressKey]);

  const [nudgedAt, setNudgedAt] = useState<string | null>(null);
  const latest = useRef({ progressKey, send, stop });
  useEffect(() => {
    latest.current = { progressKey, send, stop };
  });
  const nudge = useCallback(() => {
    const { progressKey: when, send: sendNow } = latest.current;
    if (!sendNow) return;
    setNudgedAt(when);
    void sendNow(ALDO_NUDGE).then((sent) => {
      if (!sent) setNudgedAt((current) => (current === when ? null : current));
    });
  }, []);
  const stopTurn = useCallback(async () => latest.current.stop(), []);

  const seenAt = seen.threadKey === threadKey ? seen.at : null;
  const canSend = send !== null;
  const signals = useMemo<AldoStallSignals>(
    () => ({
      at,
      seenAt,
      waitingOnYou,
      nudged: nudgedAt === progressKey,
      nudge: canSend ? nudge : null,
      stop: stopTurn,
    }),
    [at, seenAt, waitingOnYou, nudgedAt, progressKey, canSend, nudge, stopTurn],
  );
  useEffect(() => {
    publish(isAldoCloud && threadKey ? { threadKey, signals } : null);
  }, [threadKey, signals]);
  // Off the thread page, no thread is on screen.
  useEffect(() => () => publish(null), []);
}

export interface AldoStall {
  /** Whole minutes without progress. */
  readonly minutes: number;
  readonly signals: AldoStallSignals;
}

/**
 * Whether the turn on a thread's working line has gone without progress long
 * enough to say so: null before, and while it waits on the user. `enabled`:
 * a thread that isn't code, with its agent at work.
 */
export function useAldoStall(input: {
  readonly threadKey: string;
  readonly enabled: boolean;
  readonly startedAt: string | null;
  readonly words: string | null;
}): AldoStall | null {
  const current = useSyncExternalStore(
    subscribe,
    () => onScreen,
    () => null,
  );
  const signals = current?.threadKey === input.threadKey ? current.signals : null;
  const on =
    input.enabled &&
    signals !== null &&
    !signals.waitingOnYou &&
    input.words !== ALDO_WAITING_WORDS;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [on]);
  if (!on) return null;
  const minutes = aldoStalledMinutes({
    at: signals.at,
    startedAt: input.startedAt,
    seenAt: signals.seenAt,
    now,
  });
  return minutes === null ? null : { minutes, signals };
}

/** "No progress for 4 min · Nudge · Stop · Ask Aldo", on the working line. */
export function AldoStallLine({ stall }: { readonly stall: AldoStall }) {
  const { minutes, signals } = stall;
  const aldoAvailable = useAldoAssistantAvailable();
  const [stopping, setStopping] = useState(false);
  const action =
    "font-medium text-foreground/80 underline-offset-2 hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-60";
  return (
    <span data-aldo-stall="">
      No progress for {minutes} min
      {signals.nudge ? (
        <>
          {" · "}
          <button
            type="button"
            className={action}
            disabled={signals.nudged}
            onClick={signals.nudge}
          >
            {signals.nudged ? "Nudged" : "Nudge"}
          </button>
        </>
      ) : null}
      {" · "}
      <button
        type="button"
        className={action}
        disabled={stopping}
        onClick={() => {
          setStopping(true);
          void signals.stop().finally(() => setStopping(false));
        }}
      >
        Stop
      </button>
      {aldoAvailable ? (
        <>
          {" · "}
          <button
            type="button"
            className={action}
            onClick={() => openAldoSummonWith(aldoStallQuestion(minutes))}
          >
            Ask Aldo
          </button>
        </>
      ) : null}
    </span>
  );
}
