// Cloud environment directory, connection registration and machine lifecycle.

import { type AldoComputer } from "./computer.logic";
import {
  isAldoCloud,
  isAldoEnvironmentId,
  threadIdForEnvironment,
  api,
  CONNECTION_PREFIX,
  AldoApiError,
} from "./api";
import { aldoMachineStart } from "./threadStart.logic";
import { getAldoPreloadSettings } from "./preloadSettings";
import {
  BearerConnectionRegistration,
  BearerConnectionTarget,
  BearerConnectionProfile,
  BearerConnectionCredential,
  type PlatformConnectionRegistration,
  ConnectionBlockedError,
  ConnectionTransientError,
} from "@t3tools/client-runtime/connection";
import { type EnvironmentId } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { type PreparedPlatformEnvironment } from "@t3tools/client-runtime/platform";
import { type AldoProjectHost } from "./accountApi";

export interface AldoEnvironment {
  readonly environmentId: string;
  readonly threadId: string;
  readonly label: string;
  readonly repo: string;
  /** Every repository in the project (multi-repo workspaces), the main one first. */
  readonly repos?: ReadonlyArray<string>;
  readonly branch: string;
  /** "new": the machine doesn't exist yet; it's created when the thread's first message is sent. */
  readonly state: "new" | "ready" | "stopped" | "failed";
  /** Standard: 4 vCPU, 8 GB. 2x: 8 vCPU, 16 GB, twice the usage. */
  readonly machine?: AldoMachineSize;
  /** Aldo sizes every machine itself. */
  readonly machineSizing?: "automatic";
  /** A recent report of the machine running short while its agent worked. */
  readonly pressure?: AldoMachinePressure | null;
  /**
   * The snapshot sequence of the machine's threads as Aldo last had them
   * reported (shells.ts), null before any; an older Aldo leaves it out.
   */
  readonly shellSequence?: number | null;
  /**
   * The machine's threads Aldo is starting that haven't started yet, by T3
   * thread id (an older Aldo leaves it out).
   */
  readonly starts?: Readonly<Record<string, AldoStartState>>;
  /** How each of its T3 threads stands, as the machine last reported (working, waiting, done, failed). */
  readonly attention?: Readonly<Record<string, AldoThreadAttention>>;
  /**
   * The user's computers this thread asks for or uses, the one to show first
   * first (computer.logic.ts); left out by an older Aldo, which may report the
   * Windows computer alone as `computer`. Read them with aldoComputers().
   */
  readonly computers?: readonly AldoComputer[];
  readonly computer?: AldoComputer | null;
}

export interface AldoThreadAttention {
  readonly state: "working" | "waiting" | "done" | "failed";
  readonly summary?: string;
}

/** Where a thread Aldo is starting stands, and why when it isn't simply starting. */
export interface AldoStartState {
  /**
   * What Aldo holds: a thread's first message, which makes it ("start"), or a
   * message to a thread that's there, sent while the device wasn't connected
   * to its machine ("message"). An older Aldo leaves it out: a start.
   */
  readonly kind?: "start" | "message";
  readonly state: "starting" | "queued" | "retrying" | "failed";
  readonly detail?: string;
  /** When it was sent, or when it failed (ISO); an older Aldo leaves it out. */
  readonly at?: string;
}

export type AldoMachineSize = "standard" | "2x";

export interface AldoMachinePressure {
  readonly kind: "memory" | "cpu";
  readonly detail: string;
  readonly at: string;
}

// ---------------------------------------------------------------------------
// Directory of sandboxes

let knownEnvironments: ReadonlyArray<AldoEnvironment> | null = null;

/** What this Aldo can do that an older one couldn't, as its directory says (none before the first listing). */
let aldoFeatures: {
  readonly general: boolean;
  readonly projects: boolean;
  readonly aldoModels: boolean;
  readonly pullRequests: boolean;
  readonly prOwnership: boolean;
  readonly heldFiles: boolean;
  readonly moves: boolean;
  readonly routing: boolean;
  readonly projectRepos: boolean;
  readonly modelRouting: boolean;
} = {
  general: false,
  projects: false,
  aldoModels: false,
  pullRequests: false,
  prOwnership: false,
  heldFiles: false,
  moves: false,
  routing: false,
  projectRepos: false,
  modelRouting: false,
};

