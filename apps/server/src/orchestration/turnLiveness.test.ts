import {
  EventId,
  ProviderDriverKind,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyRuntimeEvent,
  classifyWait,
  seededTurnLiveness,
  stalledTurns,
  type TurnLiveness,
} from "./turnLiveness.ts";

const threadId = ThreadId.make("thread-1");
const turnId = TurnId.make("turn-1");
const provider = ProviderDriverKind.make("codex");

let eventCounter = 0;
function event(partial: {
  type: ProviderRuntimeEvent["type"];
  payload?: unknown;
  itemId?: string;
  requestId?: string;
  turnId?: string;
}): ProviderRuntimeEvent {
  eventCounter += 1;
  return {
    eventId: EventId.make(`event-${eventCounter}`),
    provider,
    threadId,
    createdAt: "2026-07-30T00:00:00.000Z",
    turnId: TurnId.make(partial.turnId ?? turnId),
    ...(partial.itemId !== undefined ? { itemId: partial.itemId } : {}),
    ...(partial.requestId !== undefined ? { requestId: partial.requestId } : {}),
    type: partial.type,
    payload: partial.payload ?? {},
  } as ProviderRuntimeEvent;
}

function runningTurn(nowMs: number): TurnLiveness {
  const started = applyRuntimeEvent(undefined, event({ type: "turn.started" }), nowMs);
  if (started === null) throw new Error("turn.started must create a liveness entry");
  return started;
}

const thresholds = { modelSilenceMs: 600_000, recoveryGraceMs: 90_000 };

describe("turnLiveness", () => {
  it("tracks a turn from turn.started and drops it when the turn ends", () => {
    const started = runningTurn(1_000);
    expect(started.turnId).toBe(turnId);
    expect(classifyWait(started)).toBe("model");

    expect(applyRuntimeEvent(started, event({ type: "turn.completed" }), 2_000)).toBeNull();
    expect(applyRuntimeEvent(started, event({ type: "turn.aborted" }), 2_000)).toBeNull();
    expect(applyRuntimeEvent(started, event({ type: "session.exited" }), 2_000)).toBeNull();
  });

  it("ignores events for threads with no tracked turn", () => {
    expect(applyRuntimeEvent(undefined, event({ type: "content.delta" }), 1_000)).toBeNull();
  });

  it("classifies an open command execution as a tool wait that never stalls", () => {
    let liveness = runningTurn(0);
    liveness = applyRuntimeEvent(
      liveness,
      event({
        type: "item.started",
        itemId: "item-1",
        payload: { itemType: "command_execution", title: "Command", detail: "pnpm build" },
      }),
      1_000,
    )!;
    expect(classifyWait(liveness)).toBe("tool");

    // Hours of silence while the build runs: never reported as stalled.
    const hoursLater = 8 * 60 * 60 * 1000;
    expect(stalledTurns(new Map([[threadId, liveness]]), hoursLater, thresholds)).toEqual([]);

    liveness = applyRuntimeEvent(
      liveness,
      event({
        type: "item.completed",
        itemId: "item-1",
        payload: { itemType: "command_execution", title: "Command" },
      }),
      hoursLater,
    )!;
    expect(classifyWait(liveness)).toBe("model");
  });

  it("classifies pending approvals and user input as human waits that never stall", () => {
    let liveness = runningTurn(0);
    liveness = applyRuntimeEvent(
      liveness,
      event({
        type: "request.opened",
        requestId: "request-1",
        payload: { requestType: "command_execution_approval" },
      }),
      1_000,
    )!;
    expect(classifyWait(liveness)).toBe("human");

    const daysLater = 3 * 24 * 60 * 60 * 1000;
    expect(stalledTurns(new Map([[threadId, liveness]]), daysLater, thresholds)).toEqual([]);

    liveness = applyRuntimeEvent(
      liveness,
      event({
        type: "request.resolved",
        requestId: "request-1",
        payload: { requestType: "command_execution_approval", decision: "approve" },
      }),
      daysLater,
    )!;
    expect(classifyWait(liveness)).toBe("model");
  });

  it("reports a model wait as stalled only after the silence threshold", () => {
    const liveness = runningTurn(0);
    const entries = new Map([[threadId, liveness]]);

    expect(stalledTurns(entries, thresholds.modelSilenceMs - 1, thresholds)).toEqual([]);
    expect(stalledTurns(entries, thresholds.modelSilenceMs, thresholds)).toEqual([
      {
        threadId,
        turnId,
        silentForMs: thresholds.modelSilenceMs,
        reason: "model-silence",
      },
    ]);
  });

  it("streaming content resets the stall clock", () => {
    let liveness = runningTurn(0);
    liveness = applyRuntimeEvent(liveness, event({ type: "content.delta" }), 599_000)!;
    const entries = new Map([[threadId, liveness]]);
    expect(stalledTurns(entries, 600_000, thresholds)).toEqual([]);
    expect(stalledTurns(entries, 599_000 + thresholds.modelSilenceMs, thresholds)).toHaveLength(1);
  });

  it("judges snapshot-seeded turns against the recovery grace and live events reclassify them", () => {
    const seeded = seededTurnLiveness(turnId, 0);
    const entries = new Map([[threadId, seeded]]);

    expect(stalledTurns(entries, thresholds.recoveryGraceMs - 1, thresholds)).toEqual([]);
    expect(stalledTurns(entries, thresholds.recoveryGraceMs, thresholds)).toEqual([
      {
        threadId,
        turnId,
        silentForMs: thresholds.recoveryGraceMs,
        reason: "orphaned-after-restart",
      },
    ]);

    // A live event proves the turn survived: back to the normal threshold.
    const revived = applyRuntimeEvent(seeded, event({ type: "content.delta" }), 10_000)!;
    expect(revived.seededFromSnapshot).toBe(false);
    expect(
      stalledTurns(new Map([[threadId, revived]]), 10_000 + thresholds.recoveryGraceMs, {
        ...thresholds,
      }),
    ).toEqual([]);
  });

  it("a new turn.started resets item and request state from the previous turn", () => {
    let liveness = runningTurn(0);
    liveness = applyRuntimeEvent(
      liveness,
      event({
        type: "item.started",
        itemId: "item-1",
        payload: { itemType: "command_execution" },
      }),
      1_000,
    )!;
    const next = applyRuntimeEvent(
      liveness,
      event({ type: "turn.started", turnId: "turn-2" }),
      2_000,
    )!;
    expect(next.turnId).toBe(TurnId.make("turn-2"));
    expect(next.openItems.size).toBe(0);
    expect(classifyWait(next)).toBe("model");
  });

  it("only tool lifecycle item types open a tool wait", () => {
    let liveness = runningTurn(0);
    liveness = applyRuntimeEvent(
      liveness,
      event({
        type: "item.started",
        itemId: "item-2",
        payload: { itemType: "assistant_message" },
      }),
      1_000,
    )!;
    expect(classifyWait(liveness)).toBe("model");
  });
});
