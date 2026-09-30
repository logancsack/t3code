// Settling, archiving, pinning, snoozing, renaming or deleting a thread whose
// machine sleeps, at once and without waking it. T3 sends each command to the
// thread's machine and shows the change when the machine's event comes back,
// so on a sleeping machine every one of these waited half a minute for it to
// wake. For a machine this browser isn't connected to, the change is made
// here instead, in T3's cached shell, as T3 would make it
// (threadCommands.logic.ts), and the command goes to Aldo with it: Aldo makes
// the same change to its copy, so the user's other devices see it, and sends
// the command to T3 now if the machine runs, else when it next starts. When
// the machine connects, T3's own shell replaces this one.

import type { EnvironmentId } from "@t3tools/contracts";

import { readCachedShells, seedEnvironmentCache } from "../connection/storage";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "../state/presentation";
import { environmentShell } from "../state/shell";
import {
  AldoApiError,
  aldoMachineIsNew,
  isAldoCloud,
  isAldoEnvironmentId,
  sendAldoThreadCommand,
} from "./cloud";
import {
  aldoCommandPatch,
  applyAldoShellPatch,
  type AldoShellThread,
  type AldoThreadCommand,
} from "./threadCommands.logic";

type CachedShell = { readonly snapshotSequence: number; readonly threads: AldoShellThread[] };

function phaseOf(environmentId: string): string | undefined {
  return appAtomRegistry
    .get(environmentPresentations.presentationsAtom)
    .get(environmentId as EnvironmentId)?.connection.phase;
}

/** Puts the shell in this browser's cache, and shows it if the machine isn't about to send its own. */
async function show(environmentId: string, shell: CachedShell): Promise<void> {
  await seedEnvironmentCache({
    environmentId: environmentId as EnvironmentId,
    shell,
    serverConfig: null,
  });
  const phase = phaseOf(environmentId);
  if (phase !== undefined && phase !== "connecting" && phase !== "reconnecting") {
    appAtomRegistry.refresh(environmentShell.stateAtom(environmentId as EnvironmentId));
  }
}

/**
 * Takes a command for a thread on a machine this browser isn't connected to,
 * if it's one a sleeping machine can take: the change shows at once, and
 * Aldo has the command. Returns T3's dispatch result, or null for the command
 * to go to the machine as usual (woken if it sleeps).
 */
export async function keepAldoCommand(
  environmentId: string,
  command: { readonly type: string },
): Promise<{ sequence: number } | null> {
  if (
    !isAldoCloud ||
    !isAldoEnvironmentId(environmentId) ||
    phaseOf(environmentId) === "connected" ||
    aldoMachineIsNew(environmentId) ||
    typeof (command as { threadId?: unknown }).threadId !== "string"
  ) {
    return null;
  }
  const threadCommand = command as AldoThreadCommand;
  const cached = (await readCachedShells([environmentId as EnvironmentId])).get(
    environmentId as EnvironmentId,
  );
  if (!cached) return null;
  const shell = cached.snapshot as CachedShell;
  const thread = shell.threads.find((entry) => entry.id === threadCommand.threadId) ?? null;
  const patch = aldoCommandPatch(threadCommand, thread, new Date().toISOString());
  if (patch === null) return null;
  if (patch === "nothing") return { sequence: shell.snapshotSequence };

  const changed: CachedShell = {
    ...shell,
    threads: applyAldoShellPatch(shell.threads, threadCommand.threadId, patch),
    snapshotSequence: shell.snapshotSequence + 1,
  };
  await show(environmentId, changed);
  try {
    const { sequence } = await sendAldoThreadCommand(environmentId, command, patch);
    // Aldo's copy is ahead of this one: the next directory fetch brings it.
    return { sequence: Math.max(changed.snapshotSequence, sequence ?? 0) };
  } catch (cause) {
    await show(environmentId, shell).catch(() => undefined);
    // An Aldo without kept commands: the machine takes it, as before.
    if (cause instanceof AldoApiError && cause.status === 404) return null;
    throw cause;
  }
}
