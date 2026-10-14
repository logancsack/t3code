import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

type Shell = { snapshotSequence: number; threads: Array<Record<string, unknown>> };

/** This browser's cached shell of the machine, and what Aldo answers a kept command. */
const device = vi.hoisted(() => ({
  shell: null as Shell | null,
  aldo: (): Promise<{ sequence: number | null }> => Promise.resolve({ sequence: null }),
  sent: [] as Array<{ command: unknown; patch: unknown; base: number }>,
}));

vi.mock("./cloud", () => {
  class AldoApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    AldoApiError,
    isAldoCloud: true,
    isAldoEnvironmentId: (id: string) => id.startsWith("aldo-"),
    aldoMachineIsAsleep: () => true,
    aldoMachineIsNew: () => false,
    fetchAldoShells: async () => ({}),
    threadIdForEnvironment: (id: string) => id.slice("aldo-".length),
    sendAldoThreadCommand: async (
      _environmentId: string,
      command: unknown,
      patch: unknown,
      base: number,
    ) => {
      device.sent.push({ command, patch, base });
      return device.aldo();
    },
  };
});
vi.mock("../connection/storage", () => ({
  readCachedShells: async (ids: string[]) =>
    new Map(device.shell ? [[ids[0], { snapshot: device.shell }]] : []),
  seedEnvironmentCache: async (input: { shell: Shell }) => {
    device.shell = input.shell;
  },
}));
// Not connected to the machine.
vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: { get: () => new Map(), refresh: () => undefined },
}));
vi.mock("../state/presentation", () => ({ environmentPresentations: {} }));
vi.mock("../state/shell", () => ({ environmentShell: { stateAtom: () => ({}) } }));

import { AldoApiError } from "./cloud";
import { keepAldoCommand } from "./threadCommands";

const BEFORE = "2026-09-29T10:00:00.000Z";
const original = {
  id: "t1",
  updatedAt: BEFORE,
  settledOverride: null,
  pinnedAt: null,
  activeOrderKey: "a",
  autoSettleDisabledAt: null,
};
const reorder = { type: "thread.active.reorder", commandId: "c1", threadId: "t1", orderKey: "b" };

beforeEach(() => {
  device.shell = { snapshotSequence: 7, threads: [original] };
  device.aldo = () => Promise.resolve({ sequence: 8 });
  device.sent = [];
});

describe("keepAldoCommand", () => {
  it("arranges a sleeping machine's thread, and turns its auto-settle off, without waking it", async () => {
    expect(await keepAldoCommand("aldo-x", reorder)).toEqual({ sequence: 8 });
    expect(device.shell?.threads[0]?.activeOrderKey).toBe("b");
    expect(device.sent).toEqual([
      { command: reorder, patch: { set: { activeOrderKey: "b" } }, base: 7 },
    ]);

    device.aldo = () => Promise.resolve({ sequence: 9 });
    const off = { type: "thread.auto-settle.set", commandId: "c2", threadId: "t1", enabled: false };
    expect(await keepAldoCommand("aldo-x", off)).toEqual({ sequence: 9 });
    expect(device.shell?.threads[0]?.autoSettleDisabledAt).toEqual(expect.any(String));
    expect(device.sent[1]?.base).toBe(8);
  });

  it("leaves a command an older Aldo doesn't keep to the machine, as before", async () => {
    device.aldo = () =>
      Promise.reject(
        new AldoApiError(400, "Expected a T3 thread command Aldo can keep for a sleeping machine."),
      );
    expect(await keepAldoCommand("aldo-x", reorder)).toBeNull();
    // The thread is back as it was, for the machine's own answer.
    expect(device.shell).toEqual({ snapshotSequence: 7, threads: [original] });
  });

  it("still says why when the machine refused it", async () => {
    device.aldo = () => Promise.reject(new AldoApiError(409, "T3 refused thread.active.reorder"));
    await expect(keepAldoCommand("aldo-x", reorder)).rejects.toThrow("T3 refused");
    expect(device.shell).toEqual({ snapshotSequence: 7, threads: [original] });
  });
});