/** Whether threads can start without a repository (General), as the directory said. */
export function aldoSupportsGeneralThreads(): boolean {
  return aldoFeatures.general;
}

/** Whether Aldo keeps projects itself (`aldo:<slug>`, for work that isn't code), as the directory said. */
export function aldoSupportsProjects(): boolean {
  return aldoFeatures.projects;
}

/** Whether agents can run on Aldo's own models, with no subscription of the user's, as the directory said. */
export function aldoOffersItsModels(): boolean {
  return aldoFeatures.aldoModels;
}

/** Whether PR actions resolve the original conversation before starting work. */
export function aldoReusesPullRequestThreads(): boolean {
  return aldoFeatures.prOwnership;
}

/** Whether Aldo can start the first thread on an unowned pull request's branch. */
export function aldoStartsPullRequestThreads(): boolean {
  return aldoFeatures.pullRequests;
}

/** Whether Aldo keeps a message's images and files until it's sent (uploadAldoFile), as the directory said. */
export function aldoKeepsFiles(): boolean {
  return aldoFeatures.heldFiles;
}

/** Whether a thread's agent can move its conversation to another project (`continue_in_new_thread` with `move`), as the directory said. */
export function aldoMovesThreads(): boolean {
  return aldoFeatures.moves;
}

/** Whether Aldo says which of the user's projects a draft's words belong to (`POST /api/routing`), as the directory said. */
export function aldoRoutesDrafts(): boolean {
  return aldoFeatures.routing;
}

/**
 * Whether an Aldo project can have repositories of its own, its code
 * (listAldoProjects' `repos`, setAldoProjectRepos, a new repository's
 * `project`), as the directory said.
 */
export function aldoLinksProjectCode(): boolean {
  return aldoFeatures.projectRepos;
}

/** First messages go through Aldo's model router, even on a connected machine. */
export function aldoRoutesModels(): boolean {
  return aldoFeatures.modelRouting;
}

const directoryListeners = new Set<() => void>();
const directoryRefreshListeners = new Set<() => void>();

let refreshRequested = true;
let retryRequested = false;
let wasHidden = false;

/** Emit the directory as it is now, without fetching (a sandbox was just added to it). */
let emitRequested = false;

let lastFetchAt = 0;

const IDLE_REFRESH_MS = 15_000;

/** After failed fetches, no retry before this time: 1s, 2s, 4s… up to the idle interval. */
let retryAt = 0;

let failedFetches = 0;

/**
 * Machines this tab is deleting with their thread (deleteAldoMachineWithThread):
 * left out of the directory from the moment deleting starts, and kept out
 * once deleted. Until Aldo confirms it, and for a little while after a
 * failure puts one back, the machine's cached thread and project are kept.
 */
const deletions = new Map<string, "deleting" | "deleted" | "restoring">();

const RESTORE_KEEP_CACHE_MS = 10_000;

function hiddenByDeletion(environmentId: string): boolean {
  const deletion = deletions.get(environmentId);
  return deletion === "deleting" || deletion === "deleted";
}

/**
 * Whether a machine leaving the directory keeps its cached thread and project
 * (connection/storage.ts): it does while its deletion is pending, so if Aldo
 * can't delete it, it comes back as it was (a sleeping machine shows only
 * its cache).
 */
export function aldoKeepsEnvironmentCache(environmentId: string): boolean {
  const deletion = deletions.get(environmentId);
  return deletion === "deleting" || deletion === "restoring";
}

export function subscribeAldoEnvironments(listener: () => void): () => void {
  directoryListeners.add(listener);
  return () => directoryListeners.delete(listener);
}

/** Every successful read can retry a dormant connection even when its directory entry is unchanged. */
export function subscribeAldoDirectoryRefresh(listener: () => void): () => void {
  directoryRefreshListeners.add(listener);
  return () => directoryRefreshListeners.delete(listener);
}

export function getAldoEnvironments(): ReadonlyArray<AldoEnvironment> | null {
  return knownEnvironments;
}

function projectKey(environment: AldoEnvironment): string {
  return (environment.repos ?? [environment.repo]).join(",");
}

