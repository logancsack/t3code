// Sending to a thread whose cloud agent is asleep, or doesn't exist yet (a
// thread's machine is created when its first message is sent): T3 hands each
// command here before sending it; Aldo creates or wakes the machine and
// connects to it, and then T3 sends the command as usual. Until then the
// thread shows the message and "Creating your cloud agent" or "Reconnecting to
// the cloud", and a new thread shows in the sidebar meanwhile
// (startingThreads.ts). A message goes to Aldo first (holdAldoTurn), which
// brings the machine up and sends it even if this page goes away or a first
// boot takes minutes; T3 runs it once, however many times it's sent. For a
// message Aldo holds, this page tries again while what fails passes, and if
// it stops waiting first, shows Aldo's copy of the machine's threads, which
// says where the message stands (a start Aldo gave up on, and why). Settling, archiving, pinning, snoozing, renaming or
// deleting a sleeping machine's thread doesn't wake it: it's done at once, and
// Aldo keeps the command for the machine (threadCommands.ts).

import { setOrchestrationCommandDispatchOverride } from "@t3tools/client-runtime/operations";
import type { EnvironmentId } from "@t3tools/contracts";

import { environmentCatalog } from "../connection/catalog";
import { keepAldoCommand } from "./threadCommands";
import { aldoMachineConnected, releaseAldoStartingThreads } from "./startingThreads";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "../state/presentation";
import { toastManager } from "../components/ui/toast";
import {
  AldoApiError,
  aldoMachineIsNew,
  aldoStartState,
  getAldoEnvironments,
  holdAldoTurn,
  isAldoCloud,
  isAldoEnvironmentId,
  requestAldoDirectoryRefresh,
  wakeAldoEnvironment,
} from "./cloud";
import { describeAldoThreadStart } from "./threadStart.logic";

const CONNECT_WAIT_MS = 3 * 60_000;
const NUDGE_EVERY_MS = 8_000;
/** How long this page tries again, for a message Aldo holds, while bringing its machine up fails for a passing reason. */
const HELD_RETRY_MS = 15 * 60_000;
/** How long it keeps trying past that while Aldo says the message is still on its way (Aldo tries for about half an hour). */
const HELD_MAX_MS = 60 * 60_000;
/** How long this page keeps connecting, after it stopped waiting, to a machine Aldo is bringing up for a held message. */
const FOLLOW_MS = 30 * 60_000;

const inFlight = new Map<string, Promise<void>>();
/** Whether each machine being brought up is new or waking, for the thread's status line. */
const starting = new Map<string, "creating" | "reconnecting">();
/** The T3 thread of the message Aldo holds for each machine, while this page waits for it to go. */
const heldThreads = new Map<string, string>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Aldo said no (out of credits, too many agents at once, no such thread), not "not yet". */
function refused(cause: unknown): boolean {
  return (
    cause instanceof AldoApiError &&
    cause.status >= 400 &&
    cause.status < 500 &&
    cause.status !== 408 &&
    cause.status !== 429
  );
}

export function isAldoConnected(environmentId: string): boolean {
  const presentation = appAtomRegistry.get(
    environmentPresentations.presentationAtom(environmentId as EnvironmentId),
  );
  return presentation?.connection.phase === "connected";
}

/**
 * What the thread says while its message waits for the cloud agent: where
 * Aldo says the message it holds stands (waiting for room, trying again),
 * else what this page is doing for it.
 */
export function aldoStartingLabel(environmentId: string): string {
  const threadId = heldThreads.get(environmentId);
  const held = threadId === undefined ? null : aldoStartState(environmentId, threadId);
  if (held && held.state !== "starting") {
    const environment = getAldoEnvironments()?.find(
      (entry) => entry.environmentId === environmentId,
    );
    return describeAldoThreadStart({
      start: held,
      machine: environment?.state ?? null,
      repos: environment ? (environment.repos ?? [environment.repo]) : [],
    }).title;
  }
  const kind =
    starting.get(environmentId) ?? (aldoMachineIsNew(environmentId) ? "creating" : "reconnecting");
  return kind === "creating" ? "Creating your cloud agent" : "Reconnecting to the cloud";
}

