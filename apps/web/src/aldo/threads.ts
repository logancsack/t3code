// Each thread runs on its own cloud machine (an Aldo sandbox), and T3 groups
// a repository's machines into one project, so the UI shows the project once
// with all of its threads.
//
// A new thread opens at once: Aldo records its machine without creating it,
// and the client registers the machine with its project and models already
// in T3's cache, so the thread is ready to type in before anything runs. The
// machine is created when the first message is sent (see dispatch.ts). A
// project's machine with no threads yet (a draft that was never sent) is used
// before recording another, unless it's on a branch it was asked for (a pull
// request's): that one is for the draft it was recorded for.

import {
  normalizeGitRemoteUrl,
  detectSourceControlProviderFromGitRemoteUrl,
} from "@t3tools/shared/git";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";

import { toastManager } from "../components/ui/toast";
import {
  composerDraftHasUserContent,
  type DraftId,
  useComposerDraftStore,
} from "../composerDraftStore";
import { randomUUID } from "../lib/utils";
import { clearEnvironmentCache, seedEnvironmentCache } from "../connection/storage";
import { readEnvironmentThreadRefs, readProjects } from "../state/entities";
import {
  aldoEnvironmentIdFor,
  aldoMachineOnAskedBranch,
  aldoProjectSandboxes,
  aldoSandboxesFor,
  createAldoEnvironment,
  deleteAldoEnvironment,
  deleteAldoMachineWithThread,
  holdAldoEnvironment,
  isAldoCloud,
  isAldoEnvironmentId,
  newAldoThreadId,
  releaseAldoEnvironment,
  type AldoEnvironment,
  type AldoNewProject,
  type AldoPlannedProject,
  type AldoPullRequestBranch,
} from "./cloud";
import { ensureAldoConnected } from "./dispatch";
import { aldoServerConfigFor } from "./serverConfig";

const PROJECT_WAIT_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadedProject(environmentId: string): ScopedProjectRef | null {
  const project = readProjects().find((candidate) => candidate.environmentId === environmentId);
  return project ? scopeProjectRef(project.environmentId, project.id) : null;
}

/** Resolves once the machine's project is in the client (from its seeded cache). */
async function waitForAldoProject(environmentId: string): Promise<ScopedProjectRef> {
  const deadline = Date.now() + PROJECT_WAIT_MS;
  while (Date.now() < deadline) {
    const project = loadedProject(environmentId);
    if (project) return project;
    await sleep(100);
  }
  throw new Error("The thread didn't open. Try again.");
}

/** Whether a draft not sent yet is on a machine; `invested`: one with something in it. */
function hasDraft(environmentId: string, invested: boolean): boolean {
  const { draftThreadsByThreadKey, getComposerDraft } = useComposerDraftStore.getState();
  return Object.entries(draftThreadsByThreadKey).some(
    ([draftId, draft]) =>
      draft.environmentId === environmentId &&
      draft.promotedTo == null &&
      (!invested || composerDraftHasUserContent(getComposerDraft(draftId as DraftId))),
  );
}

/**
 * Whether a machine has no thread yet, nor a draft with something in it (a
 * task a pull request's Fix wrote there, say): that draft's thread is to be
 * the machine's one. An empty draft T3 reuses for the next new thread.
 */
function isIdle(environmentId: string): boolean {
  return (
    readEnvironmentThreadRefs(environmentId as EnvironmentId).length === 0 &&
    !hasDraft(environmentId, true)
  );
}

/** One of these machines that's idle (isIdle), on its own branch, and whose project is loaded. */
function idleMachine(sandboxes: ReadonlyArray<AldoEnvironment>): ScopedProjectRef | null {
  for (const sandbox of sandboxes) {
    if (!isIdle(sandbox.environmentId) || aldoMachineOnAskedBranch(sandbox.environmentId)) {
      continue;
    }
    const project = loadedProject(sandbox.environmentId);
    if (project) return project;
  }
  return null;
}

/** The repository identity T3 derives from `git remote -v` (it groups a repository's machines by it). */
function repositoryIdentity(project: AldoPlannedProject) {
  const canonicalKey = normalizeGitRemoteUrl(project.remoteUrl);
  const repositoryPath = canonicalKey.split("/").slice(1).join("/");
  const segments = repositoryPath.split("/").filter((segment) => segment.length > 0);
  const provider = detectSourceControlProviderFromGitRemoteUrl(project.remoteUrl);
  return {
    canonicalKey,
    locator: {
      source: "git-remote",
      remoteName: project.remoteName ?? "origin",
      remoteUrl: project.remoteUrl,
    },
    rootPath: project.workspaceRoot,
    ...(repositoryPath ? { displayName: repositoryPath } : {}),
    ...(provider ? { provider: provider.kind } : {}),
    ...(segments[0] ? { owner: segments[0] } : {}),
    ...(segments.at(-1) ? { name: segments.at(-1) } : {}),
  };
}

