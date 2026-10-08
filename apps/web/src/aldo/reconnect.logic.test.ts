import { describe, expect, it } from "vite-plus/test";

import { aldoMachinesToRetry, type AldoReconnectEntry } from "./reconnect.logic";

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