/** Creates or wakes a thread's cloud agent and waits until the client is connected to it. */
export function ensureAldoConnected(environmentId: string): Promise<void> {
  if (isAldoConnected(environmentId)) {
    aldoMachineConnected(environmentId);
    return Promise.resolve();
  }
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
      if (connectedChecks >= 2) {
        aldoMachineConnected(environmentId);
        return;
      }
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
    // A message for a machine this page isn't connected to goes to Aldo first.
    const held =
      command.type === "thread.turn.start" &&
      !isAldoConnected(environmentId) &&
      (await holdAldoTurn(environmentId, command));
    if (!held) {
      await ensureAldoConnected(environmentId).catch((cause: unknown) => {
        notifyAldoRefusal(cause);
        throw cause;
      });
      return null;
    }
    heldThreads.set(environmentId, command.threadId);
    try {
      if (await connectForHeld(environmentId, command)) return null;
    } finally {
      heldThreads.delete(environmentId);
    }
    // Aldo has it and sends it when it can, so it stays sent (sending it
    // again from the draft would send it twice). From here the thread shows
    // as Aldo has it, which says if the message couldn't go, and this page
    // connects once the machine is up.
    releaseAldoStartingThreads(environmentId);
    requestAldoDirectoryRefresh();
    followAldoMachine(environmentId);
    return { sequence: 0 };
  });
}

/**
 * Brings the machine up for a message Aldo holds and connects to it, trying
 * again while what fails passes (Aldo or the network not answering, a start
 * still under way) for up to HELD_RETRY_MS, and past that for as long as
 * Aldo says the message is still on its way (up to HELD_MAX_MS). False when
 * this page stops waiting while Aldo still has it: Aldo said no for now (out
 * of credits, the plan's agents all busy), or the time ran out. Throws once
 * Aldo has given up on the message, with why (the message goes back in the
 * composer).
 */
async function connectForHeld(
  environmentId: string,
  command: { readonly threadId: string },
): Promise<boolean> {
  const deadline = Date.now() + HELD_RETRY_MS;
  const latest = Date.now() + HELD_MAX_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      await ensureAldoConnected(environmentId);
      return true;
    } catch (cause) {
      const held = aldoStartState(environmentId, command.threadId);
      if (held?.state === "failed") {
        const gaveUp =
          held.kind === "message"
            ? "Aldo couldn't send your message."
            : "Aldo couldn't start this thread.";
        throw new Error(held.detail ?? gaveUp, { cause });
      }
      if (refused(cause)) {
        notifyAldoRefusal(cause);
        return false;
      }
      const delay = Math.min(15_000, 2_000 * 2 ** attempt);
      if (Date.now() + delay >= (held ? latest : deadline)) return false;
      requestAldoDirectoryRefresh();
      await sleep(delay);
    }
  }
}

const following = new Set<string>();

/** Connects to a machine Aldo is bringing up for a held message once it's up, after this page stopped waiting. */
function followAldoMachine(environmentId: string): void {
  if (following.has(environmentId)) return;
  following.add(environmentId);
  void (async () => {
    const deadline = Date.now() + FOLLOW_MS;
    while (Date.now() < deadline && !isAldoConnected(environmentId)) {
      requestAldoDirectoryRefresh();
      void runAtomCommand(
        appAtomRegistry,
        environmentCatalog.retryNow,
        environmentId as EnvironmentId,
        { reportFailure: false },
      );
      await sleep(NUDGE_EVERY_MS);
    }
    if (isAldoConnected(environmentId)) aldoMachineConnected(environmentId);
  })().finally(() => following.delete(environmentId));
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