/** Every machine working in these repositories, newest first (the directory's order). */
export function aldoSandboxesFor(repos: ReadonlyArray<string>): ReadonlyArray<AldoEnvironment> {
  const key = repos.join(",");
  return (knownEnvironments ?? []).filter((environment) => projectKey(environment) === key);
}

/** Every machine of this machine's project (its own included), newest first. */
export function aldoProjectSandboxes(environmentId: string): ReadonlyArray<AldoEnvironment> {
  const own = knownEnvironments?.find((environment) => environment.environmentId === environmentId);
  return own ? aldoSandboxesFor(own.repos ?? [own.repo]) : [];
}

/**
 * The branch to show for a thread. Each Aldo machine starts on its own
 * `aldo/<machine id>` branch, which says nothing to the user, so it's hidden;
 * branches the agent makes still show, except in a repository Aldo keeps
 * (work that isn't software, aldoThreadInKeptRepo), which shows none.
 */
export function displayedThreadBranch(
  environmentId: string,
  branch: string | null | undefined,
): string | null {
  if (!branch) return null;
  const hidden =
    isAldoCloud &&
    isAldoEnvironmentId(environmentId) &&
    (branch === `aldo/${threadIdForEnvironment(environmentId)}` ||
      aldoThreadInKeptRepo(environmentId));
  return hidden ? null : branch;
}

/**
 * Whether a thread's main repository is one Aldo keeps, not one on a git host:
 * none (General's folder, `""` in the directory) or one of the user's projects
 * (`aldo:<slug>`: a business, a process, a trip; its threads all work on its
 * `main`, which Aldo syncs). Its branches and git actions mean nothing to the user.
 */
export function aldoThreadInKeptRepo(environmentId: string): boolean {
  const repo = knownEnvironments?.find((entry) => entry.environmentId === environmentId)?.repo;
  return repo !== undefined && (repo === "" || repo.startsWith("aldo:"));
}

/** Whether a thread works in General's folder: in no repository and no project. */
export function aldoThreadInGeneral(environmentId: string): boolean {
  return knownEnvironments?.find((entry) => entry.environmentId === environmentId)?.repo === "";
}

/**
 * Whether a machine was recorded on a branch it was asked for (a pull
 * request's), not on its own aldo/<id>: it's for the thread it was recorded for.
 */
export function aldoMachineOnAskedBranch(environmentId: string): boolean {
  const entry = knownEnvironments?.find((candidate) => candidate.environmentId === environmentId);
  return entry !== undefined && entry.branch !== `aldo/${entry.threadId}`;
}

/** Whether a thread's machine is still to be created (it is when its first message is sent). */
export function aldoMachineIsNew(environmentId: string): boolean {
  return knownEnvironments?.find((entry) => entry.environmentId === environmentId)?.state === "new";
}

/** Whether the directory has a thread's machine asleep (stopped, or failed to start). */
export function aldoMachineIsAsleep(environmentId: string): boolean {
  const state = knownEnvironments?.find((entry) => entry.environmentId === environmentId)?.state;
  return state === "stopped" || state === "failed";
}

/**
 * Whether Aldo is starting a thread on this machine (it brings the machine up
 * itself), or couldn't start the thread on screen (`threadId`; with none,
 * any), so there's nothing to bring up for it, or neither (aldoMachineStart).
 */
export function aldoStartOf(
  environmentId: string,
  threadId: string | null = null,
): "starting" | "failed" | null {
  const entry = knownEnvironments?.find((candidate) => candidate.environmentId === environmentId);
  return aldoMachineStart(entry?.starts, threadId);
}

/** Where Aldo's start of one of the machine's threads stands (its T3 thread id), from the directory; null if Aldo isn't starting it. */
export function aldoStartState(environmentId: string, threadId: string): AldoStartState | null {
  const entry = knownEnvironments?.find((candidate) => candidate.environmentId === environmentId);
  return entry?.starts?.[threadId] ?? null;
}

/** What a thread's panels say while its cloud agent is offline. */
export function aldoOfflineMessage(environmentId: string): string {
  const preload = getAldoPreloadSettings();
  if (aldoStartOf(environmentId) === "starting") return "Starting its computer…";
  if (aldoMachineIsNew(environmentId)) {
    return preload.newThreads
      ? "Starting its computer…"
      : "Its computer starts when you send your first message.";
  }
  return preload.openedThreads
    ? "Reconnecting to the cloud…"
    : "Its computer is asleep. It wakes when you send a message.";
}

