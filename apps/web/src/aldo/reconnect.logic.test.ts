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
  const starting = { t1: { state: "starting" } };

  it("connects once the directory has the machine up", () => {
    expect(aldoHeldStartStep({ state: "ready", starts: starting }, "t1")).toBe("up");
    expect(aldoHeldStartStep({ state: "ready" }, "t1")).toBe("up");
  });

  it("follows Aldo's start of the held message rather than waking the machine too", () => {
    expect(aldoHeldStartStep({ state: "stopped", starts: starting }, "t1")).toBe("follow");
    expect(aldoHeldStartStep({ state: "new", starts: starting }, "t1")).toBe("follow");
  });

  it("wakes it when Aldo isn't bringing it up now, or doesn't say", () => {
    for (const state of ["queued", "retrying", "failed"]) {
      expect(aldoHeldStartStep({ state: "stopped", starts: { t1: { state } } }, "t1")).toBe("wake");
    }
    // Another thread's start, none, an older Aldo, or a machine the directory doesn't list.
    expect(aldoHeldStartStep({ state: "stopped", starts: starting }, "t2")).toBe("wake");
    expect(aldoHeldStartStep({ state: "stopped", starts: {} }, "t1")).toBe("wake");
    expect(aldoHeldStartStep({ state: "stopped" }, "t1")).toBe("wake");
    expect(aldoHeldStartStep(undefined, "t1")).toBe("wake");
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
