// Aldo cloud mode. The web client is served by Aldo, which runs one sandbox
// per thread; each sandbox runs a stock T3 server and appears here as a
// platform bearer environment. Aldo's same-origin API lists the sandboxes,
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
  readonly branch: string;
  readonly state: "new" | "ready" | "stopped" | "failed";
}

export type AldoAccountKind = "github" | "claude" | "codex" | "grok";

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
let lastFetchAt = 0;
const IDLE_REFRESH_MS = 15_000;

export function subscribeAldoEnvironments(listener: () => void): () => void {
  directoryListeners.add(listener);
  return () => directoryListeners.delete(listener);
}

export function getAldoEnvironments(): ReadonlyArray<AldoEnvironment> | null {
  return knownEnvironments;
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
async function pollDirectory(): Promise<Array<BearerConnectionRegistration> | null> {
  const due = refreshRequested || Date.now() - lastFetchAt > IDLE_REFRESH_MS;
  if (!due) return null;
  refreshRequested = false;
  lastFetchAt = Date.now();
  try {
    const environments = await fetchEnvironments();
    return environments.map(registrationFor);
  } catch {
    refreshRequested = true;
    return null;
  }
}

export function aldoPlatformRegistrations(): Stream.Stream<
  ReadonlyArray<PlatformConnectionRegistration>
> {
  return Stream.tick("2 seconds").pipe(
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
                detail: "This thread's sandbox is asleep.",
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

/** Deletes a thread's sandbox (and everything in it) once its last thread is gone. */
export async function deleteAldoEnvironment(environmentId: string): Promise<void> {
  const threadId = threadIdForEnvironment(environmentId);
  await api(`/api/environments/${threadId}`, { method: "DELETE" });
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
export async function createAldoEnvironment(input: {
  readonly repo?: string;
  readonly fromEnvironmentId?: string;
  readonly branch?: string;
}): Promise<AldoEnvironment> {
  const { environment } = await api<{ environment: AldoEnvironment }>("/api/environments", {
    method: "POST",
    body: JSON.stringify({
      repo: input.repo,
      branch: input.branch,
      fromThreadId: input.fromEnvironmentId
        ? threadIdForEnvironment(input.fromEnvironmentId)
        : undefined,
    }),
  });
  requestAldoDirectoryRefresh();
  return environment;
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

export async function fetchAldoAccounts(): Promise<Record<AldoAccountKind, AldoAccount>> {
  return api<Record<AldoAccountKind, AldoAccount>>("/api/connections");
}

export async function disconnectAldoAccount(kind: AldoAccountKind): Promise<void> {
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

/** A signed WebSocket URL for the thread's live browser; AldoApiError 409 while asleep. */
export async function aldoBrowserUrl(environmentId: string): Promise<string> {
  const { url } = await api<{ url: string }>(
    `/api/environments/${threadIdForEnvironment(environmentId)}/browser`,
    { method: "POST" },
  );
  return url;
}

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