export function requestAldoDirectoryRefresh(): void {
  refreshRequested = true;
}

type DirectorySync = (environments: ReadonlyArray<AldoEnvironment>) => Promise<void>;

let directorySync: DirectorySync | null = null;

const DIRECTORY_SYNC_WAIT_MS = 5_000;

/**
 * Brings this browser's copies of the machines' threads up to date on every
 * directory fetch (shells.ts). The directory waits for it, up to a few
 * seconds, before it registers machines, so a page opens with every thread.
 */
export function setAldoDirectorySync(sync: DirectorySync): void {
  directorySync = sync;
}

async function syncDirectory(environments: ReadonlyArray<AldoEnvironment>): Promise<void> {
  if (!directorySync) return;
  let timer: number | undefined;
  await Promise.race([
    directorySync(environments).catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = window.setTimeout(resolve, DIRECTORY_SYNC_WAIT_MS);
    }),
  ]);
  window.clearTimeout(timer);
}

async function fetchEnvironments(): Promise<ReadonlyArray<AldoEnvironment>> {
  const { environments, features } = await api<{
    environments: AldoEnvironment[];
    features?: {
      general?: boolean;
      projects?: boolean;
      aldoModels?: boolean;
      pullRequests?: boolean;
      prOwnership?: boolean;
      heldFiles?: boolean;
      moves?: boolean;
      routing?: boolean;
      projectRepos?: boolean;
      modelRouting?: boolean;
    };
  }>("/api/environments");
  const nextFeatures = {
    general: features?.general === true,
    projects: features?.projects === true,
    aldoModels: features?.aldoModels === true,
    pullRequests: features?.pullRequests === true,
    prOwnership: features?.prOwnership === true,
    heldFiles: features?.heldFiles === true,
    moves: features?.moves === true,
    routing: features?.routing === true,
    projectRepos: features?.projectRepos === true,
    modelRouting: features?.modelRouting === true,
  };
  // A listing that started before a deletion finished can still include its machine.
  const listed = environments.filter((environment) => !hiddenByDeletion(environment.environmentId));
  const changed =
    JSON.stringify([knownEnvironments, aldoFeatures]) !== JSON.stringify([listed, nextFeatures]);
  aldoFeatures = nextFeatures;
  if (changed) {
    knownEnvironments = listed;
    for (const listener of directoryListeners) listener();
  }
  for (const listener of directoryRefreshListeners) listener();
  return knownEnvironments!;
}

function registrationFor(environment: AldoEnvironment): BearerConnectionRegistration {
  const environmentId = environment.environmentId as EnvironmentId;
  const connectionId = `${CONNECTION_PREFIX}${environment.threadId}`;
  // The real address and token come from the gateway at connect time. These
  // placeholders stay constant so the registration never churns.
  const placeholder = `https://${environment.threadId}.sandbox.aldo.invalid`;
  return new BearerConnectionRegistration({
    target: new BearerConnectionTarget({ environmentId, label: environment.label, connectionId }),
    profile: new BearerConnectionProfile({
      connectionId,
      environmentId,
      label: environment.label,
      httpBaseUrl: placeholder,
      wsBaseUrl: placeholder.replace(/^https/, "wss"),
    }),
    credential: new BearerConnectionCredential({ token: "aldo" }),
  });
}

/**
 * The full set of Aldo sandboxes as platform registrations: on start, every
 * 15 seconds while visible, when returning to the tab, and after an explicit refresh. A
 * failed fetch emits nothing, so a network blip never drops environments.
 */
function currentRegistrations(environments: ReadonlyArray<AldoEnvironment>) {
  return environments
    .filter(
      (environment) =>
        !pendingEnvironmentIds.has(environment.environmentId) &&
        !hiddenByDeletion(environment.environmentId),
    )
    .map(registrationFor);
}

let firstRead: Promise<Array<BearerConnectionRegistration> | null> | null = null;

let listMachines: (environmentIds: ReadonlyArray<EnvironmentId>) => void = () => undefined;

