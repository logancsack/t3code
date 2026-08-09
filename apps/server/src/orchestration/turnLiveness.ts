import {
  isToolLifecycleItemType,
  type ProviderRuntimeEvent,
  type ThreadId,
  type ToolLifecycleItemType,
  type TurnId,
} from "@t3tools/contracts";

/**
 * Liveness bookkeeping for a single running turn.
 *
 * A turn that looks silent is not necessarily dead: it may be waiting on a
 * tool it launched (a build, a test run, CI) or on the human (an approval or
 * user-input request). Those waits are legitimately unbounded, so the stall
 * watchdog must never time them out. The only wait with a bounded honest
 * duration is waiting on the model itself — a healthy model wait produces a
 * steady stream of content deltas, and prolonged total silence there means
 * the provider connection is dead, not thinking.
 */
export interface TurnLiveness {
  readonly turnId: TurnId;
  /** Wall-clock ms of the most recent runtime event observed for the thread. */
  readonly lastEventAtMs: number;
  /** Started-but-not-completed tool lifecycle items, keyed by item id. */
  readonly openItems: ReadonlyMap<string, ToolLifecycleItemType>;
  /** Unresolved approval / user-input requests, keyed by request id. */
  readonly openRequests: ReadonlySet<string>;
  /**
   * True when this entry was reconstructed from the persisted snapshot after
   * a server restart rather than observed live. A seeded turn has no live
   * provider session behind it (sessions die with the server process), so it
   * is judged against the shorter recovery threshold: if no runtime event
   * arrives for the thread shortly after boot, the turn is an orphan.
   */
  readonly seededFromSnapshot: boolean;
  /**
   * True after the VM this server runs on was suspended and resumed while
   * the turn was waiting on the model. The process survived the suspend but
   * a model-wait stream almost never does, so the turn is judged against the
   * short recovery grace instead of the full silence budget — and unlike a
   * restart orphan it is safe to auto-retry, because the retry budget
   * bookkeeping survived with the process.
   */
  readonly resumedProbation?: boolean;
}

export type TurnWaitClass = "human" | "tool" | "model";

export function classifyWait(liveness: TurnLiveness): TurnWaitClass {
  if (liveness.openRequests.size > 0) return "human";
  if (liveness.openItems.size > 0) return "tool";
  return "model";
}

export function seededTurnLiveness(turnId: TurnId, nowMs: number): TurnLiveness {
  return {
    turnId,
    lastEventAtMs: nowMs,
    openItems: new Map(),
    openRequests: new Set(),
    seededFromSnapshot: true,
  };
}

/**
 * Fold one runtime event into the thread's liveness entry.
 *
 * Returns the next entry, or `null` when the turn is over and the thread
 * should no longer be tracked. Receipt time (`nowMs`) is used instead of the
 * event's own `createdAt` so provider clock skew cannot fake a stall.
 */
