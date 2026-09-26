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
  getAldoEnvironments,
  isAldoCloud,
  isAldoEnvironmentId,
  type AldoNewProject,
} from "./cloud";

const PROJECT_WAIT_MS = 120_000;
const NUDGE_EVERY_MS = 10_000;

type Reconnect = (environmentId: EnvironmentId) => Promise<unknown>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadedProject(environmentId: string): ScopedProjectRef | null {
  const project = readProjects().find((candidate) => candidate.environmentId === environmentId);
  return project ? scopeProjectRef(project.environmentId, project.id) : null;
}

/**
 * Resolves once the sandbox's T3 server has connected and reported its
 * project. A sandbox that joins the directory mid-session (or wakes from
 * sleep) doesn't connect by itself, so `reconnect` nudges it once it's listed,
 * and again every little while until its project arrives.
 */
async function waitForAldoProject(
  environmentId: string,
  reconnect: Reconnect,
): Promise<ScopedProjectRef> {
  const deadline = Date.now() + PROJECT_WAIT_MS;
  let nextNudge: number | null = null;
  while (Date.now() < deadline) {
    const project = loadedProject(environmentId);
    if (project) return project;
    if (getAldoEnvironments()?.some((e) => e.environmentId === environmentId)) {
      // Give the new registration a moment to install before the first nudge.
      nextNudge ??= Date.now() + 1000;
      if (Date.now() >= nextNudge) {
        nextNudge = Date.now() + NUDGE_EVERY_MS;
        void reconnect(environmentId as EnvironmentId).catch(() => undefined);
      }
    }
    await sleep(400);
  }
  throw new Error("The project's sandbox didn't finish starting. Try again.");
}

/**
 * Opens a project's sandbox (for repositories, or a new repository), creating
 * it the first time, and returns its project. `reconnect` (the environment
 * catalog's retryNow) connects the sandbox once Aldo has it running.
 */
export async function startAldoSandbox(
  input: {
    readonly repo?: string;
    readonly branch?: string;
    readonly create?: AldoNewProject;
    readonly repos?: ReadonlyArray<string>;
  },
  label: string,
  reconnect: Reconnect,
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
    // A project the client already has (one it opened before) is ready now;
    // if Aldo just woke its sandbox, connect to it.
    let projectRef = loadedProject(environment.environmentId);
    if (projectRef) {
      if (!environment.created) {
        void reconnect(environment.environmentId as EnvironmentId).catch(() => undefined);
      }
    } else {
      toastManager.update(toastId, {
        type: "loading",
        title: `Connecting to ${label}…`,
        description: "Almost ready.",
        timeout: 0,
      });
      projectRef = await waitForAldoProject(environment.environmentId, reconnect);
    }
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