const machinesListed = new Promise<ReadonlyArray<EnvironmentId>>((resolve) => {
  listMachines = resolve;
});

/**
 * Reads the directory now, as the page loads, rather than when the connection
 * runtime first asks for it once the app has rendered: the first poll takes
 * this read.
 */
export function startAldoDirectory(): void {
  if (isAldoCloud) firstRead ??= readDirectory();
}

/**
 * The machines the first directory read registers, once it has (firstView.ts);
 * none when it fails, so a page that can't reach Aldo shows what it has.
 */
export function aldoMachinesListed(): Promise<ReadonlyArray<EnvironmentId>> {
  return machinesListed;
}

async function pollDirectory(): Promise<Array<BearerConnectionRegistration> | null> {
  if (firstRead) {
    const read = firstRead;
    firstRead = null;
    return read;
  }
  if (emitRequested && knownEnvironments) {
    emitRequested = false;
    return currentRegistrations(knownEnvironments);
  }
  const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  const resumed = wasHidden && !hidden;
  wasHidden = hidden;
  const due =
    refreshRequested ||
    (!hidden && (resumed || retryRequested || Date.now() - lastFetchAt > IDLE_REFRESH_MS));
  if (!due || Date.now() < retryAt) return null;
  return readDirectory();
}

async function readDirectory(): Promise<Array<BearerConnectionRegistration> | null> {
  refreshRequested = false;
  retryRequested = false;
  lastFetchAt = Date.now();
  try {
    const environments = await fetchEnvironments();
    await syncDirectory(environments);
    const registrations = currentRegistrations(environments);
    failedFetches = 0;
    retryAt = 0;
    listMachines(registrations.map((registration) => registration.target.environmentId));
    return registrations;
  } catch {
    listMachines([]);
    // Retry soon, backing off while Aldo can't be reached so every open tab doesn't hammer it.
    failedFetches += 1;
    retryAt = Date.now() + Math.min(IDLE_REFRESH_MS, 1000 * 2 ** (failedFetches - 1));
    retryRequested = true;
    return null;
  }
}

export function aldoPlatformRegistrations(): Stream.Stream<
  ReadonlyArray<PlatformConnectionRegistration>
> {
  // Ticks are cheap: pollDirectory only fetches when a refresh is due.
  return Stream.tick("250 millis").pipe(
    Stream.mapEffect(() => Effect.promise(pollDirectory)),
    Stream.filter(
      (registrations): registrations is Array<BearerConnectionRegistration> =>
        registrations !== null,
    ),
  );
}

// ---------------------------------------------------------------------------
// Connecting and waking

type ConnectResponse =
  | { state: "running"; httpBaseUrl: string; wsBaseUrl: string; bearerToken: string }
  | { state: "stopped" };

/** Gateway used by the connection resolver: connects to running sandboxes only. */
export const aldoEnvironmentGateway = {
  prepare: (input: {
    readonly connectionId: string;
    readonly environmentId: EnvironmentId;
  }): Effect.Effect<
    Option.Option<PreparedPlatformEnvironment>,
    ConnectionBlockedError | ConnectionTransientError
  > => {
    if (!input.connectionId.startsWith(CONNECTION_PREFIX)) {
      return Effect.succeed(Option.none());
    }
    const threadId = input.connectionId.slice(CONNECTION_PREFIX.length);
    if (asleepAsListed(input.environmentId)) {
      return Effect.fail(
        new ConnectionBlockedError({ reason: "dormant", detail: "Its computer is asleep." }),
      );
    }
    return Effect.tryPromise({
      try: () => api<ConnectResponse>(`/api/environments/${threadId}/connect`, { method: "POST" }),
      catch: (cause) =>
        new ConnectionTransientError({
          reason: "remote-unavailable",
          detail: cause instanceof Error ? cause.message : "Aldo is unreachable.",
        }),
    }).pipe(
      Effect.flatMap((response) =>
        response.state === "running"
          ? Effect.succeed(
              Option.some({
                httpBaseUrl: response.httpBaseUrl,
                wsBaseUrl: response.wsBaseUrl,
                bearerToken: response.bearerToken,
              }),
            )
          : Effect.fail(
              new ConnectionBlockedError({
                reason: "dormant",
                detail: "Its computer is asleep.",
              }),
            ),
      ),
    );
  },
};

