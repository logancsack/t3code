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
  aldoMachineIsAsleep,
  aldoMachineIsNew,
  fetchAldoShells,
  isAldoCloud,
  isAldoEnvironmentId,
  sendAldoThreadCommand,
  threadIdForEnvironment,
} from "./cloud";
import {
  aldoCommandPatch,
  applyAldoShellPatch,
  restoreAldoShellThread,
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

/** One change to a machine's cached shell at a time: each reads the one the last wrote. */
const locks = new Map<string, Promise<unknown>>();

function serially<T>(environmentId: string, run: () => Promise<T>): Promise<T> {
  const next = (locks.get(environmentId) ?? Promise.resolve()).then(run, run);
  locks.set(
    environmentId,
    next.catch(() => undefined),
  );
  return next;
}

async function cachedShell(environmentId: string): Promise<CachedShell | null> {
  const cached = (await readCachedShells([environmentId as EnvironmentId])).get(
    environmentId as EnvironmentId,
  );
  return (cached?.snapshot as CachedShell | undefined) ?? null;
}

/** Aldo's copy of the machine's shell into this browser's cache, when it's newer than `base`. */
async function takeAldoShell(environmentId: string, base: number): Promise<void> {
  const shells = await fetchAldoShells([threadIdForEnvironment(environmentId)]);
  const shell = shells[threadIdForEnvironment(environmentId)] as CachedShell | undefined;
  if (shell && shell.snapshotSequence > base) await show(environmentId, shell);
}

/**
 * Takes a command for a thread on a machine this browser isn't connected to,
 * if it's one a sleeping machine can take: the change shows at once, and
 * Aldo has the command. Returns T3's dispatch result, or null for the command
 * to go to the machine as usual (woken if it sleeps).
 */
export function keepAldoCommand(
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
    return Promise.resolve(null);
  }
  return serially(environmentId, () => keep(environmentId, command as AldoThreadCommand, true));
}

async function keep(
  environmentId: string,
  command: AldoThreadCommand,
  mayRetry: boolean,
): Promise<{ sequence: number } | null> {
  const shell = await cachedShell(environmentId);
  if (!shell) return null;
  const index = shell.threads.findIndex((entry) => entry.id === command.threadId);
  const thread = index === -1 ? null : shell.threads[index]!;
  const patch = aldoCommandPatch(
    command,
    thread,
    new Date().toISOString(),
    aldoMachineIsAsleep(environmentId),
  );
  if (patch === null) return null;
  if (patch === "nothing") return { sequence: shell.snapshotSequence };

  const changed: CachedShell = {
    ...shell,
    threads: applyAldoShellPatch(shell.threads, command.threadId, patch),
    snapshotSequence: shell.snapshotSequence + 1,
  };
  await show(environmentId, changed);
  try {
    const { sequence } = await sendAldoThreadCommand(
      environmentId,
      command,
      patch,
      shell.snapshotSequence,
    );
    // Aldo's copy is ahead of this one: the next directory fetch brings it.
    return { sequence: Math.max(changed.snapshotSequence, sequence ?? 0) };
  } catch (cause) {
    // Just this thread goes back as it was, and the copy to its own sequence.
    const now = await cachedShell(environmentId);
    if (now) {
      await show(environmentId, {
        ...now,
        threads: thread ? restoreAldoShellThread(now.threads, thread, index) : now.threads,
        snapshotSequence: shell.snapshotSequence,
      }).catch(() => undefined);
    }
    // Aldo has a newer copy than this browser's: made again from Aldo's.
    if (mayRetry && cause instanceof AldoApiError && cause.status === 412) {
      await takeAldoShell(environmentId, shell.snapshotSequence).catch(() => undefined);
      return keep(environmentId, command, false);
    }
    // An Aldo without kept commands: the machine takes it, as before.
    if (cause instanceof AldoApiError && cause.status === 404) return null;
    throw cause;
  }
}
