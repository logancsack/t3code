// Every thread on the account in the sidebar, on any device, without waking a
// machine. The sidebar shows a machine's threads from its live connection or,
// when it isn't connected, from this browser's copy (T3's shell cache); since
// connecting never wakes a machine, a device that never saw one running would
// show none of its threads. Aldo keeps each machine's latest shell as its
// aldod reports it, and the directory says which snapshot sequence that is.
// On every directory fetch (on page load, before the machines register) the
// shells newer than this browser's copies are copied into its cache, and the
// sidebar reloads them for machines that aren't connected; a connected
// machine keeps its own cache current. For a machine Aldo has no shell for
// yet (it hasn't run since machines began reporting them), this browser
// offers its copy. A machine this browser never connected to has no models
// cached either, so nothing could be sent in its threads: it gets the ones a
// new thread shows (serverConfig.ts) until it connects and has its own.

import type { EnvironmentPresentation } from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";

import {
  readCachedShells,
  seedEnvironmentCache,
  seedMissingServerConfigs,
} from "../connection/storage";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "../state/presentation";
import { serverEnvironment } from "../state/server";
import { environmentShell } from "../state/shell";
import {
  fetchAldoShells,
  isAldoCloud,
  offerAldoShell,
  setAldoDirectorySync,
  type AldoEnvironment,
} from "./cloud";
import { aldoServerConfigsFor } from "./serverConfig";
import { aldoShellCandidates, planAldoShellSync } from "./shells.logic";

/** Shells fetched at once (Aldo's limit). */
const BATCH = 100;

/** Each machine's cached shell sequence, as this tab last read or wrote it. */
const known = new Map<string, number>();
/** Machines Aldo had no shell for whose cache this tab has looked at for a copy to offer. */
const offerChecked = new Set<string>();
/** Machines whose cache this tab has looked at for models. */
const modelsChecked = new Set<string>();

type Phase = EnvironmentPresentation["connection"]["phase"];

/** A registered machine's connection phase; undefined until it's registered. */
function phaseOf(environmentId: string): Phase | undefined {
  return appAtomRegistry
    .get(environmentPresentations.presentationsAtom)
    .get(environmentId as EnvironmentId)?.connection.phase;
}

/** Connected, or about to be: its own snapshot is newer than any copy. */
function isLivePhase(phase: Phase | undefined): boolean {
  return phase === "connected" || phase === "connecting" || phase === "reconnecting";
}

function isLive(environmentId: string): boolean {
  return isLivePhase(phaseOf(environmentId));
}

/** Copies these machines' shells from Aldo into the cache. Returns the thread ids Aldo sent. */
async function download(environments: ReadonlyArray<AldoEnvironment>): Promise<Set<string>> {
  const shells = await fetchAldoShells(environments.map((environment) => environment.threadId));
  await Promise.all(
    environments.map(async (environment) => {
      const environmentId = environment.environmentId;
      const shell = shells[environment.threadId] as { snapshotSequence?: unknown } | undefined;
      if (!shell || isLive(environmentId)) return;
      // One that doesn't decode isn't fetched again until the machine reports another.
      known.set(environmentId, environment.shellSequence ?? -1);
      await seedEnvironmentCache({
        environmentId: environmentId as EnvironmentId,
        shell,
        serverConfig: null,
      });
      if (typeof shell.snapshotSequence === "number")
        known.set(environmentId, shell.snapshotSequence);
      // Already registered: its shell reloads from the cache. (One registering later reads it then.)
      const phase = phaseOf(environmentId);
      if (phase !== undefined && !isLivePhase(phase)) {
        appAtomRegistry.refresh(environmentShell.stateAtom(environmentId as EnvironmentId));
      }
    }),
  ).catch(() => undefined);
  return new Set(Object.keys(shells));
}

/**
 * Models for the machines that aren't connected and have none cached, once
 * each per tab: one that didn't get them (no cloud agent has reported any yet,
 * or Aldo couldn't be reached) is tried again on the next directory fetch.
 */
async function seedModels(environments: ReadonlyArray<AldoEnvironment>): Promise<void> {
  const ids = environments
    .map((environment) => environment.environmentId)
    .filter((environmentId) => !modelsChecked.has(environmentId) && !isLive(environmentId));
  if (ids.length === 0) return;
  // Held while in flight, so a fetch that comes meanwhile doesn't do them again.
  for (const environmentId of ids) modelsChecked.add(environmentId);
  let done = new Set<string>();
  try {
    const configs = await aldoServerConfigsFor(ids);
    if (configs.size === 0) return;
    const { written, kept } = await seedMissingServerConfigs(
      new Map(
        [...configs].map(([environmentId, config]) => [environmentId as EnvironmentId, config]),
      ),
    );
    done = new Set([...written, ...kept]);
    // Already registered: its config reloads from the cache.
    for (const environmentId of written) {
      const phase = phaseOf(environmentId);
      if (phase !== undefined && !isLivePhase(phase)) {
        appAtomRegistry.refresh(serverEnvironment.configProjection({ environmentId, input: {} }));
      }
    }
  } finally {
    for (const environmentId of ids)
      if (!done.has(environmentId)) modelsChecked.delete(environmentId);
  }
}

async function sync(environments: ReadonlyArray<AldoEnvironment>): Promise<void> {
  const candidates = aldoShellCandidates(environments, { known, offerChecked, isLive });
  if (candidates.length === 0) return;
  const cached = await readCachedShells(
    candidates.map((environment) => environment.environmentId as EnvironmentId),
  );
  for (const [environmentId, shell] of cached) known.set(environmentId, shell.sequence);
  const plan = planAldoShellSync(candidates, cached);

  for (const environment of candidates) {
    if (environment.shellSequence === null) offerChecked.add(environment.environmentId);
  }
  for (const environment of plan.offer) {
    const copy = cached.get(environment.environmentId as EnvironmentId);
    if (!copy) continue;
    void offerAldoShell(environment.threadId, copy.snapshot).catch(() => {
      offerChecked.delete(environment.environmentId);
    });
  }

  // A response holds as many shells as fit; ask again for the rest until none come.
  let remaining = plan.download;
  while (remaining.length > 0) {
    const sent = await download(remaining.slice(0, BATCH)).catch(() => null);
    if (!sent || sent.size === 0) break;
    remaining = remaining.filter((environment) => !sent.has(environment.threadId));
  }
}

let running: Promise<void> | null = null;

/** Brings this browser's copies of the machines' threads up to date on every directory fetch. */
export function installAldoShellSync(): void {
  if (!isAldoCloud) return;
  setAldoDirectorySync((environments) => {
    // Not waited for: a machine that registers first reloads its models once they're in.
    void seedModels(environments).catch(() => undefined);
    // One at a time: a fetch that comes while one runs (slow Aldo) waits for it.
    running ??= sync(environments).finally(() => {
      running = null;
    });
    return running;
  });
}
