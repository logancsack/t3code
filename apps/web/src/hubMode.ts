/**
 * Hub mode: the environment serves T3 without a machine of its own, and every
 * thread runs on its own on-demand machine (docs/internals/thread-machines.md).
 *
 * Always decided per environment and at render time: a client can be
 * connected to a hub and to ordinary servers at once, and which environment
 * is primary changes at runtime. Before a managed primary's server config
 * arrives, the managed bootstrap (or the cached environment descriptor)
 * answers, so a hub never flashes the local-checkout UI while connecting.
 */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ExecutionEnvironmentCapabilities } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { isManagedDevPc, isManagedHubBootstrap } from "./managedDevPc";
import { readManagedPrimaryEnvironmentDescriptor } from "./managedPrimaryEnvironment";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "./state/primaryEnvironment";
import { environmentServerConfigsAtom } from "./state/server";

interface HubCapabilitySource {
  readonly environment: { readonly capabilities: ExecutionEnvironmentCapabilities };
}

/** Whether a loaded server config advertises thread machines. */
export function isHubServerConfig(config: HubCapabilitySource | null | undefined): boolean {
  return config?.environment.capabilities.threadMachines === true;
}

/** What a managed deployment says about its primary before the server config arrives. */
export function readManagedPrimaryIsHub(): boolean {
  if (!isManagedDevPc) return false;
  return (
    isManagedHubBootstrap() ||
    readManagedPrimaryEnvironmentDescriptor()?.capabilities.threadMachines === true
  );
}

/**
 * The loaded config always wins; only a managed primary without one yet falls
 * back to the bootstrap, so standalone and remote environments never guess.
 */
export function resolveIsHubEnvironment(input: {
  readonly config: HubCapabilitySource | null | undefined;
  readonly isPrimary: boolean;
  readonly managedPrimaryIsHub: () => boolean;
}): boolean {
  if (input.config) return isHubServerConfig(input.config);
  return input.isPrimary && input.managedPrimaryIsHub();
}

const environmentIsHubAtom = Atom.family((environmentId: string) =>
  Atom.make((get) =>
    resolveIsHubEnvironment({
      config: get(environmentServerConfigsAtom).get(environmentId as EnvironmentId),
      isPrimary: get(primaryEnvironmentIdAtom) === environmentId,
      managedPrimaryIsHub: readManagedPrimaryIsHub,
    }),
  ).pipe(Atom.withLabel(`web-environment-is-hub:${environmentId}`)),
);

const NOT_HUB_ATOM = Atom.make(false).pipe(Atom.withLabel("web-environment-is-hub:none"));

const primaryIsHubAtom = Atom.make((get) => {
  const primaryEnvironmentId = get(primaryEnvironmentIdAtom);
  return primaryEnvironmentId === null
    ? readManagedPrimaryIsHub()
    : get(environmentIsHubAtom(primaryEnvironmentId));
}).pipe(Atom.withLabel("web-primary-is-hub"));

export function useIsHubEnvironment(environmentId: EnvironmentId | null | undefined): boolean {
  return useAtomValue(environmentId ? environmentIsHubAtom(environmentId) : NOT_HUB_ATOM);
}

/** Primary-scoped surfaces: settings, the workspace status, add-project defaults. */
export function usePrimaryIsHub(): boolean {
  return useAtomValue(primaryIsHubAtom);
}

/** Non-React callers (command handlers) read the same answer from the app registry. */
export function readIsHubEnvironment(environmentId: EnvironmentId | null | undefined): boolean {
  return environmentId ? appAtomRegistry.get(environmentIsHubAtom(environmentId)) : false;
}

/**
 * Hub projects have no folder: the server gives them this virtual root and
 * nothing reads it. See `projectVirtualRoot` in the runner contracts.
 */
export function hubProjectWorkspaceRoot(projectId: string): string {
  return `/workspace/p/${encodeURIComponent(projectId)}`;
}

/**
 * Base ref a hub thread starts from when the user picked none: the runner
 * resolves it to the repository's default branch.
 */
export const HUB_DEFAULT_BASE_REF = "HEAD";

/**
 * New-thread options as a hub understands them: every thread gets its own
 * checkout on its own machine, so a carried-over branch becomes the base of
 * a fresh checkout and a worktree path never carries over.
 */
export function hubNewThreadOptions<
  T extends {
    readonly worktreePath?: string | null;
    readonly envMode?: "local" | "worktree";
    readonly startFromOrigin?: boolean;
  },
>(options: T | undefined): T | undefined {
  if (!options) return options;
  return {
    ...options,
    ...(options.worktreePath !== undefined ? { worktreePath: null } : {}),
    ...(options.envMode !== undefined ? { envMode: "worktree" as const } : {}),
    ...(options.startFromOrigin !== undefined ? { startFromOrigin: false } : {}),
  };
}

/** Where a hub project comes from, in place of its virtual root. */
export function hubProjectLocationLabel(project: {
  readonly repositoryIdentity?:
    | { readonly locator: { readonly remoteUrl: string } }
    | null
    | undefined;
}): string {
  return project.repositoryIdentity?.locator.remoteUrl ?? "Blank project";
}

/** Short form for lists: `owner/repo` when recorded. */
export function hubProjectDisplayLabel(project: {
  readonly repositoryIdentity?:
    | { readonly displayName?: string; readonly locator: { readonly remoteUrl: string } }
    | null
    | undefined;
}): string {
  return project.repositoryIdentity?.displayName ?? hubProjectLocationLabel(project);
}
