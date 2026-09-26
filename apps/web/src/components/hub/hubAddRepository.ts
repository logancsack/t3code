/**
 * Adding a project to a hub: a hub has no folders, so a project is either a
 * repository (recorded by its remote, cloned onto each thread's machine) or a
 * blank project (each machine starts from an empty repository).
 */
import type {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  RepositoryIdentity,
  ScopedProjectRef,
} from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  detectSourceControlProviderFromGitRemoteUrl,
  normalizeGitRemoteUrl,
} from "@t3tools/shared/git";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useClientSettings } from "../../hooks/useSettings";
import { hubProjectWorkspaceRoot } from "../../hubMode";
import { getLatestThreadForProject } from "../../lib/threadSort";
import { newProjectId } from "../../lib/utils";
import { readProjects, readThreadShells } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { normalizeGitRemoteIdentity } from "../GitHubRepositoryBrowser.logic";
import { stackedThreadToast, toastManager } from "../ui/toast";

/**
 * The identity a hub records for a repository project, shaped like the one a
 * server reads from `git remote` so grouping and pull requests match.
 */
export function buildHubRepositoryIdentity(remoteUrl: string): RepositoryIdentity {
  const trimmedUrl = remoteUrl.trim();
  const canonicalKey = normalizeGitRemoteUrl(trimmedUrl);
  const repositoryPath = canonicalKey.split("/").slice(1).join("/");
  const segments = repositoryPath.split("/").filter((segment) => segment.length > 0);
  const provider = detectSourceControlProviderFromGitRemoteUrl(trimmedUrl);
  const owner = segments[0];
  const name = segments.at(-1);
  return {
    canonicalKey,
    locator: { source: "git-remote", remoteName: "origin", remoteUrl: trimmedUrl },
    ...(repositoryPath ? { displayName: repositoryPath } : {}),
    ...(provider ? { provider: provider.kind } : {}),
    ...(owner && segments.length > 1 ? { owner } : {}),
    ...(name ? { name } : {}),
  };
}

interface HubRepositoryProjectCandidate {
  readonly repositoryIdentity?:
    | {
        readonly canonicalKey: string;
        readonly locator: { readonly remoteUrl: string };
      }
    | null
    | undefined;
}

/** The project already recording this remote, compared the way the repository browser does. */
export function findHubProjectForRemoteUrl<T extends HubRepositoryProjectCandidate>(
  remoteUrl: string,
  projects: ReadonlyArray<T>,
): T | null {
  const expectedKey = normalizeGitRemoteIdentity(remoteUrl);
  return (
    projects.find((project) => {
      const identity = project.repositoryIdentity;
      if (!identity) return false;
      return (
        identity.canonicalKey.toLowerCase() === expectedKey ||
        normalizeGitRemoteIdentity(identity.locator.remoteUrl) === expectedKey
      );
    }) ?? null
  );
}

export function hubRepositoryProjectTitle(identity: RepositoryIdentity): string {
  return identity.name ?? identity.displayName ?? identity.canonicalKey;
}

/** `project.create` input for a hub repository project. */
export function buildHubRepositoryProjectInput(input: {
  readonly projectId: ProjectId;
  readonly remoteUrl: string;
  readonly title?: string | undefined;
  readonly defaultModelSelection: ModelSelection | null;
}) {
  const repositoryIdentity = buildHubRepositoryIdentity(input.remoteUrl);
  return {
    projectId: input.projectId,
    title: input.title?.trim() || hubRepositoryProjectTitle(repositoryIdentity),
    workspaceRoot: hubProjectWorkspaceRoot(input.projectId),
    createWorkspaceRootIfMissing: false,
    defaultModelSelection: input.defaultModelSelection,
    repositoryIdentity,
  };
}

/** `project.create` input for a hub blank project. */
export function buildHubBlankProjectInput(input: {
  readonly projectId: ProjectId;
  readonly title: string;
  readonly defaultModelSelection: ModelSelection | null;
}) {
  return {
    projectId: input.projectId,
    title: input.title.trim() || "Untitled project",
    workspaceRoot: hubProjectWorkspaceRoot(input.projectId),
    createWorkspaceRootIfMissing: false,
    defaultModelSelection: input.defaultModelSelection,
    repositoryIdentity: null,
  };
}

function failureToast(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

/**
 * Adds repositories and blank projects to a hub, then lands in the project:
 * its latest thread when it already existed, otherwise a new thread.
 * Resolves true once the user is in the project.
 */
export function useHubAddRepository() {
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const handleNewThread = useNewThreadHandler();
  const navigate = useNavigate();
  const sortOrder = useClientSettings((settings) => settings.sidebarThreadSortOrder);

  const openProject = useCallback(
    async (projectRef: ScopedProjectRef): Promise<boolean> => {
      const latestThread = getLatestThreadForProject(
        readThreadShells().filter((thread) => thread.environmentId === projectRef.environmentId),
        projectRef.projectId,
        sortOrder,
      );
      if (latestThread) {
        await navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(
            scopeThreadRef(latestThread.environmentId, latestThread.id),
          ),
        });
        return true;
      }
      const result = await settlePromise(() => handleNewThread(projectRef));
      if (result._tag === "Failure") {
        failureToast("Failed to open project", squashAtomCommandFailure(result));
        return false;
      }
      return true;
    },
    [handleNewThread, navigate, sortOrder],
  );

  const createAndOpen = useCallback(
    async (
      environmentId: EnvironmentId,
      input: ReturnType<typeof buildHubBlankProjectInput | typeof buildHubRepositoryProjectInput>,
    ): Promise<boolean> => {
      const result = await createProject({ environmentId, input });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          failureToast("Failed to add project", squashAtomCommandFailure(result));
        }
        return false;
      }
      return openProject(scopeProjectRef(environmentId, input.projectId));
    },
    [createProject, openProject],
  );

  const addRepository = useCallback(
    async (input: {
      readonly environmentId: EnvironmentId;
      readonly remoteUrl: string;
      readonly title?: string | undefined;
      readonly defaultModelSelection: ModelSelection | null;
    }): Promise<boolean> => {
      const existing = findHubProjectForRemoteUrl(
        input.remoteUrl,
        readProjects().filter((project) => project.environmentId === input.environmentId),
      );
      if (existing) {
        return openProject(scopeProjectRef(existing.environmentId, existing.id));
      }
      return createAndOpen(
        input.environmentId,
        buildHubRepositoryProjectInput({
          projectId: newProjectId(),
          remoteUrl: input.remoteUrl,
          title: input.title,
          defaultModelSelection: input.defaultModelSelection,
        }),
      );
    },
    [createAndOpen, openProject],
  );

  const addBlankProject = useCallback(
    (input: {
      readonly environmentId: EnvironmentId;
      readonly title: string;
      readonly defaultModelSelection: ModelSelection | null;
    }): Promise<boolean> =>
      createAndOpen(
        input.environmentId,
        buildHubBlankProjectInput({
          projectId: newProjectId(),
          title: input.title,
          defaultModelSelection: input.defaultModelSelection,
        }),
      ),
    [createAndOpen],
  );

  return { addRepository, addBlankProject };
}
