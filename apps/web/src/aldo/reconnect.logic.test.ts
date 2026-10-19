import { describe, expect, it } from "vite-plus/test";

import {
  aldoHeldStartStep,
  aldoMachinesToRetry,
  aldoWakeAgain,
  type AldoReconnectEntry,
} from "./reconnect.logic";

const machine = (
  environmentId: string,
  state: AldoReconnectEntry["state"],
): AldoReconnectEntry => ({ environmentId, state });

describe("aldoMachinesToRetry", () => {
  it("retries a machine the directory says is up whose connection was told it's asleep", () => {
    const phases = new Map([
      ["aldo-a", "available"],
      ["aldo-b", "connected"],
      ["aldo-c", "reconnecting"],
      ["aldo-d", "connecting"],
      ["aldo-e", "error"],
    ]);
    const environments = ["aldo-a", "aldo-b", "aldo-c", "aldo-d", "aldo-e"].map((id) =>
      machine(id, "ready"),
    );
    expect(aldoMachinesToRetry(environments, (id) => phases.get(id))).toEqual(["aldo-a"]);
  });

  it("leaves a machine that's asleep, never made, or failed, and one not registered yet", () => {
    const environments = [
      machine("aldo-a", "stopped"),
      machine("aldo-b", "new"),
      machine("aldo-c", "failed"),
      machine("aldo-d", "ready"),
    ];
    const phases = new Map([
      ["aldo-a", "available"],
      ["aldo-b", "available"],
      ["aldo-c", "available"],
    ]);
    expect(aldoMachinesToRetry(environments, (id) => phases.get(id))).toEqual([]);
  });

  it("retries one still connecting whose attempt was told it's asleep from the directory", () => {
    const phases = new Map([
      ["aldo-a", "connecting"],
      ["aldo-b", "connecting"],
      ["aldo-c", "connecting"],
    ]);
    const toldAsleep = new Set(["aldo-a", "aldo-c"]);
    const environments = [
      machine("aldo-a", "ready"),
      machine("aldo-b", "ready"),
      machine("aldo-c", "stopped"),
    ];
    expect(
      aldoMachinesToRetry(
        environments,
        (id) => phases.get(id),
        (id) => toldAsleep.has(id),
      ),
    ).toEqual(["aldo-a"]);
  });
});

describe("aldoHeldStartStep", () => {
  const now = Date.parse("2026-10-19T12:00:00.000Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const starting = { t1: { state: "starting", at: ago(5_000) } };
  const step = (machine: Parameters<typeof aldoHeldStartStep>[0], followedMs = 5_000) =>
    aldoHeldStartStep(machine, "t1", followedMs, now);

  it("goes on once the machine is up and Aldo has sent the message", () => {
    expect(step({ state: "ready" })).toBe("up");
    expect(step({ state: "ready", starts: {} })).toBe("up");
    expect(step({ state: "ready", starts: { t2: { state: "starting" } } })).toBe("up");
  });

  it("follows Aldo's start of the held message rather than waking the machine too, up or not", () => {
    expect(step({ state: "stopped", starts: starting })).toBe("follow");
    expect(step({ state: "new", starts: starting })).toBe("follow");
    // Up before Aldo has put the user's settings on it and sent the message.
    expect(step({ state: "ready", starts: starting })).toBe("follow");
    // An older Aldo doesn't say when it was sent.
    expect(step({ state: "stopped", starts: { t1: { state: "starting" } } })).toBe("follow");
  });

  it("wakes it once it has followed the start for 2.5 minutes, or the message was sent that long ago", () => {
    expect(step({ state: "stopped", starts: starting }, 149_000)).toBe("follow");
    expect(step({ state: "stopped", starts: starting }, 150_000)).toBe("wake");
    expect(step({ state: "ready", starts: starting }, 150_000)).toBe("wake");
    expect(
      step({ state: "stopped", starts: { t1: { state: "starting", at: ago(150_000) } } }),
    ).toBe("wake");
  });

  it("wakes it when Aldo isn't bringing it up now, or doesn't say and it isn't up", () => {
    for (const state of ["queued", "retrying", "failed"]) {
      expect(step({ state: "stopped", starts: { t1: { state } } })).toBe("wake");
      expect(step({ state: "ready", starts: { t1: { state } } })).toBe("wake");
    }
    // Another thread's start, none, an older Aldo, or a machine the directory doesn't list.
    expect(step({ state: "stopped", starts: { t2: { state: "starting" } } })).toBe("wake");
    expect(step({ state: "stopped", starts: {} })).toBe("wake");
    expect(step({ state: "stopped" })).toBe("wake");
    expect(step(undefined)).toBe("wake");
  });
});

describe("aldoWakeAgain", () => {
  it("asks again for a wake that got no answer", () => {
    expect(aldoWakeAgain(null)).toBe(true);
  });

  it("asks again when a gateway gave up waiting or Aldo said not yet", () => {
    for (const status of [408, 429, 502, 503, 504]) expect(aldoWakeAgain(status)).toBe(true);
  });

  it("leaves a refusal or a start that failed to the user", () => {
    for (const status of [400, 401, 402, 404, 409, 410, 500])
      expect(aldoWakeAgain(status)).toBe(false);
  });
});
