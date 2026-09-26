// Per-thread sandboxes: every new thread gets a fresh sandbox, except that a
// sandbox with no threads yet (just created, or an abandoned draft's) is reused.

import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ScopedProjectRef } from "@t3tools/contracts";

import { toastManager } from "../components/ui/toast";
import { readEnvironmentThreadRefs, readProjects } from "../state/entities";
import {
  createAldoEnvironment,
  isAldoCloud,
  isAldoEnvironmentId,
  type AldoNewProject,
} from "./cloud";

const PROJECT_WAIT_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves once the sandbox's T3 server has connected and reported its project. */
export async function waitForAldoProject(environmentId: string): Promise<ScopedProjectRef> {
  const deadline = Date.now() + PROJECT_WAIT_MS;
  while (Date.now() < deadline) {
    const project = readProjects().find((candidate) => candidate.environmentId === environmentId);
    if (project) return scopeProjectRef(project.environmentId, project.id);
    await sleep(400);
  }
  throw new Error("The new sandbox didn't finish starting. Try again.");
}

/** Creates a sandbox (for a repository, or like another thread's) and returns its project. */
export async function startAldoSandbox(
  input: {
    readonly repo?: string;
    readonly fromEnvironmentId?: string;
    readonly branch?: string;
    readonly create?: AldoNewProject;
  },
  label: string,
): Promise<ScopedProjectRef> {
  const toastId = toastManager.add({
    type: "loading",
    title: input.create ? `Creating ${label}…` : `Starting a sandbox for ${label}…`,
    description: input.create
      ? "Creating the GitHub repository and starting its sandbox."
      : "Cloning the repository and starting the agent tools.",
    timeout: 0,
  });
  try {
    const environment = await createAldoEnvironment(input);
    toastManager.update(toastId, {
      type: "loading",
      title: `Connecting to ${label}…`,
      description: "Almost ready.",
      timeout: 0,
    });
    const projectRef = await waitForAldoProject(environment.environmentId);
    toastManager.close(toastId);
    return projectRef;
  } catch (cause) {
    toastManager.update(toastId, {
      type: "error",
      title: input.create ? "Couldn't create the project" : "Couldn't start the sandbox",
      description: cause instanceof Error ? cause.message : String(cause),
      timeout: 10_000,
    });
    throw cause;
  }
}

/**
 * Where a new thread in `projectRef` should live. Outside Aldo, or when the
 * project's sandbox has no threads yet, that's the project itself; otherwise a
 * new sandbox for the same repository.
 */
export async function aldoProjectRefForNewThread(
  projectRef: ScopedProjectRef,
): Promise<ScopedProjectRef> {
  if (!isAldoCloud || !isAldoEnvironmentId(projectRef.environmentId)) return projectRef;
  if (readEnvironmentThreadRefs(projectRef.environmentId).length === 0) return projectRef;
  const project = readProjects().find(
    (candidate) =>
      candidate.environmentId === projectRef.environmentId && candidate.id === projectRef.projectId,
  );
  return startAldoSandbox(
    { fromEnvironmentId: projectRef.environmentId },
    project?.title ?? "this repository",
  );
}