/** The T3 shell the machine will report, with just its project. */
function plannedShell(project: AldoPlannedProject) {
  const now = new Date().toISOString();
  return {
    snapshotSequence: 0,
    projects: [
      {
        id: project.id,
        title: project.title,
        workspaceRoot: project.workspaceRoot,
        repositoryIdentity: repositoryIdentity(project),
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    threads: [],
    updatedAt: now,
  };
}

/**
 * Opens a new thread's cloud agent (a machine) without starting it: in
 * repositories, like another thread's, in a new repository, or in none
 * (`repos: []`: a General thread, for work that isn't code). Uses an idle
 * machine of the same project when there is one, unless it's asked for on a
 * branch (an idle one is on its own); otherwise records a new one and
 * registers it with its project and models. Returns its project.
 */
export async function startAldoSandbox(input: {
  readonly repo?: string;
  readonly fromEnvironmentId?: string;
  readonly branch?: string;
  readonly pullRequest?: AldoPullRequestBranch;
  readonly create?: AldoNewProject;
  readonly repos?: ReadonlyArray<string>;
}): Promise<ScopedProjectRef> {
  const idle =
    input.create || input.branch || input.pullRequest
      ? null
      : idleMachine(
          input.fromEnvironmentId
            ? aldoProjectSandboxes(input.fromEnvironmentId)
            : aldoSandboxesFor(input.repos ?? (input.repo ? [input.repo] : [])),
        );
  if (idle) return idle;

  const threadId = newAldoThreadId();
  const environmentId = aldoEnvironmentIdFor(threadId);
  let hasModels = false;
  let created: AldoEnvironment | undefined;
  /** Recorded in Aldo: deleted again if the client can't finish setting it up. */
  let recorded = false;
  holdAldoEnvironment(environmentId);
  // The models come from Aldo's copy; fetch it while the record is made.
  const serverConfig = aldoServerConfigFor(environmentId).catch(() => null);
  try {
    const { environment, project } = await createAldoEnvironment({
      ...input,
      id: threadId,
      projectId: randomUUID(),
      start: false,
    });
    recorded = true;
    if (!project) throw new Error("Aldo didn't name the thread's project.");
    const config = await serverConfig;
    hasModels = config !== null;
    await seedEnvironmentCache({
      environmentId: environmentId as EnvironmentId,
      shell: plannedShell(project),
      serverConfig: config && {
        ...config,
        environment: { ...config.environment, label: environment.label },
      },
    });
    created = environment;
  } catch (cause) {
    // Otherwise the next directory refresh shows a thread with no project, and a retry makes another.
    if (recorded) void deleteAldoEnvironment(environmentId).catch(() => undefined);
    toastManager.add({
      type: "error",
      title: input.create ? "Couldn't create the project" : "Couldn't start the thread",
      description: cause instanceof Error ? cause.message : String(cause),
      timeout: 10_000,
    });
    throw cause;
  } finally {
    releaseAldoEnvironment(environmentId, created);
  }
  // Before any cloud agent has reported its models there are none to show,
  // so start this one right away (preloading may already); its models appear when it's up.
  if (!hasModels) void ensureAldoConnected(environmentId).catch(() => undefined);
  // Shown like the failures above, so a caller never shows one again.
  return waitForAldoProject(environmentId).catch((cause: unknown) => {
    toastManager.add({
      type: "error",
      title: input.create ? "Couldn't create the project" : "Couldn't start the thread",
      description: cause instanceof Error ? cause.message : String(cause),
      timeout: 10_000,
    });
    throw cause;
  });
}

/**
 * Where a new thread in `projectRef` should live: outside Aldo, the project
 * itself; in Aldo, that machine while it's idle (one just recorded for it,
 * which may be on a branch it was asked for: then only until its first draft
 * opens), else an idle machine of the project, or a new one.
 */
export async function aldoProjectRefForNewThread(
  projectRef: ScopedProjectRef,
): Promise<ScopedProjectRef> {
  const { environmentId } = projectRef;
  if (!isAldoCloud || !isAldoEnvironmentId(environmentId)) return projectRef;
  if (
    isIdle(environmentId) &&
    !(aldoMachineOnAskedBranch(environmentId) && hasDraft(environmentId, false))
  ) {
    const own = loadedProject(environmentId);
    if (own) return own;
  }
  return startAldoSandbox({ fromEnvironmentId: environmentId });
}

/** Deletes a machine just recorded for a thread that didn't open after all. */
export async function discardAldoSandbox(environmentId: string): Promise<void> {
  await deleteAldoEnvironment(environmentId);
  await clearEnvironmentCache(environmentId as EnvironmentId).catch(() => undefined);
}

/**
 * Deletes a thread that's alone on its machine by deleting the machine,
 * without waking it: the thread leaves the sidebar at once, and comes back if
 * Aldo can't delete it.
 */
export async function deleteAldoThreadWithMachine(environmentId: string): Promise<void> {
  await deleteAldoMachineWithThread(environmentId);
  await clearEnvironmentCache(environmentId as EnvironmentId).catch(() => undefined);
}
