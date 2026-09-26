// One sandbox per project: a project's threads all run in its sandbox, so a
// new thread opens straight into it instead of cloning the repository again.
// Projects from before sandboxes were shared can have several; new threads go
// to the newest.

import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";

import { toastManager } from "../components/ui/toast";
import { readProjects } from "../state/entities";
import {
  aldoProjectSandboxes,
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
  throw new Error("The project's sandbox didn't finish starting. Try again.");
}

/**
 * Opens a project's sandbox (for repositories, or a new repository), creating
 * it the first time, and returns its project. A sandbox that already existed
 * may have been asleep, with its connection held as dormant: `reconnect`
 * connects it now that Aldo has woken it.
 */
export async function startAldoSandbox(
  input: {
    readonly repo?: string;
    readonly branch?: string;
    readonly create?: AldoNewProject;
    readonly repos?: ReadonlyArray<string>;
  },
  label: string,
  reconnect?: (environmentId: EnvironmentId) => Promise<unknown>,
): Promise<ScopedProjectRef> {
  const toastId = toastManager.add({
    type: "loading",
    title: input.create ? `Creating ${label}…` : `Opening ${label}…`,
    description: input.create
      ? "Creating the repository and starting its sandbox."
      : "Starting its sandbox. The first time, this clones the repository.",
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
    if (!environment.created && reconnect) {
      await reconnect(environment.environmentId as EnvironmentId).catch(() => undefined);
    }
    const projectRef = await waitForAldoProject(environment.environmentId);
    toastManager.close(toastId);
    return projectRef;
  } catch (cause) {
    toastManager.update(toastId, {
      type: "error",
      title: input.create ? "Couldn't create the project" : `Couldn't open ${label}`,
      description: cause instanceof Error ? cause.message : String(cause),
      timeout: 10_000,
    });
    throw cause;
  }
}

/**
 * Where a new thread in `projectRef` should live: in the project's newest
 * sandbox the client has loaded (viewing the draft wakes it if it's asleep).
 */
export function aldoProjectRefForNewThread(projectRef: ScopedProjectRef): ScopedProjectRef {
  if (!isAldoCloud || !isAldoEnvironmentId(projectRef.environmentId)) return projectRef;
  const projects = readProjects();
  for (const sandbox of aldoProjectSandboxes(projectRef.environmentId)) {
    if (sandbox.environmentId === projectRef.environmentId) return projectRef;
    const project = projects.find((candidate) => candidate.environmentId === sandbox.environmentId);
    if (project) return scopeProjectRef(project.environmentId, project.id);
  }
  return projectRef;
}
