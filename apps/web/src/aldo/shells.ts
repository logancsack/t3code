// Every thread on the account in the sidebar, on any device, without waking a
// machine. The sidebar shows a machine's threads from its live connection or,
// when it isn't connected, from this browser's copy (T3's shell cache); since
// connecting never wakes a machine, a device that never saw one running would
// show none of its threads. Aldo keeps each machine's latest shell as its
// aldod reports it, and the directory says which snapshot sequence that is.
// On every directory fetch, in the background while machines register, the
// shells newer than this browser's copies are copied into its cache, and the
// sidebar reloads them for machines that aren't connected; a connected
// machine keeps its own cache current. For a machine Aldo has no shell for
// yet (it hasn't run since machines began reporting them), this browser
// offers its copy. A machine this browser never connected to has no models
// cached either, so nothing could be sent in its threads: it gets the ones a
// new thread shows (serverConfig.ts) until it connects and has its own. A
// machine this tab is bringing up for a new thread's first message keeps the
// thread it shows (startingThreads.ts) until the machine connects.

import type { EnvironmentPresentation } from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Atom from "effect/unstable/reactivity/Atom";

import {
  readCachedShells,
  seedEnvironmentCache,
  seedMissingServerConfigs,
} from "../connection/storage";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "../state/presentation";
import { serverEnvironment } from "../state/server";
import { environmentShell } from "../state/shell";
import { fetchAldoShells, offerAldoShell } from "./threadApi";
import { isAldoCloud } from "./api";
import { setAldoDirectorySync, type AldoEnvironment } from "./directory";
import {
  getAldoMachineSettings,
  loadAldoMachineSettings,
  subscribeAldoMachineSettings,
} from "./machineSettings";
import { aldoServerConfigTemplate } from "./serverConfig";
import { providerInstances } from "./serverConfig.logic";
import { aldoShellCandidates, planAldoShellSync } from "./shells.logic";
import { aldoShowsStartingThread, clearLeftoverAldoThreads } from "./startingThreads";

/** Shells fetched at once (Aldo's limit). */
const BATCH = 100;

/** Each machine's cached shell sequence, as this tab last read or wrote it. */
const known = new Map<string, number>();
/** Machines Aldo had no shell for whose cache this tab has looked at for a copy to offer. */
const offerChecked = new Set<string>();
/**
 * Machines whose cache this browser has looked at for models, with the
 * providers the newest config listed then (and the user's settings), kept
 * between visits (MODELS_CHECKED_KEY): reading a few hundred cached configs
 * on every open, to find nothing to change, held the page for seconds.
 */
const MODELS_CHECKED_KEY = "aldo:models-checked";
let checkedTemplate: string | null = null;
const modelsChecked = readModelsChecked();
/** The directory as last fetched: a change to the user's settings reaches its sleeping machines' caches at once. */
let directory: ReadonlyArray<AldoEnvironment> = [];

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
      // A machine coming up for a thread shown here: its own shell is moments away.
      if (!shell || isLive(environmentId) || aldoShowsStartingThread(environmentId)) return;
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

function readModelsChecked(): Map<string, string> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(MODELS_CHECKED_KEY) ?? "null") as {
      template?: unknown;
      ids?: unknown;
    } | null;
    const template = stored?.template;
    if (typeof template !== "string" || !Array.isArray(stored?.ids)) return new Map();
    checkedTemplate = template;
    return new Map(
      stored.ids.filter((id): id is string => typeof id === "string").map((id) => [id, template]),
    );
  } catch {
    return new Map();
  }
}

/** Keeps the machines checked against the newest template for the next visit (the others are checked again then). */
function keepModelsChecked(): void {
  if (checkedTemplate === null) return;
  const ids = [...modelsChecked].filter(([, template]) => template === checkedTemplate);
  try {
    window.localStorage.setItem(
      MODELS_CHECKED_KEY,
      JSON.stringify({ template: checkedTemplate, ids: ids.map(([id]) => id) }),
    );
  } catch {
    // Checked again next visit.
  }
}

/**
 * Models for the machines that aren't connected and have none cached, or a
 * cached copy that lacks a provider the newest config lists or the user's
 * settings Aldo keeps: once each, and again when the newest config lists
 * other providers, the user changes a setting, or after the machine was
 * connected (its own config replaced the cache then). One that didn't get
 * them (no cloud agent has reported any yet, or Aldo couldn't be reached) is
 * tried again on the next directory fetch. One at a time, each after the one
 * before, so none checks what another is checking.
 */
let seeding: Promise<void> = Promise.resolve();

function seedModels(environments: ReadonlyArray<AldoEnvironment>): Promise<void> {
  seeding = seeding.then(() => seedModelsNow(environments).catch(() => undefined));
  return seeding;
}

async function seedModelsNow(environments: ReadonlyArray<AldoEnvironment>): Promise<void> {
  if (environments.every((environment) => isLive(environment.environmentId))) return;
  // With the user's settings: checking without them, then again once they're in, checks every machine twice.
  await loadAldoMachineSettings();
  const config = await aldoServerConfigTemplate();
  if (!config) return;
  const settings = getAldoMachineSettings() ?? {};
  const template = `${providerInstances(config).join(",")} ${JSON.stringify(settings)}`;
  const ids = environments
    .map((environment) => environment.environmentId as EnvironmentId)
    .filter(
      (environmentId) => modelsChecked.get(environmentId) !== template && !isLive(environmentId),
    );
  if (ids.length === 0) return;
  const { written, kept } = await seedMissingServerConfigs(config, ids, settings);
  for (const environmentId of [...written, ...kept]) modelsChecked.set(environmentId, template);
  checkedTemplate = template;
  keepModelsChecked();
  // Already registered: its config reloads from the cache, all of them at once.
  Atom.batch(() => {
    for (const environmentId of written) {
      const phase = phaseOf(environmentId);
      if (phase !== undefined && !isLivePhase(phase)) {
        appAtomRegistry.refresh(serverEnvironment.configProjection({ environmentId, input: {} }));
      }
    }
  });
}

async function sync(environments: ReadonlyArray<AldoEnvironment>): Promise<void> {
  await clearLeftoverAldoThreads(environments).catch(() => undefined);
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
    if (aldoShowsStartingThread(environment.environmentId)) continue;
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

/**
 * A connected machine writes its own config over the cache: it's checked
 * again once it isn't, even on a later visit (forgotten as it connects, not
 * on the next directory fetch, which may never come in this tab).
 */
function forgetLiveModelsChecked(
  presentations: ReadonlyMap<EnvironmentId, EnvironmentPresentation>,
): void {
  let forgot = false;
  for (const [environmentId, presentation] of presentations) {
    if (isLivePhase(presentation.connection.phase) && modelsChecked.delete(environmentId)) {
      forgot = true;
    }
  }
  if (forgot) keepModelsChecked();
}

/** Brings this browser's copies of the machines' threads up to date on every directory fetch. */
export function installAldoShellSync(): void {
  if (!isAldoCloud) return;
  appAtomRegistry.subscribe(environmentPresentations.presentationsAtom, forgetLiveModelsChecked, {
    immediate: true,
  });
  subscribeAldoMachineSettings(() => void seedModels(directory));
  setAldoDirectorySync((environments) => {
    directory = environments;
    // Not waited for: a machine that registers first reloads its models once they're in.
    void seedModels(environments);
    // One at a time: a fetch that comes while one runs (slow Aldo) waits for it.
    running ??= sync(environments).finally(() => {
      running = null;
    });
    return running;
  });
}
