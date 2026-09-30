/**
 * Presentation of a hub thread's machine (docs/internals/thread-machines.md).
 *
 * The hub projects the machine's latest known state onto the thread shell
 * without waking it; everything a client shows about the machine derives from
 * that one field, so the header pill, the timeline, the composer banner and
 * the sidebar cannot disagree.
 */
import type { ThreadMachineStatus } from "@t3tools/contracts";

export type ThreadMachinePhase = "transitional" | "running" | "asleep" | "failed";

export interface ThreadMachineView {
  readonly state: ThreadMachineStatus["state"];
  readonly phase: ThreadMachinePhase;
  /** Short label for the header pill. */
  readonly label: string;
  /** One sentence for tooltips and banners. */
  readonly description: string;
  /** What the platform reported (progress or error), when it said anything. */
  readonly detail: string | null;
  readonly updatedAt: string;
}

function trimmedDetail(detail: string | null): string | null {
  const trimmed = detail?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function deriveThreadMachineView(
  machine: ThreadMachineStatus | null | undefined,
): ThreadMachineView | null {
  if (!machine) return null;
  const detail = trimmedDetail(machine.detail);
  const base = { state: machine.state, detail, updatedAt: machine.updatedAt } as const;
  switch (machine.state) {
    case "preparing":
      return {
        ...base,
        phase: "transitional",
        label: "Preparing",
        description: detail ?? "Preparing this thread's machine",
      };
    case "starting":
      return {
        ...base,
        phase: "transitional",
        label: "Starting",
        description: detail ?? "Starting this thread's machine",
      };
    case "running":
      return { ...base, phase: "running", label: "Running", description: "Machine running" };
    case "paused":
    case "saved":
      return {
        ...base,
        phase: "asleep",
        label: "Asleep",
        description: "Machine asleep — wakes when you send",
      };
    case "none":
      return {
        ...base,
        phase: "asleep",
        label: "No machine",
        description: "No machine yet — one starts when you send",
      };
    case "failed":
      return {
        ...base,
        phase: "failed",
        label: "Failed",
        description: detail ?? "This thread's machine could not start",
      };
  }
}

/** Machine lifecycle activities the hub records on a thread. */
export function isThreadMachineActivity(kind: string): boolean {
  return kind.startsWith("thread-machine.");
}

/**
 * The sidebar reads a machine in motion as working and a failed one as
 * failed; a sleeping or running machine says nothing on its own.
 */
export function threadMachineSidebarStatus(
  machine: ThreadMachineStatus | null | undefined,
): "working" | "failed" | null {
  const phase = deriveThreadMachineView(machine)?.phase;
  return phase === "transitional" ? "working" : phase === "failed" ? "failed" : null;
}
