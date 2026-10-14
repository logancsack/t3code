// Sending to a thread whose cloud agent is asleep, or doesn't exist yet (a
// thread's machine is created when its first message is sent): T3 hands each
// command here before sending it; Aldo creates or wakes the machine and
// connects to it, and then T3 sends the command as usual. Until then the
// thread shows the message and "Setting up its computer" or "Reconnecting to
// the cloud", and a new thread shows in the sidebar meanwhile
// (startingThreads.ts). A message goes to Aldo first (holdAldoTurn), which
// brings the machine up and sends it even if this page goes away or a first
// boot takes minutes; T3 runs it once, however many times it's sent. One with
// images or files goes to Aldo however the machine is, its files first
// (files.ts), and only Aldo sends it. The device keeps it until Aldo has it,
// trying again while Aldo doesn't answer, and after the app is next opened or
// back on screen if the page went away first (outbox.ts). For a
// message Aldo holds, this page tries again while what fails passes, and if
// it stops waiting first, shows Aldo's copy of the machine's threads, which
// says where the message stands (a start Aldo gave up on, and why). Settling, archiving, pinning, snoozing, renaming or
// deleting a sleeping machine's thread doesn't wake it: it's done at once, and
// Aldo keeps the command for the machine (threadCommands.ts).

import { setOrchestrationCommandDispatchOverride } from "@t3tools/client-runtime/operations";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { keepAldoCommand } from "./threadCommands";
import { aldoFilesOf } from "./files";
import { dropOutgoing, keepOutgoing, outgoing } from "./outbox";
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
import { aldoWakeAgain } from "./reconnect.logic";

const CONNECT_WAIT_MS = 3 * 60_000;
/** How long this page asks again for a wake that gets no answer: past the longest first boot (Aldo's wake waits up to 800s). */
const WAKE_RETRY_MS = 15 * 60_000;
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
 * Whether a message's images go inside it rather than uploading to the
 * thread's machine first: its cloud agent isn't up, so Aldo holds the message
 * with them and sends it even if the page goes away (handToAldo). Files can
 * only upload to the agent. Every way of sending a message asks this.
 */
export function aldoImagesGoInline(environmentId: string): boolean {
  return isAldoCloud && isAldoEnvironmentId(environmentId) && !isAldoConnected(environmentId);
}

/**
 * Whether to tell a machine's connection to try again now: only while it
 * waits to (backing off, or not trying). An attempt under way has a deadline
 * of its own, and a nudge would cut it off, so a slow one (a big thread's
 * first sync on a phone, say) would start over every few seconds; a nudge to
 * one connected drops it.
 */
function wantsNudge(environmentId: string): boolean {
  const state = AsyncResult.value(
    appAtomRegistry.get(environmentCatalog.stateAtom(environmentId as EnvironmentId)),
  );
  return (
    Option.isNone(state) ||
    (state.value.phase !== "connecting" && state.value.phase !== "connected")
  );
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
  return kind === "creating" ? "Setting up its computer" : "Reconnecting to the cloud";
}

/**
 * Asks Aldo to create the machine the first time, else resume it (it answers
 * once T3 is up), and again while the wake gets no answer (aldoWakeAgain),
 * for up to WAKE_RETRY_MS.
 */
