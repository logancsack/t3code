import { describe, expect, it } from "vite-plus/test";

import { aldoMachinesToRetry, aldoWakeAgain, type AldoReconnectEntry } from "./reconnect.logic";

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
