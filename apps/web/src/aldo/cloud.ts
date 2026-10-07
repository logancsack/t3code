// Aldo cloud mode. The web client is served by Aldo, which runs one sandbox
// (a cloud machine) per thread; each runs a stock T3 server and appears here
// as a platform bearer environment. T3 groups a repository's machines into
// one project, and the UI keeps the machines themselves out of sight. Aldo's same-origin API lists the sandboxes,
// wakes them, and hands out short-lived bearer tokens at connect time.

import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
  BearerConnectionTarget,
  ConnectionBlockedError,
  ConnectionTransientError,
  type PlatformConnectionRegistration,
} from "@t3tools/client-runtime/connection";
import type { PreparedPlatformEnvironment } from "@t3tools/client-runtime/platform";
import type {
  AuthConnectorSession,
  AuthConnectorStartInput,
  EnvironmentId,
  SourceControlRepositorySummary,
  UsageSummaryInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import type { AldoComputer } from "./computer.logic";
import { getAldoPreloadSettings } from "./preloadSettings";
import type { AldoCheckCounts, AldoPullRequestStage } from "./pullRequests.logic";

export const isAldoCloud = import.meta.env.VITE_ALDO_CLOUD === "1";

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
  readonly state: "starting" | "queued" | "retrying" | "failed";
  readonly detail?: string;
}

export type AldoMachineSize = "standard" | "2x";

export interface AldoMachinePressure {
  readonly kind: "memory" | "cpu";
  readonly detail: string;
  readonly at: string;
}

export type AldoAccountKind = "github" | "claude" | "codex" | "grok";
/** Git hosts connected with an access token (GitHub has its own sign-in wizard). */
export type AldoGitHostKind = "gitlab" | "bitbucket" | "azure";
export type AldoHostKind = "github" | AldoGitHostKind;

export interface AldoAccount {
  readonly connected: boolean;
  readonly account: string | null;
  readonly plan: string | null;
}

const CONNECTION_PREFIX = "aldo:";

export function isAldoEnvironmentId(environmentId: string): boolean {
  return environmentId.startsWith("aldo-");
}

export function threadIdForEnvironment(environmentId: string): string {
  return environmentId.replace(/^aldo-/, "");
}

export class AldoApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The browser's time zone, which Aldo keeps for routines' times and its sense of the user's day. */
function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const zone = timeZone();
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...(zone ? { "x-time-zone": zone } : {}),
      ...init.headers,
    },
  });
  if (response.status === 401) {
    // The Aldo session ended; send the user back through sign-in.
    window.location.assign(`/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`);
    throw new AldoApiError(401, "Your Aldo session ended. Sign in again.");
  }
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new AldoApiError(response.status, body.error ?? `Request failed (${response.status})`);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Directory of sandboxes

let knownEnvironments: ReadonlyArray<AldoEnvironment> | null = null;
/** What this Aldo can do that an older one couldn't, as its directory says (none before the first listing). */
let aldoFeatures: { readonly general: boolean } = { general: false };

/** Whether threads can start without a repository (General), as the directory said. */
export function aldoSupportsGeneralThreads(): boolean {
  return aldoFeatures.general;
}
const directoryListeners = new Set<() => void>();
let refreshRequested = true;
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
 * branches the agent makes still show.
 */
export function displayedThreadBranch(
  environmentId: string,
  branch: string | null | undefined,
): string | null {
  if (!branch) return null;
  const placeholder =
    isAldoCloud &&
    isAldoEnvironmentId(environmentId) &&
    branch === `aldo/${threadIdForEnvironment(environmentId)}`;
  return placeholder ? null : branch;
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
 * itself), or couldn't start one (there's no machine to bring up), or neither.
 */
export function aldoStartOf(environmentId: string): "starting" | "failed" | null {
  const entry = knownEnvironments?.find((candidate) => candidate.environmentId === environmentId);
  const starts = Object.values(entry?.starts ?? {});
  if (starts.length === 0) return null;
  return starts.some((start) => start.state !== "failed") ? "starting" : "failed";
}

/** Where Aldo's start of one of the machine's threads stands (its T3 thread id), from the directory; null if Aldo isn't starting it. */
export function aldoStartState(environmentId: string, threadId: string): AldoStartState | null {
  const entry = knownEnvironments?.find((candidate) => candidate.environmentId === environmentId);
  return entry?.starts?.[threadId] ?? null;
}

/** What a thread's panels say while its cloud agent is offline. */
export function aldoOfflineMessage(environmentId: string): string {
  const preload = getAldoPreloadSettings();
  if (aldoStartOf(environmentId) === "starting") return "Starting the cloud agent…";
  if (aldoMachineIsNew(environmentId)) {
    return preload.newThreads
      ? "Starting the cloud agent…"
      : "The cloud agent starts when you send your first message.";
  }
  return preload.openedThreads
    ? "Reconnecting to the cloud…"
    : "This cloud agent is asleep. It wakes when you send a message.";
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
    features?: { general?: boolean };
  }>("/api/environments");
  aldoFeatures = { general: features?.general === true };
  // A listing that started before a deletion finished can still include its machine.
  const listed = environments.filter((environment) => !hiddenByDeletion(environment.environmentId));
  knownEnvironments = listed;
  for (const listener of directoryListeners) listener();
  return listed;
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
 * 15 seconds, and within a few seconds of requestAldoDirectoryRefresh(). A
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

async function pollDirectory(): Promise<Array<BearerConnectionRegistration> | null> {
  if (emitRequested && knownEnvironments) {
    emitRequested = false;
    return currentRegistrations(knownEnvironments);
  }
  const due = refreshRequested || Date.now() - lastFetchAt > IDLE_REFRESH_MS;
  if (!due || Date.now() < retryAt) return null;
  refreshRequested = false;
  lastFetchAt = Date.now();
  try {
    const environments = await fetchEnvironments();
    await syncDirectory(environments);
    const registrations = currentRegistrations(environments);
    failedFetches = 0;
    retryAt = 0;
    return registrations;
  } catch {
    // Retry soon, backing off while Aldo can't be reached so every open tab doesn't hammer it.
    failedFetches += 1;
    retryAt = Date.now() + Math.min(IDLE_REFRESH_MS, 1000 * 2 ** (failedFetches - 1));
    refreshRequested = true;
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
                detail: "This cloud agent is asleep.",
              }),
            ),
      ),
    );
  },
};

const wakes = new Map<string, Promise<void>>();

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
  "This also deletes the project's cloud agents, including any changes they haven't pushed.";

/**
 * Puts back a machine started or woken ahead of use once the user has left
 * without sending anything (deleted if it never got a thread, else paused).
 */