const wakes = new Map<string, Promise<void>>();

/** Machines whose connection has been prepared on this page. */
const prepared = new Set<string>();

/**
 * Whether a machine's first connection on this page can be told it's asleep
 * without asking Aldo: the directory that registered it a moment ago lists it
 * as not running (Aldo's connect says "stopped" for any machine that isn't),
 * and this tab isn't waking it. Asking sent one request per sleeping thread on
 * every page load. Every later attempt (a wake, a nudge, the directory saying
 * it's up; reconnect.ts) asks Aldo.
 */
function asleepAsListed(environmentId: string): boolean {
  if (prepared.has(environmentId)) return false;
  prepared.add(environmentId);
  const state = knownEnvironments?.find((entry) => entry.environmentId === environmentId)?.state;
  return state !== undefined && state !== "ready" && !wakes.has(environmentId);
}

/** Starts or resumes a thread's sandbox. Concurrent calls share one request. */
export function wakeAldoEnvironment(environmentId: string): Promise<void> {
  const existing = wakes.get(environmentId);
  if (existing) return existing;
  const threadId = threadIdForEnvironment(environmentId);
  const wake = api<{ ok: true }>(`/api/environments/${threadId}/wake`, { method: "POST" })
    .then(() => undefined)
    .finally(() => wakes.delete(environmentId));
  wakes.set(environmentId, wake);
  return wake;
}

/** Deletes a sandbox and everything in it. One that's already gone counts as deleted. */
export async function deleteAldoEnvironment(environmentId: string): Promise<void> {
  const threadId = threadIdForEnvironment(environmentId);
  try {
    await api(`/api/environments/${threadId}`, { method: "DELETE" });
  } catch (cause) {
    if (!(cause instanceof AldoApiError && cause.status === 404)) throw cause;
  }
  requestAldoDirectoryRefresh();
}

/**
 * Deletes a thread's machine, and with it the thread (the only one on it),
 * without sending the machine anything, so a sleeping one isn't woken. The
 * machine leaves the directory at once, taking its thread and project out of
 * the sidebar; if Aldo can't delete it, it comes back. Once it's deleted, the
 * caller clears its cache.
 */
export async function deleteAldoMachineWithThread(environmentId: string): Promise<void> {
  deletions.set(environmentId, "deleting");
  if (knownEnvironments?.some((entry) => entry.environmentId === environmentId)) {
    knownEnvironments = knownEnvironments.filter((entry) => entry.environmentId !== environmentId);
    for (const listener of directoryListeners) listener();
  }
  emitRequested = true;
  try {
    await deleteAldoEnvironment(environmentId);
  } catch (cause) {
    // Back into the directory with its cache, which stays kept until it has re-registered.
    deletions.set(environmentId, "restoring");
    window.setTimeout(() => {
      if (deletions.get(environmentId) === "restoring") deletions.delete(environmentId);
    }, RESTORE_KEEP_CACHE_MS);
    requestAldoDirectoryRefresh();
    throw cause;
  }
  deletions.set(environmentId, "deleted");
}

/**
 * In Aldo a project's entry in a machine is the machine's reason to exist:
 * once T3 has removed it, the machine goes too. Does nothing outside Aldo.
 */
export async function removeAldoProjectSandbox(environmentId: string): Promise<void> {
  if (isAldoCloud && isAldoEnvironmentId(environmentId)) await deleteAldoEnvironment(environmentId);
}

/** How removing a project in Aldo reads in a confirmation. */
export const ALDO_PROJECT_REMOVAL_NOTE =
  "This also deletes the computers of the project's threads, including any changes they haven't pushed.";

/**
 * Puts back a machine started or woken ahead of use once the user has left
 * without sending anything (deleted if it never got a thread, else paused).
 */
export async function unloadAldoEnvironment(environmentId: string): Promise<void> {
  const threadId = threadIdForEnvironment(environmentId);
  await api(`/api/environments/${threadId}/unload`, { method: "POST", keepalive: true });
  requestAldoDirectoryRefresh();
}