async function wakeUntilAnswered(environmentId: string): Promise<void> {
  const deadline = Date.now() + WAKE_RETRY_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      await wakeAldoEnvironment(environmentId);
      return;
    } catch (cause) {
      // fetch rejects with a TypeError when no answer came at all.
      const status =
        cause instanceof AldoApiError
          ? cause.status
          : cause instanceof TypeError
            ? null
            : undefined;
      const delay = Math.min(15_000, 2_000 * 2 ** attempt);
      if (status === undefined || !aldoWakeAgain(status) || Date.now() + delay >= deadline) {
        throw cause;
      }
      await sleep(delay);
    }
  }
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
    await wakeUntilAnswered(environmentId);
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
      if (Date.now() >= nextNudge && wantsNudge(environmentId)) {
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
    throw new Error("Its computer didn't come online. Try sending again.");
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

/** Messages this page is handing to Aldo now, which resuming the outbox leaves to it. */
const handing = new Set<string>();

/**
 * Hands Aldo a message for a machine this page isn't connected to, or one with
 * `files` (files.ts), kept on the device with them until Aldo has it
 * (outbox.ts), trying again for as long as Aldo doesn't answer. `now`: this
 * page is connected to the machine, so it goes at once. True once Aldo holds
 * it; false when Aldo won't hold one without files (the page sends it itself,
 * as before).
 */
async function handToAldo(
  environmentId: string,
  command: { readonly commandId: string },
  files: ReadonlyMap<string, Blob> | null,
  now: boolean,
): Promise<boolean> {
  handing.add(command.commandId);
  try {
    await keepOutgoing(environmentId, command, files);
    const outcome = await holdAldoTurn(environmentId, command, files, now);
    await dropOutgoing(command.commandId);
    return outcome === "held";
  } catch (cause) {
    // Signed out: it goes once the user signs in again (the page is on its way there).
    // Anything else goes back in the composer, so it isn't also sent from here later.
    if (!(cause instanceof AldoApiError && cause.status === 401)) {
      await dropOutgoing(command.commandId);
    }
    throw cause;
  } finally {
    handing.delete(command.commandId);
  }
}

let resuming = false;

/**
 * Hands Aldo the messages a page went away from before Aldo had them (as the
 * app opens, comes back on screen, or is back online), with what's left of
 * their files. They go as held ones do, not at once: the turn they were sent
 * into may be long over.
 */
async function resumeAldoOutbox(): Promise<void> {
  if (resuming) return;
  resuming = true;
  try {
    for (const entry of await outgoing()) {
      if (handing.has(entry.commandId)) continue;
      const command = entry.command as { readonly commandId: string };
      if (await handToAldo(entry.environmentId, command, entry.files ?? null, false)) {
        requestAldoDirectoryRefresh();
      } else console.warn(`Aldo wouldn't hold message ${entry.commandId}; it wasn't sent.`);
    }
  } catch (cause) {
    console.warn("Couldn't hand Aldo the messages waiting on this device.", cause);
  } finally {
    resuming = false;
  }
}

/** Routes commands for Aldo threads through ensureAldoConnected. */
export function installAldoCommandDispatch(): void {
  if (!isAldoCloud) return;
  void resumeAldoOutbox();
  window.addEventListener("online", () => void resumeAldoOutbox());
  // A phone suspends a page it isn't showing: what it was sending carries on as it's back.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void resumeAldoOutbox();
  });
  setOrchestrationCommandDispatchOverride(async ({ command, environmentId }) => {
    if (!isAldoEnvironmentId(environmentId)) return null;
    if (command.type === "thread.turn.start") lastSentAt.set(environmentId, Date.now());
    // Settling, archiving, renaming... a sleeping machine's thread: at once, without waking it.
    // (Not while this tab is bringing the machine up for a message: those wait for it, in order.)
    const kept = inFlight.has(environmentId) ? null : await keepAldoCommand(environmentId, command);
    if (kept) return kept;
    // A message for a machine this page isn't connected to goes to Aldo first, and one with
    // files however the machine is: Aldo puts them on it, so only Aldo can send it.
    const files = command.type === "thread.turn.start" ? aldoFilesOf(command) : null;
    const connected = isAldoConnected(environmentId);
    const held =
      command.type === "thread.turn.start" &&
      (files !== null || !connected) &&
      (await handToAldo(environmentId, command, files, connected));
    if (!held) {
      await ensureAldoConnected(environmentId).catch((cause: unknown) => {
        notifyAldoRefusal(cause);
        throw cause;
      });
      return null;
    }
    heldThreads.set(environmentId, command.threadId);
    try {
      if (await connectForHeld(environmentId, command)) return files ? { sequence: 0 } : null;
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
      if (wantsNudge(environmentId)) {
        void runAtomCommand(
          appAtomRegistry,
          environmentCatalog.retryNow,
          environmentId as EnvironmentId,
          { reportFailure: false },
        );
      }
      await sleep(NUDGE_EVERY_MS);
    }
    if (isAldoConnected(environmentId)) aldoMachineConnected(environmentId);
  })().finally(() => following.delete(environmentId));
}

let refusalToastId: string | null = null;

/** Whether Aldo refused to start a cloud agent (402 or 409), which notifyAldoRefusal tells the user about. */
export function isAldoRefusal(cause: unknown): cause is AldoApiError {
  return cause instanceof AldoApiError && (cause.status === 402 || cause.status === 409);
}

/**
 * Tells the user why their cloud agent can't start, when Aldo refused it: no
 * plan or credits left (402), or the plan's agents at once already running
 * (409). Only for what the user asked for (a message, or a thread with nothing
 * else to show): preloads fail quietly.
 */
export function notifyAldoRefusal(cause: unknown): void {
  if (!isAldoRefusal(cause)) return;
  // One at a time: another refused send replaces it rather than stacking.
  if (refusalToastId !== null) toastManager.close(refusalToastId);
  refusalToastId = toastManager.add({
    type: "warning",
    title:
      cause.status === 402 ? "This thread's computer can't start" : "Too many computers at once",
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
