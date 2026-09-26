// Each thread runs on its own cloud machine (an Aldo sandbox), and T3 groups
// a repository's machines into one project, so the UI shows the project once
// with all of its threads. A new thread gets a new machine, except that one
// the project already has with no threads yet (a draft that was never sent)
// is used first.

import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";

import { toastManager } from "../components/ui/toast";
import { readEnvironmentThreadRefs, readProjects } from "../state/entities";
import {
  aldoProjectSandboxes,
  aldoSandboxesFor,
  createAldoEnvironment,
  getAldoEnvironments,
  isAldoCloud,
  isAldoEnvironmentId,
  type AldoEnvironment,
  type AldoNewProject,
} from "./cloud";

const PROJECT_WAIT_MS = 120_000;
const NUDGE_EVERY_MS = 10_000;

/** The environment catalog's retryNow: connects an environment now. */
export type AldoReconnect = (environmentId: EnvironmentId) => Promise<unknown>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadedProject(environmentId: string): ScopedProjectRef | null {
  const project = readProjects().find((candidate) => candidate.environmentId === environmentId);
  return project ? scopeProjectRef(project.environmentId, project.id) : null;
}

/**
 * Resolves once the machine's T3 server has connected and reported its
 * project. A machine that joins the directory mid-session doesn't connect by
 * itself, so `reconnect` nudges it once it's listed, and again every little
 * while until its project arrives.
 */
async function waitForAldoProject(
  environmentId: string,
  reconnect: AldoReconnect,
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
  throw new Error("The cloud agent didn't finish starting. Try again.");
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

/**
 * Starts a cloud agent (a machine) for a thread: in repositories, like
 * another thread's, or in a new repository. Uses an idle machine of the same
 * project when there is one; otherwise creates one and waits until it's
 * connected. Returns the machine's project.
 */
export async function startAldoSandbox(
  input: {
    readonly repo?: string;
    readonly fromEnvironmentId?: string;
    readonly branch?: string;
    readonly create?: AldoNewProject;
    readonly repos?: ReadonlyArray<string>;
  },
  label: string,
  reconnect: AldoReconnect,
): Promise<ScopedProjectRef> {
  const idle = input.create
    ? null
    : idleMachine(
        input.fromEnvironmentId
          ? aldoProjectSandboxes(input.fromEnvironmentId)
          : aldoSandboxesFor(input.repos ?? (input.repo ? [input.repo] : [])),
      );
  if (idle) return idle;

  const toastId = toastManager.add({
    type: "loading",
    title: input.create ? `Creating ${label}…` : "Creating a cloud agent…",
    description: input.create
      ? "Creating the repository and a cloud agent to work in it."
      : `Setting up ${label} in the cloud.`,
    timeout: 0,
  });
  try {
    const environment = await createAldoEnvironment(input);
    toastManager.update(toastId, {
      type: "loading",
      title: "Connecting to the cloud…",
      description: "Almost ready.",
      timeout: 0,
    });
    const projectRef = await waitForAldoProject(environment.environmentId, reconnect);
    toastManager.close(toastId);
    return projectRef;
  } catch (cause) {
    toastManager.update(toastId, {
      type: "error",
      title: input.create ? "Couldn't create the project" : "Couldn't create the cloud agent",
      description: cause instanceof Error ? cause.message : String(cause),
      timeout: 10_000,
    });
    throw cause;
  }
}

/**
 * Where a new thread in `projectRef` should live: outside Aldo, the project
 * itself; in Aldo, an idle machine of the project, or a new one.
 */
export async function aldoProjectRefForNewThread(
  projectRef: ScopedProjectRef,
  reconnect: AldoReconnect,
): Promise<ScopedProjectRef> {
  if (!isAldoCloud || !isAldoEnvironmentId(projectRef.environmentId)) return projectRef;
  const project = readProjects().find(
    (candidate) =>
      candidate.environmentId === projectRef.environmentId && candidate.id === projectRef.projectId,
  );
  return startAldoSandbox(
    { fromEnvironmentId: projectRef.environmentId },
    project?.title ?? "this project",
    reconnect,
  );
}
