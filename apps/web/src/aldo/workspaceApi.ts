// Workspace, preview, computer and project APIs.

import { api, threadIdForEnvironment, AldoApiError } from "./api";
import { type AldoCost, isAldoCost } from "./costs.logic";
import { type AldoProviderLimits, aldoProviderLimitsOf } from "./providerLimits.logic";
import { type AldoShareView, parseAldoShares } from "./library.logic";
import { type AldoZip, type AldoZipFile, aldoZipOf } from "./download.logic";
import { type SourceControlRepositorySummary } from "@t3tools/contracts";
import { type AldoHostKind } from "./accountApi";
import { type AldoPullRequestStage, type AldoCheckCounts } from "./pullRequests.logic";
import { type AldoMachineSize, requestAldoDirectoryRefresh } from "./directory";

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

/**
 * What a thread has cost at API prices (its machine's agents, and each
 * conversation's share); null when Aldo doesn't say (an older one has no such
 * route). Never wakes it.
 */
export async function fetchAldoCost(environmentId: string): Promise<AldoCost | null> {
  const answer = await api<{ costs?: Record<string, unknown> }>(
    `/api/environments/costs?ids=${encodeURIComponent(environmentId)}`,
  ).catch(() => null);
  const cost = answer?.costs?.[environmentId];
  return isAldoCost(cost) ? cost : null;
}

/**
 * What's left of Aldo's plan and each connected provider's (the Usage page's
 * Plan limits); `refresh` asks the providers again unless just asked. Null
 * from an Aldo that doesn't read them.
 */
export async function fetchAldoProviderLimits(
  refresh = false,
  signal?: AbortSignal,
): Promise<ReadonlyArray<AldoProviderLimits> | null> {
  const body = await api<unknown>(`/api/usage/limits${refresh ? "?refresh=1" : ""}`, {
    cache: "no-store",
    ...(signal ? { signal } : {}),
  }).catch((error: unknown) => {
    if (error instanceof AldoApiError && error.status === 404) return null;
    throw error;
  });
  return aldoProviderLimitsOf(body);
}

/**
 * The pages and files the user's agents shared by link, pinned ones first, then newest (the
 * Library); null from an Aldo that doesn't list them.
 */
export async function fetchAldoShares(): Promise<ReadonlyArray<AldoShareView> | null> {
  const body = await api<{ shares?: unknown }>("/api/shares", { cache: "no-store" }).catch(
    (error: unknown) => {
      if (error instanceof AldoApiError && error.status === 404) return null;
      throw error;
    },
  );
  // An older Aldo may answer with the web client's page instead of a 404.
  return parseAldoShares(body?.shares);
}

/**
 * "Download everything": a zip of these files made on the thread's computer
 * (`check`: what it would hold, without making it), named `name` (the
 * conversation's). A computer asleep isn't woken: it's an AldoApiError 409
 * whose body says `asleep`, for the caller to ask the user first. Only for
 * an Aldo whose directory says `downloads` (aldoZipsResults).
 */
export async function zipAldoFiles(
  environmentId: string,
  files: ReadonlyArray<AldoZipFile>,
  options: { readonly check: boolean; readonly name?: string | undefined },
): Promise<AldoZip> {
  const body = await api<unknown>(
    `/api/environments/${threadIdForEnvironment(environmentId)}/download`,
    {
      method: "POST",
      cache: "no-store",
      body: JSON.stringify({
        files,
        check: options.check,
        ...(options.name ? { name: options.name } : {}),
      }),
    },
  );
  const zip = aldoZipOf(body);
  if (!zip) throw new AldoApiError(502, "Aldo didn’t say what the zip holds. Try again.");
  return zip;
}

/** Stops sharing one: its link stops working at once and Aldo deletes its copy (404 when already gone). */
export async function stopAldoShare(id: string): Promise<void> {
  await api(`/api/shares/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Pins one first in the Library, or unpins it; says how it stands now. */
export async function pinAldoShare(id: string, pinned: boolean): Promise<AldoShareView> {
  const body = await api<unknown>(`/api/shares/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ pinned }),
  });
  const share = parseAldoShares([body])?.[0];
  if (!share || share.pinned === undefined) throw new Error("This Aldo can't pin shares yet.");
  return share;
}

/** The owner-only link to a port in a thread's sandbox (wakes it when opened). */
export function aldoPreviewUrl(environmentId: string, port: number): string {
  return `/p/${threadIdForEnvironment(environmentId)}/${port}`;
}

/**
 * Signed WebSocket URLs for the thread's live browser and desktop, and (a newer
 * Aldo) the link for stills of them (liveFrames.ts); AldoApiError 409 while asleep.
 */
export async function aldoBrowserConnection(
  environmentId: string,
): Promise<{ url: string; desktopUrl: string; stillUrl?: string }> {
  return api<{ url: string; desktopUrl: string; stillUrl?: string }>(
    `/api/environments/${threadIdForEnvironment(environmentId)}/browser`,
    { method: "POST" },
  );
}

/** One of the user's projects a draft's words point to, and why: a name it says, or words its threads use. */
export interface AldoRoutedProject {
  readonly name: string;
  readonly repos: ReadonlyArray<string>;
  /** Whether the words name it (else they match what its threads are about). */
  readonly named: boolean;
  readonly words: ReadonlyArray<string>;
}

/** Which of the user's projects `text` belongs to, if one clearly does (aldoRoutesDrafts). */
export async function routeAldoDraft(text: string): Promise<AldoRoutedProject | null> {
  const { project } = await api<{ project: AldoRoutedProject | null }>("/api/routing", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  return project;
}

/** One of the user's Aldo projects (`aldo:<slug>`), with the repositories of its code. */
export interface AldoProjectSummary {
  readonly ref: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  /** Its code: repositories on git hosts (left out before aldoLinksProjectCode). */
  readonly repos?: ReadonlyArray<string>;
}

/** The user's Aldo projects, most recently worked on first. */
export async function listAldoProjects(): Promise<ReadonlyArray<AldoProjectSummary>> {
  const { projects } = await api<{ projects: AldoProjectSummary[] }>("/api/projects");
  return projects;
}

/**
 * Makes `repos` a project's code, the whole list: one that was another
 * project's moves here (a repository is one project's at most).
 */
export async function setAldoProjectRepos(
  slug: string,
  repos: ReadonlyArray<string>,
): Promise<AldoProjectSummary> {
  const { project } = await api<{ project: AldoProjectSummary }>(
    `/api/projects/${encodeURIComponent(slug)}`,
    { method: "PATCH", body: JSON.stringify({ repos }) },
  );
  return project;
}

/** Repositories from every connected host (and Aldo's own projects, `aldo:<slug>`), and hosts that couldn't be listed. */
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
  readonly mergeChecks?: ReadonlyArray<{
    readonly name: string;
    readonly state: "pending" | "success" | "failure";
    readonly url: string | null;
  }> | null;
  readonly deploymentReported?: boolean | null;
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

/** Moves a thread to another computer size (an older Aldo, which sizes them by hand). A running one restarts, and its agent carries on. */
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

/** Ready-to-go environments (Settings → Code). */
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
