import { ThreadId, ThreadMachineControlError } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveThreadMachineView } from "../../threadMachine";
import {
  describeThreadMachineControlFailure,
  threadMachineControlFor,
} from "./threadMachineActions";

const view = (state: "none" | "starting" | "running" | "paused" | "saved" | "failed") =>
  deriveThreadMachineView({ state, detail: null, updatedAt: "2026-09-26T10:00:00.000Z" });

describe("threadMachineControlFor", () => {
  it("wakes sleeping and failed machines and pauses running ones", () => {
    expect(threadMachineControlFor(view("paused"))).toBe("wake");
    expect(threadMachineControlFor(view("saved"))).toBe("wake");
    expect(threadMachineControlFor(view("none"))).toBe("wake");
    expect(threadMachineControlFor(view("failed"))).toBe("wake");
    expect(threadMachineControlFor(view("running"))).toBe("pause");
  });

  it("offers nothing while the machine is in motion or unknown", () => {
    expect(threadMachineControlFor(view("starting"))).toBeNull();
    expect(threadMachineControlFor(null)).toBeNull();
  });
});

describe("describeThreadMachineControlFailure", () => {
  const error = (reason: ThreadMachineControlError["reason"], detail: string) =>
    new ThreadMachineControlError({ operation: "threadMachines.pause", reason, detail });

  it("reports a busy machine as a warning with the server's reason", () => {
    expect(
      describeThreadMachineControlFailure("pause", error("busy", "A turn is running.")),
    ).toEqual({ type: "warning", title: "Machine is busy", description: "A turn is running." });
  });

  it("reports an unavailable machine as an error", () => {
    expect(
      describeThreadMachineControlFailure("wake", error("unavailable", "The directory failed.")),
    ).toEqual({
      type: "error",
      title: "Could not wake machine",
      description: "The directory failed.",
    });
    expect(
      describeThreadMachineControlFailure(
        "pause",
        new ThreadMachineControlError({
          operation: "threadMachines.pause",
          reason: "not-found",
          detail: `Thread ${ThreadId.make("t-1")} does not exist or is archived.`,
        }),
      ),
    ).toMatchObject({ type: "error", title: "Could not pause machine" });
  });

  it("falls back to a generic message for transport failures", () => {
    expect(describeThreadMachineControlFailure("wake", new Error("Socket closed"))).toMatchObject({
      type: "error",
      description: "Socket closed",
    });
    expect(describeThreadMachineControlFailure("wake", "boom")).toMatchObject({
      description: "An error occurred.",
    });
  });
});