export async function unloadAldoEnvironment(environmentId: string): Promise<void> {
  const threadId = threadIdForEnvironment(environmentId);
  await api(`/api/environments/${threadId}/unload`, { method: "POST", keepalive: true });
  requestAldoDirectoryRefresh();
}

/** Tells Aldo the user is looking at this thread, so it isn't stopped for idleness. */
export function touchAldoEnvironment(environmentId: string): void {
  const threadId = threadIdForEnvironment(environmentId);
  void api(`/api/environments/${threadId}/touch`, { method: "POST" }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// New sandboxes

/**
 * Creates a sandbox for a repository (or another thread's repository) and
 * waits until it is running. Returns the new environment.
 */
export interface AldoNewProject {
  /** Where to create it (default GitHub). */
  readonly host?: AldoHostKind;
  readonly name: string;
  readonly description?: string;
  readonly isPrivate: boolean;
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

/** The newest T3 server config Aldo has for the user (see /api/models). */
export async function fetchAldoServerConfig(): Promise<unknown> {
  const { config } = await api<{ config: unknown }>("/api/models");
  return config;
}

export async function reportAldoServerConfig(config: unknown): Promise<void> {
  await api("/api/models", { method: "POST", body: JSON.stringify({ config }) });
}

/** Machines' threads (T3 shells) as their aldod last reported them, by thread id. Never wakes one. */
export async function fetchAldoShells(
  threadIds: ReadonlyArray<string>,
): Promise<Record<string, unknown>> {
  const { shells } = await api<{ shells: Record<string, unknown> }>(
    `/api/environments/shells?ids=${threadIds.join(",")}`,
  );
  return shells;
}

/** This browser's copy of a machine's threads, for Aldo to keep until the machine reports its own. */
export async function offerAldoShell(threadId: string, shell: unknown): Promise<void> {
  await api("/api/environments/shells", {
    method: "POST",
    body: JSON.stringify({ threadId, shell }),
  });
}

/**
 * What each machine's agents used in this window, as Aldo answers for it from
 * what the machine last reported (usage.ts), by environment id. A machine
 * that never reported is left out, and an Aldo without these has none. Never
 * wakes one.
 */
export async function fetchAldoUsage(input: UsageSummaryInput): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({
    sinceDay: input.sinceDay,
    untilDay: input.untilDay,
    timeZone: input.timeZone,
  });
  if (input.resolution) query.set("resolution", input.resolution);
  if (input.sinceTime) query.set("sinceTime", input.sinceTime);
  if (input.untilTime) query.set("untilTime", input.untilTime);
  const { usage } = await api<{ usage?: Record<string, unknown> }>(
    `/api/environments/usage?${query}`,
  ).catch((error: unknown) => {
    if (error instanceof AldoApiError && (error.status === 404 || error.status === 405)) {
      return { usage: {} };
    }
    throw error;
  });
  return Object.fromEntries(
    Object.entries(usage ?? {}).map(([threadId, summary]) => [
      aldoEnvironmentIdFor(threadId),
      summary,
    ]),
  );
}

/**
 * A T3 thread's detail as its machine last reported it (threadDetails.ts):
 * `sequence` is Aldo's copy's, null when it has none, and `detail` comes only
 * when it's newer than `after`, this browser's own.
 */
export async function fetchAldoThreadDetail(
  environmentId: string,
  t3ThreadId: string,
  after: number | null,
  signal?: AbortSignal,
): Promise<{ readonly sequence: number | null; readonly detail: unknown }> {
  const query = new URLSearchParams({ t3ThreadId });
  if (after !== null) query.set("after", String(after));
  const threadId = threadIdForEnvironment(environmentId);
  return api(`/api/environments/${threadId}/detail?${query}`, signal ? { signal } : {});
}

/**
 * One of T3's commands for a thread on a machine this browser isn't
 * connected to, with what it changes in the thread's shell entry
 * (threadCommands.ts), made from this browser's copy of the shell at
 * sequence `base`: Aldo sends it now if the machine runs, else when it next
 * starts. Returns the sequence of Aldo's copy of the shell with the change,
 * null if it has none; a 412 if Aldo's copy is newer than `base`.
 */
export async function sendAldoThreadCommand(
  environmentId: string,
  command: unknown,
  patch: unknown,
  base: number,
): Promise<{ readonly sequence: number | null }> {
  const threadId = threadIdForEnvironment(environmentId);
  return api(`/api/environments/${threadId}/commands`, {
    method: "POST",
    body: JSON.stringify({ command, patch, base }),
  });
}

/** How long Aldo has to take a message before the page sends it itself. */
const HOLD_TIMEOUT_MS = 15_000;

/**
 * Hands Aldo a message (T3's `thread.turn.start`) for a machine this browser
 * isn't connected to. Aldo brings the machine up and sends it, even if this
 * page goes away; this page sends it too once connected, and T3 runs it once.
 * False when Aldo didn't take it (an older Aldo, a message too big for it to
 * carry, or no answer within HOLD_TIMEOUT_MS): the page sends it itself, as
 * before.
 */
export async function holdAldoTurn(environmentId: string, command: unknown): Promise<boolean> {
  const threadId = threadIdForEnvironment(environmentId);
  try {
    await api(`/api/environments/${threadId}/turns`, {
      method: "POST",
      body: JSON.stringify({ command }),
      signal: AbortSignal.timeout(HOLD_TIMEOUT_MS),
    });
    return true;
  } catch {
    return false;
  }
}

type ThreadDetailSource = (
  environmentId: string,
  threadId: string,
  cachedSequence: number | null,
) => Promise<unknown>;
let threadDetailSource: ThreadDetailSource | null = null;

/** Where T3's thread cache finds Aldo's copy of a thread (threadDetails.ts). */
export function setAldoThreadDetailSource(source: ThreadDetailSource): void {
  threadDetailSource = source;
}

/**
 * Aldo's copy of a thread whose machine isn't connected, when it's newer than
 * this browser's cached one (`cachedSequence`), for T3's thread cache to open
 * it with (connection/storage.ts). Null otherwise; never fails.
 */
export async function aldoThreadDetail(
  environmentId: string,
  threadId: string,
  cachedSequence: number | null,
): Promise<unknown> {
  if (!threadDetailSource) return null;
  return threadDetailSource(environmentId, threadId, cachedSequence).catch(() => null);
}

export async function listAldoRepositories(): Promise<
  ReadonlyArray<SourceControlRepositorySummary>
> {
  const { repositories } = await api<{ repositories: SourceControlRepositorySummary[] }>(
    "/api/repos",
  );
  return repositories;
}

// ---------------------------------------------------------------------------
// Accounts (sign-in wizards)

export async function fetchAldoAccounts(): Promise<
  Record<AldoAccountKind | AldoGitHostKind, AldoAccount>
> {
  return api<Record<AldoAccountKind | AldoGitHostKind, AldoAccount>>("/api/connections");
}

/** Connects GitLab, Bitbucket or Azure DevOps with an access token. */
export async function connectAldoGitHost(
  kind: AldoGitHostKind,
  values: Record<string, string>,
): Promise<void> {
  await api(`/api/hosts/${kind}`, { method: "POST", body: JSON.stringify(values) });
}

export async function disconnectAldoAccount(
  kind: AldoAccountKind | AldoGitHostKind,
): Promise<void> {
  await api(`/api/connections/${kind}`, { method: "DELETE" });
}

export const aldoAuthConnectors = {
  start: (input: AuthConnectorStartInput) =>
    api<AuthConnectorSession>("/api/connectors", { method: "POST", body: JSON.stringify(input) }),
  get: (sessionId: string) => api<AuthConnectorSession>(`/api/connectors/${sessionId}`),
  submit: (sessionId: string, values: Record<string, string>) =>
    api<AuthConnectorSession>(`/api/connectors/${sessionId}/submit`, {
      method: "POST",
      body: JSON.stringify({ values }),
    }),
  cancel: (sessionId: string) =>
    api<AuthConnectorSession>(`/api/connectors/${sessionId}/cancel`, { method: "POST" }),
};

// ---------------------------------------------------------------------------
// Integrations (accounts agents use, like Microsoft for OneDrive and Excel)

export type AldoIntegrationAccountType = "work" | "personal";

/** What agents can do with a connected account. */
export type AldoIntegrationCapability = "mail" | "calendar" | "contacts" | "files";

export interface AldoIntegration {
  readonly provider: string;
  readonly name: string;
  /** False when this Aldo has no app set up with the provider, so there's nothing to connect yet. */
  readonly available: boolean;
  readonly connected: boolean;
  readonly account: {
    readonly email: string;
    readonly name: string;
    /** A Microsoft account's type. */
    readonly type?: AldoIntegrationAccountType;
  } | null;
  /** What agents can do with it (an older Aldo leaves it out). */
  readonly can?: ReadonlyArray<AldoIntegrationCapability>;
  /** What connecting again would add (a sign-in from before Aldo asked for it). */
  readonly missing?: ReadonlyArray<AldoIntegrationCapability>;
  /** Why the provider stopped accepting the sign-in; it needs connecting again. */
  readonly error: string | null;
  /** "key" for a generator the user connects with its API key (an older Aldo leaves it out: an account). */
  readonly kind?: "account" | "key";
  /** A generator's: what it makes, as Settings says it. */
  readonly description?: string;
  /** A generator's: where the user creates a key. */
  readonly keyUrl?: string;
  /** A generator's: what connecting asks for (an API key, or a key and its secret). */
  readonly fields?: ReadonlyArray<AldoIntegrationKeyField>;
}

export interface AldoIntegrationKeyField {
  readonly name: string;
  readonly label: string;
  readonly placeholder?: string;
}

/** The integrations this Aldo offers and how each stands; null for an Aldo without them. */
export async function fetchAldoIntegrations(): Promise<ReadonlyArray<AldoIntegration> | null> {
  const body = await api<{ integrations?: AldoIntegration[] }>("/api/integrations").catch(
    (error: unknown) => {
      if (error instanceof AldoApiError && error.status === 404) return null;
      throw error;
    },
  );
  // An older Aldo may answer with the web client's page instead of a 404.
  return Array.isArray(body?.integrations) ? body.integrations : null;
}

export interface AldoPhoneSettings {
  readonly smsTermsUrl?: string;
  readonly available: boolean;
  readonly prototype: boolean;
  readonly number: string | null;
  readonly sms: boolean;
  readonly voice: boolean;
  readonly verified: boolean;
  readonly phone: string | null;
  readonly smsEnabled: boolean;
  readonly voiceEnabled: boolean;
  readonly hasPin: boolean;
  readonly error: string | null;
  readonly events: ReadonlyArray<{
    id: string;
    channel: string;
    state: string;
    error: string | null;
    at: string;
  }>;
  readonly deliveries: ReadonlyArray<{ id: string; state: string; error: string | null }>;
  readonly calls: ReadonlyArray<{ state: string; error: string | null; at: string }>;
}

/** Absent on older servers: either half can ship first. */
export async function fetchAldoPhone(): Promise<AldoPhoneSettings | null> {
  const result = await api<AldoPhoneSettings>("/api/phone").catch((error: unknown) => {
    if (error instanceof AldoApiError && error.status === 404) return null;
    throw error;
  });
  return typeof result?.available === "boolean" ? result : null;
}

export const aldoPhone = {
  verify: (phone: string) =>
    api<{ verificationId: string; prototypeCode?: string }>("/api/phone/verification", {
      method: "POST",
      body: JSON.stringify({ phone }),
    }),
  confirm: (verificationId: string, code: string, pin: string) =>
    api<AldoPhoneSettings>("/api/phone/verification", {
      method: "PUT",
      body: JSON.stringify({ verificationId, code, pin }),
    }),
  update: (input: { smsEnabled?: boolean; voiceEnabled?: boolean; pin?: string }) =>
    api<AldoPhoneSettings>("/api/phone", { method: "PATCH", body: JSON.stringify(input) }),
  disconnect: () => api<AldoPhoneSettings>("/api/phone", { method: "DELETE" }),
  prototype: (input: Record<string, unknown>) =>
    api<{ reply?: string | null; state?: string; callId?: string; twiml?: string }>(
      "/api/phone/prototype",
      { method: "POST", body: JSON.stringify(input) },
    ),
};

/** Where connecting starts: Aldo sends it on to the provider's sign-in. */
export function aldoIntegrationConnectUrl(
  provider: string,
  account?: AldoIntegrationAccountType,
): string {
  const path = `/api/integrations/${encodeURIComponent(provider)}/connect`;
  return account ? `${path}?account=${account}` : path;
}

export async function disconnectAldoIntegration(provider: string): Promise<void> {
  await api(`/api/integrations/${encodeURIComponent(provider)}`, { method: "DELETE" });
}

/** Connects a generator with the user's key, using an account check where the provider supports one. */
export async function connectAldoIntegrationKey(
  provider: string,
  values: Readonly<Record<string, string>>,
): Promise<void> {
  await api(`/api/integrations/${encodeURIComponent(provider)}`, {
    method: "POST",
    body: JSON.stringify({ values }),
  });
}

// ---------------------------------------------------------------------------
// Previews, the shared browser and the vault (served by aldod in each sandbox)

export interface AldoPreviewPort {
  readonly port: number;
  readonly process: string;
  readonly command: string;
}

export interface AldoService {
  readonly name: string;
  readonly command: string;
  readonly cwd: string;
  readonly running: boolean;
  readonly restarts: number;
}

export interface AldoPreviews {
  readonly running: boolean;
  readonly ports: ReadonlyArray<AldoPreviewPort>;
  readonly services: ReadonlyArray<AldoService>;
}

/** Dev servers listening in a thread's sandbox. Never wakes it. */
export function fetchAldoPreviews(environmentId: string): Promise<AldoPreviews> {
  return api<AldoPreviews>(`/api/environments/${threadIdForEnvironment(environmentId)}/previews`);
}

/** The owner-only link to a port in a thread's sandbox (wakes it when opened). */
export function aldoPreviewUrl(environmentId: string, port: number): string {
  return `/p/${threadIdForEnvironment(environmentId)}/${port}`;
}

/** Signed WebSocket URLs for the thread's live browser and desktop; AldoApiError 409 while asleep. */
export async function aldoBrowserConnection(
  environmentId: string,
): Promise<{ url: string; desktopUrl: string }> {
  return api<{ url: string; desktopUrl: string }>(
    `/api/environments/${threadIdForEnvironment(environmentId)}/browser`,
    { method: "POST" },
  );
}

/** Repositories from every connected host, and hosts that couldn't be listed. */
export async function listAldoRepositoryDirectory(): Promise<{
  repositories: ReadonlyArray<SourceControlRepositorySummary>;
  errors: ReadonlyArray<string>;
  hosts: ReadonlyArray<AldoHostKind>;
}> {
  return api("/api/repos");
}

export interface AldoFollowedPullRequest {
  readonly repo: string;
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly status: "watching" | "merged" | "closed" | "stopped";
  readonly followups: number;
  /** Where it is (checks → merged → deployed); an older Aldo leaves these out. */
  readonly stage?: AldoPullRequestStage;
  readonly checks?: AldoCheckCounts | null;
  readonly deploy?: AldoCheckCounts | null;
}

/** Pull requests Aldo is following through for a thread. */
export async function fetchAldoPullRequests(
  environmentId: string,
): Promise<ReadonlyArray<AldoFollowedPullRequest>> {
  const { pullRequests } = await api<{ pullRequests: AldoFollowedPullRequest[] }>(
    `/api/environments/${threadIdForEnvironment(environmentId)}/prs`,
  );
  return pullRequests;
}

/** Sets how much extra usage past the plan's credits is allowed each period, in cents. */
export async function setAldoSpendLimit(cents: number): Promise<void> {
  await api("/api/usage", { method: "PATCH", body: JSON.stringify({ spendLimitCents: cents }) });
}

/** The usage summary the Usage page shows (state/aldoWorkspaceUsage.ts checks its shape). */
export async function fetchAldoCloudUsage(signal?: AbortSignal): Promise<unknown> {
  return api<unknown>("/api/usage", { cache: "no-store", ...(signal ? { signal } : {}) });
}

/** Where to pay for a plan: Stripe Checkout, which comes back to /usage?checkout=done or =canceled. */
export async function startAldoCheckout(plan: string): Promise<string> {
  const { url } = await api<{ url: string }>("/api/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ plan }),
  });
  return url;
}

/**
 * Switches the Stripe plan: an upgrade now, a downgrade when the period ends;
 * the current plan cancels a pending downgrade. 409 when there's no Stripe
 * subscription (check out instead), 402 when the upgrade's payment failed.
 */
export async function changeAldoPlan(plan: string): Promise<"now" | "period_end"> {
  const { effective } = await api<{ effective: "now" | "period_end" }>("/api/billing/plan", {
    method: "POST",
    body: JSON.stringify({ plan }),
  });
  return effective;
}

/** Ends the plan when the period does, or with `resume`, keeps it going after all. */
export async function cancelAldoPlan(resume: boolean): Promise<void> {
  await api("/api/billing/cancel", { method: "POST", body: JSON.stringify({ resume }) });
}

/** Stripe's billing portal (payment method, invoices), which comes back to /usage. */
export async function aldoBillingPortalUrl(): Promise<string> {
  const { url } = await api<{ url: string }>("/api/billing/portal", { method: "POST" });
  return url;
}

/** Moves a thread to another machine size. A running machine restarts, and its agent carries on. */
export async function setAldoMachine(environmentId: string, size: AldoMachineSize): Promise<void> {
  await api(`/api/environments/${threadIdForEnvironment(environmentId)}/machine`, {
    method: "POST",
    body: JSON.stringify({ size }),
  });
  requestAldoDirectoryRefresh();
}

/** Answers a thread's agent asking for one of the user's computers: agreeing starts it. */
export async function answerAldoComputer(
  environmentId: string,
  approve: boolean,
  kind: string,
): Promise<void> {
  await api(`/api/environments/${threadIdForEnvironment(environmentId)}/computer`, {
    method: "POST",
    body: JSON.stringify({ approve, kind }),
  });
  requestAldoDirectoryRefresh();
}

/**
 * Stops a thread's computer of a kind (it stops costing credits). Returns
 * what Aldo says came of it; an older Aldo, without it, refuses with a 405
 * (and one from before GPU computers stops the thread's Windows computer).
 */
export async function stopAldoComputer(environmentId: string, kind: string): Promise<string> {
  const { message } = await api<{ message?: unknown }>(
    `/api/environments/${threadIdForEnvironment(environmentId)}/computer?kind=${encodeURIComponent(kind)}`,
    { method: "DELETE" },
  );
  requestAldoDirectoryRefresh();
  // An Aldo that answers with the web client's page instead didn't stop anything either.
  if (typeof message !== "string") throw new AldoApiError(405, "Stopping it isn't available.");
  return message;
}

/** Merges a followed pull request whose checks all passed; Aldo then follows its deploy. */
export async function mergeAldoPullRequest(
  environmentId: string,
  pr: { repo: string; number: number },
): Promise<void> {
  await api(`/api/environments/${threadIdForEnvironment(environmentId)}/prs`, {
    method: "POST",
    body: JSON.stringify({ repo: pr.repo, number: pr.number }),
  });
}

export async function stopAldoFollowThrough(
  environmentId: string,
  pr?: { repo: string; number: number },
): Promise<void> {
  await api(`/api/environments/${threadIdForEnvironment(environmentId)}/prs`, {
    method: "DELETE",
    body: JSON.stringify(pr ?? {}),
  });
}

export interface AldoEnvironmentService {
  readonly name: string;
  readonly command: string;
  readonly cwd?: string;
}

export interface AldoEnvironmentBuild {
  readonly id: string;
  readonly status: "building" | "ready" | "failed" | "superseded";
  readonly commit_sha: string | null;
  readonly install: string;
  readonly log: string | null;
  readonly snapshot_id: string | null;
  readonly started_at: string;
  readonly finished_at: string | null;
}

export interface AldoPrebuiltEnvironment {
  readonly id: string;
  readonly repos: ReadonlyArray<string>;
  readonly install: string;
  readonly services: ReadonlyArray<AldoEnvironmentService>;
  readonly current_build: string | null;
  readonly building: string | null;
  readonly updated_at: string;
  readonly builds: ReadonlyArray<AldoEnvironmentBuild>;
}

/** Ready-to-go environments (Settings → Environments). */
export const aldoPrebuilds = {
  list: async () =>
    (await api<{ environments: AldoPrebuiltEnvironment[] }>("/api/prebuilds")).environments,
  save: (input: {
    repos: ReadonlyArray<string>;
    install: string;
    services: ReadonlyArray<AldoEnvironmentService>;
  }) => api("/api/prebuilds", { method: "POST", body: JSON.stringify(input) }),
  rebuild: (id: string) => api(`/api/prebuilds/${id}/rebuild`, { method: "POST" }),
  use: (id: string, buildId: string) =>
    api(`/api/prebuilds/${id}/use`, { method: "POST", body: JSON.stringify({ buildId }) }),
  remove: (id: string) => api(`/api/prebuilds/${id}`, { method: "DELETE" }),
};

/** The user's instructions for their agents: for every project (scope "*") or one repository. */
export interface AldoInstructions {
  readonly scope: string;
  readonly text: string;
  readonly updated_at: string;
}

/** Settings → Instructions. */
export const aldoInstructions = {
  list: async () =>
    (await api<{ instructions: AldoInstructions[] }>("/api/instructions")).instructions,
  /**
   * Replaces one scope's instructions (empty text removes them). `since` is the
   * updated_at the edit started from (null for none): if they've changed since,
   * Aldo refuses with a 409.
   */
  save: async (scope: string, text: string, since: string | null) =>
    (
      await api<{ instructions: AldoInstructions[] }>("/api/instructions", {
        method: "POST",
        body: JSON.stringify({ scope, text, since }),
      })
    ).instructions,
};

/** How a vault secret reaches a thread: a variable, injected into requests to some sites, or a file. */
export type AldoSecretKind = "env" | "request" | "file";

export interface AldoVaultItem {
  readonly id: string;
  readonly kind: AldoSecretKind | "login";
  readonly name: string;
  readonly scope: string;
  readonly origin: string | null;
  readonly username: string | null;
  readonly hosts: ReadonlyArray<string> | null;
  readonly header: string | null;
  readonly template: string | null;
  readonly path: string | null;
  readonly updated_at: string;
  readonly last_used_at: string | null;
  /** The thread whose agent saved it (save_secret, save_login); null or absent for the user's own. */
  readonly agent_thread_id?: string | null;
}

export interface AldoSecretInput {
  readonly kind: AldoSecretKind;
  readonly name: string;
  readonly scope: string;
  /** Empty keeps the saved value (to change only how it's delivered). */
  readonly value: string;
  readonly hosts?: string;
  readonly header?: string;
  readonly template?: string;
  readonly path?: string;
  /** The thread that asked for it (request_secret): told when it's saved. */
  readonly requestedBy?: { readonly thread: string; readonly t3?: string };
}

export const aldoVault = {
  list: async () => (await api<{ items: AldoVaultItem[] }>("/api/vault")).items,
  saveSecret: (input: AldoSecretInput) =>
    api<{ item: AldoVaultItem }>("/api/vault", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  saveLogin: (input: {
    id?: string;
    label: string;
    origin: string;
    username: string;
    password?: string;
    scope: string;
  }) =>
    api<{ item: AldoVaultItem }>("/api/vault", {
      method: "POST",
      body: JSON.stringify({ kind: "login", ...input }),
    }),
  remove: (id: string) => api(`/api/vault/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** Sites the user said never to offer saving a login for. An Aldo from before it kept them answers 404 or 405. */
  neverSave: async () => (await api<{ origins: string[] }>("/api/vault/never-save")).origins,
  setNeverSave: (origin: string, never: boolean) =>
    api<{ origin: string }>("/api/vault/never-save", {
      method: never ? "POST" : "DELETE",
      body: JSON.stringify({ origin }),
    }),
  importDotenv: (scope: string, text: string) =>
    api<{ saved: string[]; skipped: string[] }>("/api/vault/import", {
      method: "POST",
      body: JSON.stringify({ scope, text }),
    }),
};

// ---------------------------------------------------------------------------
// Aldo, the assistant

/** A realtime session with Aldo: the short-lived key the browser connects to OpenAI with. */
export interface AldoVoiceSession {
  readonly sessionId: string;
  readonly key: string;
  readonly expiresAt: number;
  readonly model: string;
}

/**
 * Whether this Aldo has the assistant: its tool list, as JSON. An older Aldo
 * answers a path it doesn't know with the web client's own page (200, HTML),
 * so the status alone doesn't tell.
 */
/** The images a written message to Aldo takes: how many, how large each, and of which types. */
export interface AldoImageLimits {
  readonly max: number;
  readonly maxBytes: number;
  readonly types: ReadonlyArray<string>;
}

/** Whether this Aldo has the assistant, and the images its written messages take (null: none, as on an older Aldo). */
export async function aldoAssistantInfo(): Promise<{
  readonly available: boolean;
  readonly images: AldoImageLimits | null;
}> {
  const response = await fetch("/api/assistant/tools", { credentials: "same-origin" }).catch(
    () => null,
  );
  if (!response?.ok) return { available: false, images: null };
  const body = (await response.json().catch(() => null)) as {
    tools?: unknown;
    images?: { max?: unknown; maxBytes?: unknown; types?: unknown };
  } | null;
  const images = body?.images;
  return {
    available: Array.isArray(body?.tools),
    images:
      typeof images?.max === "number" &&
      images.max > 0 &&
      typeof images.maxBytes === "number" &&
      Array.isArray(images.types)
        ? {
            max: images.max,
            maxBytes: images.maxBytes,
            types: images.types.filter((t): t is string => typeof t === "string"),
          }
        : null,
  };
}

export async function aldoAssistantAvailable(): Promise<boolean> {
  return (await aldoAssistantInfo()).available;
}

/** An image to send with a written message, as Aldo takes it. */
export interface AldoImageUpload {
  readonly name: string;
  readonly dataUrl: string;
}

/** A written turn with Aldo: its reply, and the tool calls it made with what came of each. */
export interface AldoChatTurn {
  readonly sessionId: string;
  readonly reply: string;
  readonly calls: ReadonlyArray<{
    readonly callId: string;
    readonly name: string;
    readonly arguments: Record<string, unknown>;
    readonly outcome: unknown;
  }>;
}

export const aldoAssistant = {
  startSession: () => api<AldoVoiceSession>("/api/assistant/session", { method: "POST" }),
  /**
   * A written turn, typed without a call (Aldo's src/lib/assistant/chat.ts);
   * null where this Aldo can't chat in writing (an older one answers a path
   * it doesn't know with the web client's own page). `viewing` is the thread
   * on screen, which Aldo names for "this one" (an older Aldo ignores it).
   */
  chat: async (
    sessionId: string | null,
    text: string,
    images: ReadonlyArray<AldoImageUpload> = [],
    viewing: AldoHomeTarget | null = null,
  ): Promise<AldoChatTurn | null> => {
    const body = await api<Partial<AldoChatTurn>>("/api/assistant/chat", {
      method: "POST",
      body: JSON.stringify({
        sessionId,
        text,
        ...(images.length > 0 ? { images } : {}),
        ...(viewing ? { viewing } : {}),
      }),
    });
    if (typeof body.reply !== "string" || typeof body.sessionId !== "string") return null;
    return {
      sessionId: body.sessionId,
      reply: body.reply,
      calls: Array.isArray(body.calls) ? body.calls : [],
    };
  },
  /** Runs a tool the model called: { result } or, for a refusal the model should hear, { error }. */
  runTool: (
    name: string,
    args: Record<string, unknown>,
    sessionId: string | null,
    heard: ReadonlyArray<string>,
  ) =>
    api<{ result?: unknown; error?: string }>(`/api/assistant/tools/${encodeURIComponent(name)}`, {
      method: "POST",
      body: JSON.stringify({ arguments: args, sessionId, heard }),
    }),
  record: (sessionId: string, items: ReadonlyArray<{ role: "user" | "assistant"; text: string }>) =>
    api("/api/assistant/history", { method: "POST", body: JSON.stringify({ sessionId, items }) }),
  history: async (limit = 50) =>
    (
      await api<{
        messages: Array<{ role: "user" | "assistant"; text: string; at: string; source?: "brief" }>;
      }>(`/api/assistant/history?limit=${limit}`)
    ).messages,
};

/** One of the brief's things to decide first; `key` is its decision's (decisions.logic.ts). */
export interface AldoBriefItem {
  readonly key: string;
  /** What it was, for once it's decided (an older Aldo leaves it out). */
  readonly title?: string;
  /** Why it matters now, in a few words. */
  readonly why: string | null;
  /** For a question: the choice Aldo would pick, with why. */
  readonly suggestion: string | null;
  readonly reason: string | null;
}

/** Aldo's brief for the day: the first time the user opens Aldo each day. */
export interface AldoBrief {
  readonly day: string;
  /** When it was made: when it was said in the conversation. */
  readonly at: string;
  readonly title: string;
  readonly text: string;
  readonly top: ReadonlyArray<AldoBriefItem>;
  /** The rest of today's calendar. */
  readonly ahead: ReadonlyArray<{
    readonly title: string;
    readonly start: string;
    readonly allDay: boolean;
  }>;
}

/**
 * Today's brief, made by this ask if it's the day's first (a few seconds);
 * `pending` while another ask makes it. Null for an Aldo without briefs.
 */
export async function fetchAldoBrief(): Promise<{
  readonly brief: AldoBrief | null;
  readonly pending?: boolean;
} | null> {
  try {
    return await api<{ brief: AldoBrief | null; pending?: boolean }>("/api/assistant/brief");
  } catch (cause) {
    if (cause instanceof AldoApiError && cause.status === 404) return null;
    throw cause;
  }
}

/** A day's brief read aloud (an mp3 the browser keeps for the day). */
export function aldoBriefAudioUrl(day: string): string {
  return `/api/assistant/brief/audio?day=${encodeURIComponent(day)}`;
}

/** The signed-in user, for the sidebar and the account dialog. */
export interface AldoProfile {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly imageUrl: string | null;
  /** Where they manage their sign-in (name, email, password, sessions). */
  readonly manageUrl: string;
  readonly signOutUrl: string;
}

/** Who's signed in; null where this Aldo can't say (an older one answers with the client's page). */
export async function fetchAldoProfile(): Promise<AldoProfile | null> {
  const body = await api<Partial<AldoProfile>>("/api/account").catch(() => null);
  return body && typeof body.email === "string" && typeof body.id === "string"
    ? {
        id: body.id,
        email: body.email,
        name: typeof body.name === "string" && body.name.trim() ? body.name : null,
        imageUrl: typeof body.imageUrl === "string" && body.imageUrl ? body.imageUrl : null,
        manageUrl: typeof body.manageUrl === "string" ? body.manageUrl : "/account",
        signOutUrl: typeof body.signOutUrl === "string" ? body.signOutUrl : "/sign-out",
      }
    : null;
}

/** What Aldo knows about the user: its profile of them and its notes. */
export interface AldoMemoryItem {
  readonly id: string;
  readonly kind: "profile" | "note";
  readonly title: string;
  readonly body: string;
  /** Who wrote it last: aldo (in conversation), consolidation (after one), or user. */
  readonly source: string;
  readonly updatedAt: string;
}

export const aldoMemory = {
  list: async () => {
    const { items } = await api<{ items?: AldoMemoryItem[] }>("/api/assistant/memory");
    // An older Aldo answers with the web client's page: it has no memory.
    if (!Array.isArray(items))
      throw new AldoApiError(404, "This Aldo server doesn't have memory yet.");
    return items;
  },
  saveProfile: async (body: string) =>
    (
      await api<{ items: AldoMemoryItem[] }>("/api/assistant/memory", {
        method: "POST",
        body: JSON.stringify({ kind: "profile", body }),
      })
    ).items,
  saveNote: async (title: string, body: string) =>
    (
      await api<{ items: AldoMemoryItem[] }>("/api/assistant/memory", {
        method: "POST",
        body: JSON.stringify({ kind: "note", title, body }),
      })
    ).items,
  forget: async (id: string) =>
    (
      await api<{ items: AldoMemoryItem[] }>(`/api/assistant/memory?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
    ).items,
};

// ---------------------------------------------------------------------------
// The home screen: the user's agents' work in one read (Aldo's src/lib/home.ts)

export interface AldoHomeTarget {
  readonly environmentId: string;
  readonly threadId: string;
}

/** What a conversation is waiting on the user for, with its choices. */
export type AldoHomePending =
  | {
      readonly kind: "question";
      readonly requestId: string;
      readonly questions: ReadonlyArray<{
        readonly id: string;
        readonly header: string;
        readonly question: string;
        readonly options: ReadonlyArray<{ readonly label: string; readonly description: string }>;
        readonly multiSelect: boolean;
      }>;
    }
  | {
      readonly kind: "approval";
      readonly requestId: string;
      readonly summary: string;
      readonly detail?: string;
      readonly options: ReadonlyArray<{ readonly decision: string; readonly label: string }>;
    };

export interface AldoHomeConversation {
  readonly ref: string;
  readonly thread: AldoHomeTarget;
  readonly title: string;
  readonly repos: ReadonlyArray<string>;
  readonly branch: string;
  /** working, waiting, done, failed; starting, queued, retrying; new (nothing sent yet). */
  readonly state: string;
  /** What it last said, asked or failed with. */
  readonly summary?: string;
  /** Its machine: running, asleep, not created, failed. */
  readonly machine: string;
  readonly model?: string;
  readonly at: string;
  readonly pullRequests?: ReadonlyArray<{
    readonly repo: string;
    readonly number: number;
    readonly title: string;
    readonly stage: AldoPullRequestStage;
    readonly url: string;
  }>;
  readonly pending?: AldoHomePending;
  readonly plan?: { readonly id: string; readonly text: string };
  readonly pressure?: AldoMachinePressure | null;
  /** Snoozed until then (only while that's ahead), or settled: put away in the user's list. */
  readonly snoozedUntil?: string;
  readonly settled?: true;
}

export interface AldoHomePullRequest {
  readonly environmentId: string;
  readonly thread: AldoHomeTarget | null;
  readonly threadTitle: string;
  readonly repo: string;
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly status: "watching" | "merged" | "closed" | "stopped";
  readonly stage: AldoPullRequestStage;
  readonly checks: AldoCheckCounts | null;
  readonly deploy: AldoCheckCounts | null;
  readonly followups: number;
  readonly reviewsExhausted: boolean;
  readonly greenSince: string | null;
  /** When Aldo merges it on its own, if nothing changes (the workspace's policy says so). */
  readonly mergesAt: string | null;
  readonly mergedAt: string | null;
  readonly updatedAt: string;
}

export interface AldoHomeDelivery {
  readonly id: string;
  readonly kind: "reminder" | "message" | "notice" | "routine";
  readonly thread: AldoHomeTarget;
  readonly threadTitle: string;
  readonly message: string;
  readonly dueAt: string;
  readonly createdAt: string;
  /** Due, but its thread couldn't take it yet. */
  readonly held: boolean;
}

export interface AldoHomeAction {
  readonly id: string;
  readonly tool: string;
  readonly title: string | null;
  readonly asked: string;
  readonly failed: boolean;
  readonly error: string | null;
  readonly thread: AldoHomeTarget | null;
  readonly at: string;
  /** It undid what its tool's name says (unpinned, unsnoozed, unsettled); an older Aldo doesn't say. */
  readonly reverse?: boolean;
}

export interface AldoHomeUsage {
  readonly configured: boolean;
  readonly metered: boolean;
  readonly plan: {
    readonly id: string;
    readonly name: string;
    readonly includedCredits: number;
  } | null;
  readonly period: { readonly status: string; readonly start: string; readonly end: string } | null;
  readonly credits: {
    readonly used: number;
    readonly included: number;
    readonly authorized: number;
    readonly remaining: number;
    readonly projected: number | null;
  } | null;
  readonly bill: {
    readonly estimatedCents: number;
    readonly projectedCents: number | null;
    readonly spendLimitCents: number;
  } | null;
  readonly alert: string;
  readonly agents: { readonly running: number; readonly limit: number | null };
}

export interface AldoPolicy {
  readonly merge?: "auto" | "approve";
  readonly mergeMethod?: Record<string, string>;
  readonly spendThreshold?: number;
  readonly reviews?: "all" | "important";
}

// ---------------------------------------------------------------------------
// Routines: standing instructions that run in a thread of their own on a
// schedule (in the user's time zone) or when their webhook is called.

export type AldoWeekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface AldoRoutineSchedule {
  readonly every: "day" | "weekdays" | "week" | "month" | "hours";
  /** Times of day, HH:MM (24-hour). */
  readonly at?: ReadonlyArray<string>;
  readonly days?: ReadonlyArray<AldoWeekday>;
  readonly day?: number;
  readonly hours?: number;
}

export interface AldoRoutine {
  readonly id: string;
  readonly title: string;
  readonly instruction: string;
  readonly schedule: AldoRoutineSchedule | null;
  /** When it runs, in words ("Weekdays at 07:00 (America/New_York)"). */
  readonly when: string;
  readonly timeZone: string;
  readonly repos: ReadonlyArray<string>;
  readonly enabled: boolean;
  /** Its webhook URL, when it has one: anything POSTed to it runs the routine. */
  readonly webhook: string | null;
  readonly nextRunAt: string | null;
  readonly lastRunAt: string | null;
  readonly lastResult: string | null;
  readonly createdBy: "user" | "aldo" | "agent";
  /** The thread its runs go to, once there is one. */
  readonly thread: AldoHomeTarget | null;
}

export interface AldoRoutineInput {
  readonly title?: string;
  readonly instruction?: string;
  readonly schedule?: AldoRoutineSchedule | null;
  readonly webhook?: boolean;
  readonly enabled?: boolean;
}

export async function createAldoRoutine(input: AldoRoutineInput): Promise<AldoRoutine> {
  const { routine } = await api<{ routine: AldoRoutine }>("/api/routines", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return routine;
}

export async function updateAldoRoutine(id: string, input: AldoRoutineInput): Promise<AldoRoutine> {
  const { routine } = await api<{ routine: AldoRoutine }>(
    `/api/routines/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return routine;
}

export async function deleteAldoRoutine(id: string): Promise<void> {
  await api(`/api/routines/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Runs a routine now; says how it went ("started a thread for it", "skipped: ..."). */
export async function runAldoRoutine(id: string): Promise<string> {
  const { result } = await api<{ result: string }>(`/api/routines/${encodeURIComponent(id)}/run`, {
    method: "POST",
  });
  return result;
}

// ---------------------------------------------------------------------------
// Approvals: what waits on the user's one tap. An email an agent drafted in
// their mail (sent as it stands), an event for their calendar, or a thread
// Aldo suggests in a heads-up. Aldo does it when they approve.

export type AldoApprovalStatus = "pending" | "sending" | "approved" | "discarded" | "expired";

export interface AldoApproval {
  readonly id: string;
  readonly kind: "email" | "event" | "start";
  readonly provider: "google" | "microsoft" | null;
  readonly title: string;
  /** One line: who it's to, or when. */
  readonly summary: string;
  /** What it is in full, labeled: To, Cc, Bcc, Attached; When, Invites, Where. */
  readonly fields: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  /** The email's text, the event's description, or what the thread would be asked. */
  readonly body: string;
  readonly approveLabel: string;
  readonly discardLabel: string;
  readonly status: AldoApprovalStatus;
  /** What was done, or why the last try failed (`failed`) while it waits. */
  readonly result: string | null;
  readonly failed: boolean;
  readonly thread: AldoHomeTarget | null;
  readonly threadTitle: string | null;
  readonly createdAt: string;
  readonly decidedAt: string | null;
}

/** Approves or discards one; says what was done. Aldo refuses (409) an email whose draft changed since it was shown. */
export async function decideAldoApproval(
  id: string,
  decision: "approve" | "discard",
): Promise<{ readonly approval: Omit<AldoApproval, "threadTitle">; readonly message: string }> {
  return api(`/api/approvals/${encodeURIComponent(id)}`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}

/** Aldo's heads-ups: whether it looks at the user's new mail and coming events between conversations. */
export interface AldoHeadsUps {
  readonly on: boolean;
  readonly lookedAt: string | null;
}

/** Heads-ups as Aldo answered, or null for an answer that isn't (an older Aldo's page for a path it doesn't have). */
function headsUpsOf(body: Partial<AldoHeadsUps> | null): AldoHeadsUps | null {
  return typeof body?.on === "boolean"
    ? { on: body.on, lookedAt: typeof body.lookedAt === "string" ? body.lookedAt : null }
    : null;
}

/** Null where this Aldo has no heads-ups. */
export async function fetchAldoHeadsUps(): Promise<AldoHeadsUps | null> {
  try {
    return headsUpsOf(await api<Partial<AldoHeadsUps>>("/api/assistant/heads-ups"));
  } catch (cause) {
    if (cause instanceof AldoApiError && cause.status === 404) return null;
    throw cause;
  }
}

export async function setAldoHeadsUps(on: boolean): Promise<AldoHeadsUps> {
  const saved = headsUpsOf(
    await api<Partial<AldoHeadsUps>>("/api/assistant/heads-ups", {
      method: "PUT",
      body: JSON.stringify({ on }),
    }),
  );
  if (!saved) throw new Error("This Aldo doesn't have heads-ups.");
  return saved;
}

export interface AldoHome {
  readonly at: string;
  readonly conversations: ReadonlyArray<AldoHomeConversation>;
  readonly pullRequests: ReadonlyArray<AldoHomePullRequest>;
  readonly upcoming: ReadonlyArray<AldoHomeDelivery>;
  /** What waits on the user's tap, then what they decided in the last day (an older Aldo leaves them out). */
  readonly approvals?: ReadonlyArray<AldoApproval>;
  /** The user's routines (an older Aldo leaves them out). */
  readonly routines?: ReadonlyArray<AldoRoutine>;
  readonly actions: ReadonlyArray<AldoHomeAction>;
  readonly usage: AldoHomeUsage;
  readonly spends: {
    readonly once: number;
    readonly monthly: number;
    readonly recent: ReadonlyArray<{
      readonly id: string;
      readonly what: string;
      readonly amount: number;
      readonly monthly: boolean;
      readonly approvedByUser: boolean;
      readonly stopped: boolean;
      readonly at: string;
    }>;
  };
  readonly health: {
    readonly providers: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly signedIn: boolean;
    }>;
    readonly connected: ReadonlyArray<string>;
    readonly environments: ReadonlyArray<{
      readonly repos: ReadonlyArray<string>;
      readonly status: "ready" | "building" | "failed" | "none";
      readonly at: string;
    }>;
  };
  readonly policy: {
    readonly everywhere: AldoPolicy;
    readonly workspaces: ReadonlyArray<{
      readonly repos: ReadonlyArray<string>;
      readonly policy: AldoPolicy;
    }>;
  };
}

/** The home screen's read; null where this Aldo doesn't have it (an older one answers with the web client's own page). */
export async function fetchAldoHome(): Promise<AldoHome | null> {
  const body = await api<Partial<AldoHome>>("/api/home");
  return Array.isArray(body.conversations) ? (body as AldoHome) : null;
}

/**
 * Answers the question or approval a conversation is waiting on, as the
 * user. `requestId` is the one the page showed: Aldo refuses (409) if the
 * thread has moved on to another. Says what happened.
 */
export async function answerAldoThread(
  target: AldoHomeTarget,
  answer: {
    readonly requestId: string;
    readonly answers?: Record<string, string | ReadonlyArray<string>>;
    readonly text?: string;
    readonly decision?: string;
  },
): Promise<string> {
  const { status } = await api<{ status: string }>(
    `/api/environments/${threadIdForEnvironment(target.environmentId)}/actions`,
    {
      method: "POST",
      body: JSON.stringify({ action: "answer", t3ThreadId: target.threadId, ...answer }),
    },
  );
  return status;
}

/**
 * Has the agent carry out the plan it proposed (`planId`, the one the page
 * showed; refused if it proposes another now), or, with changes, asks for a
 * revised one.
 */
/** Sends a thread's agent a message as the user: now if it's free (waking it if needed), else once its turn ends. */
export async function sendAldoThreadMessage(target: AldoHomeTarget, text: string): Promise<void> {
  await api(`/api/environments/${threadIdForEnvironment(target.environmentId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ text, t3ThreadId: target.threadId }),
  });
}

export async function approveAldoPlan(
  target: AldoHomeTarget,
  planId: string,
  changes?: string,
): Promise<string> {
  const { status } = await api<{ status: string }>(
    `/api/environments/${threadIdForEnvironment(target.environmentId)}/actions`,
    {
      method: "POST",
      body: JSON.stringify({
        action: "approve_plan",
        t3ThreadId: target.threadId,
        planId,
        changes,
      }),
    },
  );
  return status;
}

/** A thread's latest turns as Aldo keeps them (its last three: the messages, and what it waits on). */
export interface AldoConversationCopy {
  readonly state: string;
  readonly messages: ReadonlyArray<{
    readonly role: string;
    readonly text: string;
    readonly createdAt: string;
  }>;
}

/**
 * A thread's latest turns, from its machine while it runs, else Aldo's copy,
 * without waking it; null where Aldo has no copy yet (or can't say).
 */
export async function fetchAldoConversationCopy(
  target: AldoHomeTarget,
): Promise<AldoConversationCopy | null> {
  const path = `/api/environments/${threadIdForEnvironment(target.environmentId)}/conversation?t3ThreadId=${encodeURIComponent(target.threadId)}`;
  const body = await api<{ conversation?: Partial<AldoConversationCopy> }>(path).catch(
    (error: unknown) => {
      if (error instanceof AldoApiError && error.status === 404) return null;
      throw error;
    },
  );
  const copy = body?.conversation;
  return copy && Array.isArray(copy.messages)
    ? { state: typeof copy.state === "string" ? copy.state : "", messages: copy.messages }
    : null;
}

/** Sends a waiting delivery (a reminder, a message) now rather than when it's due. */
export async function sendAldoDeliveryNow(id: string): Promise<void> {
  await api(`/api/deliveries/${encodeURIComponent(id)}`, { method: "POST" });
}

/** Cancels a waiting delivery: it's never sent. */
export async function cancelAldoDelivery(id: string): Promise<void> {
  await api(`/api/deliveries/${encodeURIComponent(id)}`, { method: "DELETE" });
}
