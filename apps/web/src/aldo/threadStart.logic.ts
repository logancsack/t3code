// What a thread Aldo is starting says until its machine has it: Aldo makes the
// thread at once (in the sidebar, connecting) and brings the machine up to
// send it its first message, which can take minutes, or wait for room on the
// plan, or try again. The directory says how each start stands (cloud.ts
// AldoStartState) and what its machine is doing; this is the words for it, in
// the thread (AldoThreadLoading.tsx) and the sidebar. Pure, so it's tested on
// its own.

import type { AldoEnvironment, AldoStartState } from "./cloud";

export type AldoThreadStartTone = "progress" | "waiting" | "retrying" | "failed";

/** The steps of a start, in the order the thread shows them. */
export const ALDO_START_STEPS = ["Machine", "Agent", "Conversation"] as const;

export interface AldoThreadStartView {
  readonly tone: AldoThreadStartTone;
  /** The sidebar's word for it, where a thread under way says "Working". */
  readonly label: "Starting" | "Sending" | "Queued" | "Retrying" | "Failed";
  /** What's happening, in a line. */
  readonly title: string;
  /** What happens next. */
  readonly body: string;
  /** Why it waits or failed, as Aldo said it (null when it didn't say). */
  readonly reason: string | null;
  /** The step of ALDO_START_STEPS it's on; null once it failed. */
  readonly step: number | null;
}

/** "a", "a and b", "a, b and c". */
function listed(items: ReadonlyArray<string>): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * Aldo's reason, without advice to try again (a refusal says that to a
 * person starting a machine; Aldo tries again on its own) or the "Couldn't
 * start:" (or "Couldn't send your message:") a failed one's error line opens with.
 */
export function aldoStartReason(detail: string | undefined | null): string | null {
  const reason = (detail ?? "")
    .replace(/^Couldn't (start|send your message):\s*/i, "")
    .replace(/\s*Try again\b[^.]*\.?/g, "")
    .trim();
  return reason.length > 0 ? reason : null;
}

const SOON = "The agent gets its first message as soon as it's up.";

export function describeAldoThreadStart(input: {
  readonly start: AldoStartState;
  /** The machine's state in the directory; null if the directory doesn't list it. */
  readonly machine: AldoEnvironment["state"] | null;
  readonly repos: ReadonlyArray<string>;
}): AldoThreadStartView {
  const { start, machine } = input;
  const repos = input.repos.filter((repo) => repo.length > 0);
  const reason = aldoStartReason(start.detail);
  // The machine is up: what's left is its agent and the thread.
  const step = machine === "ready" ? 1 : 0;
  if (start.kind === "message") return describeHeldMessage(start, machine, reason, step);
  switch (start.state) {
    case "queued":
      return {
        tone: "waiting",
        label: "Queued",
        title: "Waiting for room to start",
        body: "Aldo starts it on its own as soon as it can.",
        reason,
        step: 0,
      };
    case "retrying":
      return {
        tone: "retrying",
        label: "Retrying",
        title: "Trying again",
        body: "Starting it didn't work, so Aldo is trying again on its own.",
        reason,
        step,
      };
    case "failed":
      return {
        tone: "failed",
        label: "Failed",
        title: "Couldn't start this thread",
        body: "Its first message never reached the agent.",
        reason,
        step: null,
      };
    case "starting":
      if (machine === "ready") {
        return {
          tone: "progress",
          label: "Starting",
          title: "Starting the agent",
          body: "Its machine is up. The agent gets its first message in a moment.",
          reason: null,
          step,
        };
      }
      if (machine === "stopped") {
        return {
          tone: "progress",
          label: "Starting",
          title: "Waking your cloud agent",
          body: `Its machine is starting again. ${SOON}`,
          reason: null,
          step,
        };
      }
      return {
        tone: "progress",
        label: "Starting",
        title: "Creating your cloud agent",
        body:
          repos.length > 0
            ? `Setting up its machine and cloning ${listed(repos)}. ${SOON}`
            : `Setting up its machine. ${SOON}`,
        reason: null,
        step,
      };
  }
}

/**
 * A message to a thread that's there, which Aldo holds until its machine is up
 * (the device wasn't connected to it when the message was sent): on its way,
 * waiting for room, trying again, or not sent.
 */
function describeHeldMessage(
  start: AldoStartState,
  machine: AldoEnvironment["state"] | null,
  reason: string | null,
  step: number,
): AldoThreadStartView {
  switch (start.state) {
    case "queued":
      return {
        tone: "waiting",
        label: "Queued",
        title: "Waiting for room to send your message",
        body: "Aldo sends it on its own as soon as it can.",
        reason,
        step: 0,
      };
    case "retrying":
      return {
        tone: "retrying",
        label: "Retrying",
        title: "Trying again",
        body: "Sending your message didn't work, so Aldo is trying again on its own.",
        reason,
        step,
      };
    case "failed":
      return {
        tone: "failed",
        label: "Failed",
        title: "Couldn't send your message",
        body: "It never reached the agent. Send it again to try once more.",
        reason,
        step: null,
      };
    case "starting":
      return machine === "ready"
        ? {
            tone: "progress",
            label: "Sending",
            title: "Sending your message",
            body: "Its machine is up. The agent gets it in a moment.",
            reason: null,
            step,
          }
        : {
            tone: "progress",
            label: "Sending",
            title: "Waking your cloud agent",
            body: "Its machine is starting again. Your message goes to the agent as soon as it's up.",
            reason: null,
            step,
          };
  }
}

/** "45s", "2m 05s", "1h 02m": how long it has been at it. */
export function formatAldoStartElapsed(elapsedMs: number): string {
  const seconds = Number.isFinite(elapsedMs) ? Math.max(0, Math.floor(elapsedMs / 1000)) : 0;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
