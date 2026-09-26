// Each thread runs on its own cloud machine (an Aldo sandbox), and T3 groups
// a repository's machines into one project, so the UI shows the project once
// with all of its threads.
//
// A new thread opens at once: Aldo records its machine without creating it,
// and the client registers the machine with its project and models already
// in T3's cache, so the thread is ready to type in before anything runs. The
// machine is created when the first message is sent (see dispatch.ts). A
// project's machine with no threads yet (a draft that was never sent) is used
// before recording another.

import {
  normalizeGitRemoteUrl,
  detectSourceControlProviderFromGitRemoteUrl,
} from "@t3tools/shared/git";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";

import { toastManager } from "../components/ui/toast";
import { seedEnvironmentCache } from "../connection/storage";
import { readEnvironmentThreadRefs, readProjects } from "../state/entities";
import {
  aldoEnvironmentIdFor,
  aldoProjectSandboxes,
  aldoSandboxesFor,
  createAldoEnvironment,
  holdAldoEnvironment,
  isAldoCloud,
  isAldoEnvironmentId,
  newAldoThreadId,
  releaseAldoEnvironment,
  type AldoEnvironment,
  type AldoNewProject,
  type AldoPlannedProject,
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

/** One of these machines with no threads yet whose project is loaded. */
function idleMachine(sandboxes: ReadonlyArray<AldoEnvironment>): ScopedProjectRef | null {
  for (const sandbox of sandboxes) {
    if (readEnvironmentThreadRefs(sandbox.environmentId as EnvironmentId).length > 0) continue;
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
    locator: { source: "git-remote", remoteName: "origin", remoteUrl: project.remoteUrl },
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
 * repositories, like another thread's, or in a new repository. Uses an idle
 * machine of the same project when there is one; otherwise records a new
 * one and registers it with its project and models. Returns its project.
 */
export async function startAldoSandbox(input: {
  readonly repo?: string;
  readonly fromEnvironmentId?: string;
  readonly branch?: string;
  readonly create?: AldoNewProject;
  readonly repos?: ReadonlyArray<string>;
}): Promise<ScopedProjectRef> {
  const idle = input.create
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
  holdAldoEnvironment(environmentId);
  // The models come from Aldo's copy; fetch it while the record is made.
  const serverConfig = aldoServerConfigFor(environmentId).catch(() => null);
  try {
    const { environment, project } = await createAldoEnvironment({
      ...input,
      id: threadId,
      projectId: crypto.randomUUID(),
      start: false,
    });
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
  return waitForAldoProject(environmentId);
}

/**
 * Where a new thread in `projectRef` should live: outside Aldo, the project
 * itself; in Aldo, an idle machine of the project, or a new one.
 */
export async function aldoProjectRefForNewThread(
  projectRef: ScopedProjectRef,
): Promise<ScopedProjectRef> {
  if (!isAldoCloud || !isAldoEnvironmentId(projectRef.environmentId)) return projectRef;
  return startAldoSandbox({ fromEnvironmentId: projectRef.environmentId });
}
