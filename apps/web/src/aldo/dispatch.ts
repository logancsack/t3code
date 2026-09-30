// Sending to a thread whose cloud agent is asleep, or doesn't exist yet (a
// thread's machine is created when its first message is sent): T3 hands each
// command here before sending it; Aldo creates or wakes the machine and
// connects to it, and then T3 sends the command as usual. Until then the
// thread shows the message and "Creating your cloud agent" or "Reconnecting to
// the cloud". Settling, archiving, pinning, snoozing, renaming or deleting a
// sleeping machine's thread doesn't wake it: it's done at once, and Aldo keeps
// the command for the machine (threadCommands.ts).

import { setOrchestrationCommandDispatchOverride } from "@t3tools/client-runtime/operations";
import type { EnvironmentId } from "@t3tools/contracts";

import { environmentCatalog } from "../connection/catalog";
import { keepAldoCommand } from "./threadCommands";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "../state/presentation";
import { toastManager } from "../components/ui/toast";
import {
  AldoApiError,
  aldoMachineIsNew,
  isAldoCloud,
  isAldoEnvironmentId,
  requestAldoDirectoryRefresh,
  wakeAldoEnvironment,
} from "./cloud";

const CONNECT_WAIT_MS = 3 * 60_000;
const NUDGE_EVERY_MS = 8_000;

const inFlight = new Map<string, Promise<void>>();
/** Whether each machine being brought up is new or waking, for the thread's status line. */
const starting = new Map<string, "creating" | "reconnecting">();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isAldoConnected(environmentId: string): boolean {
  const presentation = appAtomRegistry.get(
    environmentPresentations.presentationAtom(environmentId as EnvironmentId),
  );
  return presentation?.connection.phase === "connected";
}

/** What the thread says while its message waits for the cloud agent. */
export function aldoStartingLabel(environmentId: string): string {
  const kind =
    starting.get(environmentId) ?? (aldoMachineIsNew(environmentId) ? "creating" : "reconnecting");
  return kind === "creating" ? "Creating your cloud agent" : "Reconnecting to the cloud";
}

/** Creates or wakes a thread's cloud agent and waits until the client is connected to it. */
export function ensureAldoConnected(environmentId: string): Promise<void> {
  if (isAldoConnected(environmentId)) return Promise.resolve();
  const existing = inFlight.get(environmentId);
  if (existing) return existing;
  starting.set(environmentId, aldoMachineIsNew(environmentId) ? "creating" : "reconnecting");
  const run = (async () => {
    // Aldo creates the machine the first time, else resumes it, and returns once T3 is up.
    await wakeAldoEnvironment(environmentId);
    requestAldoDirectoryRefresh();
    // A sleeping machine's connection waits to be told to try again.
    const deadline = Date.now() + CONNECT_WAIT_MS;
    let nextNudge = 0;
    let connectedChecks = 0;
    while (Date.now() < deadline) {
      connectedChecks = isAldoConnected(environmentId) ? connectedChecks + 1 : 0;
      if (connectedChecks >= 2) return;
      if (Date.now() >= nextNudge) {
        nextNudge = Date.now() + NUDGE_EVERY_MS;
        void runAtomCommand(
          appAtomRegistry,
          environmentCatalog.retryNow,
          environmentId as EnvironmentId,
          { reportFailure: false },
        );
      }
      await sleep(250);
    }
    throw new Error("The cloud agent didn't come online. Try sending again.");
  })().finally(() => {
    inFlight.delete(environmentId);
    starting.delete(environmentId);
  });
  inFlight.set(environmentId, run);
  return run;
}

/** When each machine was last sent a message, so a preload knows whether it was used. */
const lastSentAt = new Map<string, number>();

export function aldoLastSentAt(environmentId: string): number {
  return lastSentAt.get(environmentId) ?? 0;
}

/** Routes commands for Aldo threads through ensureAldoConnected. */
export function installAldoCommandDispatch(): void {
  if (!isAldoCloud) return;
  setOrchestrationCommandDispatchOverride(async ({ command, environmentId }) => {
    if (!isAldoEnvironmentId(environmentId)) return null;
    if (command.type === "thread.turn.start") lastSentAt.set(environmentId, Date.now());
    // Settling, archiving, renaming... a sleeping machine's thread: at once, without waking it.
    // (Not while this tab is bringing the machine up for a message: those wait for it, in order.)
    const kept = inFlight.has(environmentId) ? null : await keepAldoCommand(environmentId, command);
    if (kept) return kept;
    await ensureAldoConnected(environmentId).catch((cause: unknown) => {
      notifyAldoRefusal(cause);
      throw cause;
    });
    return null;
  });
}

let refusalToastId: string | null = null;

/**
 * Tells the user why their cloud agent can't start, when Aldo refused it: no
 * plan or credits left (402), or the plan's agents at once already running
 * (409). Only for what the user asked for (a message, or a thread with nothing
 * else to show): preloads fail quietly.
 */
export function notifyAldoRefusal(cause: unknown): void {
  if (!(cause instanceof AldoApiError) || (cause.status !== 402 && cause.status !== 409)) return;
  // One at a time: another refused send replaces it rather than stacking.
  if (refusalToastId !== null) toastManager.close(refusalToastId);
  refusalToastId = toastManager.add({
    type: "warning",
    title: cause.status === 402 ? "This cloud agent can't start" : "Too many cloud agents at once",
    description: cause.message,
    timeout: 0,
    ...(cause.status === 402
      ? {
          actionProps: {
            children: "Open Usage",
            onClick: () => window.location.assign("/usage"),
          },
        }
      : {}),
  });
}