export function applyRuntimeEvent(
  current: TurnLiveness | undefined,
  event: ProviderRuntimeEvent,
  nowMs: number,
): TurnLiveness | null {
  switch (event.type) {
    case "turn.started": {
      const turnId = event.turnId;
      if (turnId === undefined) return current ?? null;
      return {
        turnId,
        lastEventAtMs: nowMs,
        openItems: new Map(),
        openRequests: new Set(),
        seededFromSnapshot: false,
      };
    }
    case "turn.completed":
    case "turn.aborted":
    case "session.exited":
      return null;
    default:
      break;
  }

  // Any other event only refines an already-tracked turn. Events arriving
  // while nothing is tracked (between turns, or requests opened outside a
  // turn such as auth refreshes) are not work the watchdog should guard.
  if (current === undefined) return null;

  // A live event for a thread seeded from the snapshot means the turn
  // outlived the restart after all. Resume probation demands more: only an
  // event tied to the tracked turn proves the model stream survived — a
  // thread-scoped side event (an account update, a config warning) proves
  // nothing about the stream and must not soften the probation.
  const provesTrackedTurn = event.turnId !== undefined && event.turnId === current.turnId;
  const base: TurnLiveness =
    current.seededFromSnapshot || (current.resumedProbation === true && provesTrackedTurn)
      ? { ...current, seededFromSnapshot: false, resumedProbation: false }
      : current;

  switch (event.type) {
    case "item.started":
    case "item.updated": {
      if (
        event.itemId === undefined ||
        !("itemType" in event.payload) ||
        typeof event.payload.itemType !== "string" ||
        !isToolLifecycleItemType(event.payload.itemType)
      ) {
        return { ...base, lastEventAtMs: nowMs };
      }
      const openItems = new Map(base.openItems);
      openItems.set(event.itemId, event.payload.itemType);
      return { ...base, lastEventAtMs: nowMs, openItems };
    }
    case "item.completed": {
      if (event.itemId === undefined || !base.openItems.has(event.itemId)) {
        return { ...base, lastEventAtMs: nowMs };
      }
      const openItems = new Map(base.openItems);
      openItems.delete(event.itemId);
      return { ...base, lastEventAtMs: nowMs, openItems };
    }
    case "request.opened":
    case "user-input.requested": {
      if (event.requestId === undefined) return { ...base, lastEventAtMs: nowMs };
      const openRequests = new Set(base.openRequests);
      openRequests.add(event.requestId);
      return { ...base, lastEventAtMs: nowMs, openRequests };
    }
    case "request.resolved":
    case "user-input.resolved": {
      if (event.requestId === undefined || !base.openRequests.has(event.requestId)) {
        return { ...base, lastEventAtMs: nowMs };
      }
      const openRequests = new Set(base.openRequests);
      openRequests.delete(event.requestId);
      return { ...base, lastEventAtMs: nowMs, openRequests };
    }
    default:
      return { ...base, lastEventAtMs: nowMs };
  }
}

export interface StallThresholds {
  /** Silence tolerated while waiting on the model during a live turn. */
  readonly modelSilenceMs: number;
  /** Grace given to snapshot-seeded turns to prove they survived a restart. */
  readonly recoveryGraceMs: number;
}

export interface StalledTurn {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly silentForMs: number;
  readonly reason: "model-silence" | "orphaned-after-restart" | "suspend-silence";
}

/**
 * Rebase liveness across a detected VM suspend (the host paused this machine
 * and resumed it later; the wall clock jumped while nothing actually ran).
 *
 * The paused interval must not count toward any silence budget, so every
 * entry's clock restarts at the resume. Turns that were waiting on the model
 * additionally enter resume probation: their provider stream almost certainly
 * died with the suspended TCP connections, so instead of the full silence
 * budget they get the short recovery grace to prove themselves with a live
 * event. Tool and human waits carry no such suspicion — local subprocesses
 * survive a suspend, and human waits are unbounded by design.
 */
export function rebaseAfterSuspend(
  entries: Map<ThreadId, TurnLiveness>,
  resumedAtMs: number,
): void {
  for (const [threadId, liveness] of entries) {
    entries.set(threadId, {
      ...liveness,
      lastEventAtMs: resumedAtMs,
      resumedProbation: !liveness.seededFromSnapshot && classifyWait(liveness) === "model",
    });
  }
}

/**
 * Decide which tracked turns are stalled at `nowMs`.
 *
 * Turns waiting on a tool or on the human are never stalled here, no matter
 * how long they have been silent — their liveness is guaranteed elsewhere
 * (tool waits by the provider subprocess exit handler, human waits by the
 * pending request itself).
 */
export function stalledTurns(
  entries: ReadonlyMap<ThreadId, TurnLiveness>,
  nowMs: number,
  thresholds: StallThresholds,
): StalledTurn[] {
  const stalled: StalledTurn[] = [];
  for (const [threadId, liveness] of entries) {
    if (classifyWait(liveness) !== "model") continue;
    const silentForMs = nowMs - liveness.lastEventAtMs;
    const probation = liveness.seededFromSnapshot || liveness.resumedProbation === true;
    const threshold = probation ? thresholds.recoveryGraceMs : thresholds.modelSilenceMs;
    if (silentForMs < threshold) continue;
    stalled.push({
      threadId,
      turnId: liveness.turnId,
      silentForMs,
      reason: liveness.seededFromSnapshot
        ? "orphaned-after-restart"
        : liveness.resumedProbation === true
          ? "suspend-silence"
          : "model-silence",
    });
  }
  return stalled;
}
