import type { ThreadMachineStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveThreadMachineView,
  isThreadMachineActivity,
  threadMachineSidebarStatus,
} from "./threadMachine";

const UPDATED_AT = "2026-09-26T10:00:00.000Z";

function machine(
  state: ThreadMachineStatus["state"],
  detail: string | null = null,
): ThreadMachineStatus {
  return { state, detail, updatedAt: UPDATED_AT };
}

describe("deriveThreadMachineView", () => {
  it("has nothing to show without a machine", () => {
    expect(deriveThreadMachineView(null)).toBeNull();
    expect(deriveThreadMachineView(undefined)).toBeNull();
  });

  it("treats preparing and starting as transitional and surfaces platform progress", () => {
    expect(deriveThreadMachineView(machine("preparing"))).toMatchObject({
      phase: "transitional",
      label: "Preparing",
      detail: null,
    });
    expect(deriveThreadMachineView(machine("starting", "  Cloning repository  "))).toMatchObject({
      phase: "transitional",
      label: "Starting",
      description: "Cloning repository",
      detail: "Cloning repository",
    });
  });

  it("reads paused and saved machines as asleep until the next send", () => {
    for (const state of ["paused", "saved"] as const) {
      expect(deriveThreadMachineView(machine(state))).toMatchObject({
        phase: "asleep",
        label: "Asleep",
        description: "Machine asleep — wakes when you send",
      });
    }
  });

  it("reads a missing machine as one that starts on send", () => {
    expect(deriveThreadMachineView(machine("none"))).toMatchObject({
      phase: "asleep",
      description: "No machine yet — one starts when you send",
    });
  });

  it("keeps the platform's error for a failed machine", () => {
    expect(deriveThreadMachineView(machine("failed", "Out of capacity"))).toMatchObject({
      phase: "failed",
      label: "Failed",
      detail: "Out of capacity",
      description: "Out of capacity",
      updatedAt: UPDATED_AT,
    });
    expect(deriveThreadMachineView(machine("failed", "   "))).toMatchObject({
      detail: null,
      description: "This thread's machine could not start",
    });
  });

  it("reads a running machine as running", () => {
    expect(deriveThreadMachineView(machine("running"))).toMatchObject({
      phase: "running",
      label: "Running",
    });
  });
});

describe("isThreadMachineActivity", () => {
  it("matches every thread-machine lifecycle kind and nothing else", () => {
    expect(isThreadMachineActivity("thread-machine.state")).toBe(true);
    expect(isThreadMachineActivity("thread-machine.starting")).toBe(true);
    expect(isThreadMachineActivity("thread-machine.checkout.preparing")).toBe(true);
    expect(isThreadMachineActivity("thread-machine.failed")).toBe(true);
    expect(isThreadMachineActivity("tool.completed")).toBe(false);
    expect(isThreadMachineActivity("setup-script.started")).toBe(false);
  });
});

describe("threadMachineSidebarStatus", () => {
  it("maps motion to working, failure to failed, and rest to nothing", () => {
    expect(threadMachineSidebarStatus(machine("starting"))).toBe("working");
    expect(threadMachineSidebarStatus(machine("preparing"))).toBe("working");
    expect(threadMachineSidebarStatus(machine("failed"))).toBe("failed");
    expect(threadMachineSidebarStatus(machine("paused"))).toBeNull();
    expect(threadMachineSidebarStatus(machine("running"))).toBeNull();
    expect(threadMachineSidebarStatus(null)).toBeNull();
  });
});
