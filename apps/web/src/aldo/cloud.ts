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
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

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

function threadIdForEnvironment(environmentId: string): string {
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

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...init.headers },
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
const directoryListeners = new Set<() => void>();
let refreshRequested = true;
/** Emit the directory as it is now, without fetching (a sandbox was just added to it). */
let emitRequested = false;
let lastFetchAt = 0;
const IDLE_REFRESH_MS = 15_000;

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

/** What a thread's panels say while its cloud agent is offline. */
export function aldoOfflineMessage(environmentId: string): string {
  return aldoMachineIsNew(environmentId)
    ? "The cloud agent starts when you send your first message."
    : "Reconnecting to the cloud…";
}

export function requestAldoDirectoryRefresh(): void {
  refreshRequested = true;
}

async function fetchEnvironments(): Promise<ReadonlyArray<AldoEnvironment>> {
  const { environments } = await api<{ environments: AldoEnvironment[] }>("/api/environments");
  knownEnvironments = environments;
  for (const listener of directoryListeners) listener();
  return environments;
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
    .filter((environment) => !pendingEnvironmentIds.has(environment.environmentId))
    .map(registrationFor);
}

async function pollDirectory(): Promise<Array<BearerConnectionRegistration> | null> {
  if (emitRequested && knownEnvironments) {
    emitRequested = false;
    return currentRegistrations(knownEnvironments);
  }
  const due = refreshRequested || Date.now() - lastFetchAt > IDLE_REFRESH_MS;
  if (!due) return null;
  refreshRequested = false;
  lastFetchAt = Date.now();
  try {
    return currentRegistrations(await fetchEnvironments());
  } catch {
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

/** Deletes a sandbox and everything in it. */
export async function deleteAldoEnvironment(environmentId: string): Promise<void> {
  const threadId = threadIdForEnvironment(environmentId);
  await api(`/api/environments/${threadId}`, { method: "DELETE" });
  requestAldoDirectoryRefresh();
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

export interface AldoVaultItem {
  readonly id: string;
  readonly kind: "env" | "login";
  readonly name: string;
  readonly scope: string;
  readonly origin: string | null;
  readonly username: string | null;
  readonly updated_at: string;
  readonly last_used_at: string | null;
}

export const aldoVault = {
  list: async () => (await api<{ items: AldoVaultItem[] }>("/api/vault")).items,
  saveVariable: (input: { name: string; value: string; scope: string }) =>
    api<{ item: AldoVaultItem }>("/api/vault", {
      method: "POST",
      body: JSON.stringify({ kind: "env", ...input }),
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
  importDotenv: (scope: string, text: string) =>
    api<{ saved: string[]; skipped: string[] }>("/api/vault/import", {
      method: "POST",
      body: JSON.stringify({ scope, text }),
    }),
};
