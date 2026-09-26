import { type ScopedThreadRef, ThreadMachineControlError } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import { useCallback, useState } from "react";

import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import type { ThreadMachineView } from "../../threadMachine";
import { stackedThreadToast, toastManager } from "../ui/toast";

/**
 * Explicit machine lifecycle requests for a hub thread
 * (`threadMachines.wake` / `threadMachines.pause`). Turns, terminals, file
 * writes and git actions still wake a machine on their own.
 */
export type ThreadMachineControl = "wake" | "pause";

/** The control a hub thread offers: wake a sleeping or failed machine, pause a running one. */
export function threadMachineControlFor(
  view: ThreadMachineView | null | undefined,
): ThreadMachineControl | null {
  switch (view?.phase) {
    case "asleep":
    case "failed":
      return "wake";
    case "running":
      return "pause";
    default:
      return null;
  }
}

const isThreadMachineControlError = Schema.is(ThreadMachineControlError);

export interface ThreadMachineControlNotice {
  readonly type: "warning" | "error";
  readonly title: string;
  readonly description: string;
}

/** What to tell the user when a control fails. */
export function describeThreadMachineControlFailure(
  control: ThreadMachineControl,
  error: unknown,
): ThreadMachineControlNotice {
  if (isThreadMachineControlError(error) && error.reason === "busy") {
    return { type: "warning", title: "Machine is busy", description: error.detail };
  }
  return {
    type: "error",
    title: control === "wake" ? "Could not wake machine" : "Could not pause machine",
    description:
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "An error occurred.",
  };
}

/**
 * Wake and pause for hub threads, reporting failures as toasts. `pending`
 * names the control in flight from this caller, for disabling its button.
 */
export function useThreadMachineControls() {
  const wakeMachine = useAtomCommand(threadEnvironment.wakeMachine, { reportFailure: false });
  const pauseMachine = useAtomCommand(threadEnvironment.pauseMachine, { reportFailure: false });
  const [pending, setPending] = useState<ThreadMachineControl | null>(null);

  const run = useCallback(
    async (control: ThreadMachineControl, threadRef: ScopedThreadRef): Promise<boolean> => {
      setPending(control);
      const target = {
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      };
      const result = await (control === "wake" ? wakeMachine(target) : pauseMachine(target));
      setPending(null);
      if (result._tag === "Success") {
        if (control === "pause") {
          toastManager.add(
            stackedThreadToast({
              type: "info",
              title: "Machine released",
              description: "It pauses shortly. Sending a message wakes it again.",
              timeout: 5_000,
            }),
          );
        }
        return true;
      }
      if (!isAtomCommandInterrupted(result)) {
        toastManager.add(
          stackedThreadToast(
            describeThreadMachineControlFailure(control, squashAtomCommandFailure(result)),
          ),
        );
      }
      return false;
    },
    [pauseMachine, wakeMachine],
  );

  const wake = useCallback((threadRef: ScopedThreadRef) => run("wake", threadRef), [run]);
  const pause = useCallback((threadRef: ScopedThreadRef) => run("pause", threadRef), [run]);
  return { wake, pause, pending };
}