/**
 * Tells Aldo the user is looking at this thread, so it isn't stopped for
 * idleness. `presence`: which conversation is on screen and whether the page
 * is visible and focused (focus.ts), so notifications about it come quietly
 * while it is; an older Aldo ignores it. `keepalive`: sent as the page goes away.
 */
export function touchAldoEnvironment(
  environmentId: string,
  presence?: { readonly thread: string; readonly focused: boolean },
  options: { readonly keepalive?: boolean } = {},
): void {
  const threadId = threadIdForEnvironment(environmentId);
  void api(`/api/environments/${threadId}/touch`, {
    method: "POST",
    ...(presence ? { body: JSON.stringify(presence) } : {}),
    ...(options.keepalive ? { keepalive: true } : {}),
  }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// New sandboxes

/**
 * Creates a sandbox for a repository (or another thread's repository) and
 * waits until it is running. Returns the new environment.
 */
export interface AldoNewProject {
  /** Where to create it (default GitHub). In Aldo, `name` is the project's title. */
  readonly host?: AldoProjectHost;
  readonly name: string;
  readonly description?: string;
  readonly isPrivate: boolean;
  /** On a git host: the Aldo project (`aldo:<slug>`) it's the code of (aldoLinksProjectCode). */
  readonly project?: string;
}

/** What a new thread's machine will report as its T3 project. */
export interface AldoPlannedProject {
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly remoteUrl: string;
  /** The remote T3 reads it from: origin, or a thread's own folder's stand-in (an older Aldo leaves it out). */
  readonly remoteName?: string;
}

/**
 * Sandboxes the client is still preparing (seeding their cached project and
 * models); the directory leaves them out until then, so they register with
 * the cache in place.
 */
const pendingEnvironmentIds = new Set<string>();

export function holdAldoEnvironment(environmentId: string): void {
  pendingEnvironmentIds.add(environmentId);
}

/** Lets a prepared sandbox into the directory; registers it at once when `environment` is given. */
export function releaseAldoEnvironment(environmentId: string, environment?: AldoEnvironment): void {
  pendingEnvironmentIds.delete(environmentId);
  if (environment && knownEnvironments) {
    if (!knownEnvironments.some((entry) => entry.environmentId === environmentId)) {
      knownEnvironments = [environment, ...knownEnvironments];
      for (const listener of directoryListeners) listener();
    }
    emitRequested = true;
    return;
  }
  requestAldoDirectoryRefresh();
}

/** A new thread's sandbox id, in the form Aldo's server makes them. */
export function newAldoThreadId(): string {
  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function aldoEnvironmentIdFor(threadId: string): string {
  return `aldo-${threadId}`;
}

/** A pull request a new thread works on, and the branch the panel showed it on (Aldo refuses another). */
export interface AldoPullRequestBranch {
  readonly number: number;
  readonly headBranch: string;
}

/**
 * Creates a thread's sandbox record. With `start: false` (and the thread and
 * project ids named here) its machine is only created when the thread's first
 * message is sent, and `project` says what to show until then.
 */
export async function createAldoEnvironment(input: {
  readonly repo?: string;
  readonly fromEnvironmentId?: string;
  readonly branch?: string;
  /** A new project: Aldo creates the repository first. */
  readonly create?: AldoNewProject;
  /** A multi-repo workspace: every repository, the main one first. */
  readonly repos?: ReadonlyArray<string>;
  /** A pull request of its main repository: the thread is on its branch (aldoStartsPullRequestThreads). */
  readonly pullRequest?: AldoPullRequestBranch;
  readonly id?: string;
  readonly projectId?: string;
  readonly start?: boolean;
}): Promise<{
  readonly environment: AldoEnvironment;
  readonly project: AldoPlannedProject | null;
}> {
  const result = await api<{
    environment: AldoEnvironment;
    project: AldoPlannedProject | null;
  }>("/api/environments", {
    method: "POST",
    body: JSON.stringify({
      repo: input.repo,
      branch: input.branch,
      create: input.create,
      repos: input.repos,
      pullRequest: input.pullRequest,
      fromThreadId: input.fromEnvironmentId
        ? threadIdForEnvironment(input.fromEnvironmentId)
        : undefined,
      id: input.id,
      projectId: input.projectId,
      start: input.start,
    }),
  });
  requestAldoDirectoryRefresh();
  return result;
}
