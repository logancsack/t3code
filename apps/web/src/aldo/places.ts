// The places a thread can work in (places.logic.ts), for the place picker,
// the draft's where-card and the composer's chip: the projects the user's
// machines work in, named and drawn as the sidebar does, most recently active
// first, then Aldo's own projects with no machine yet.

import type { SourceControlRepositorySummary } from "@t3tools/contracts";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { ProjectFaviconProject } from "../components/ProjectFavicon";
import { useClientSettings } from "../hooks/useSettings";
import { selectProjectGroupingSettings } from "../logicalProject";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { useProjects, useThreadShells } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import type { AldoPickedPlace } from "./AldoPlaceTile";
import {
  aldoSupportsProjects,
  getAldoEnvironments,
  listAldoRepositoryDirectory,
  subscribeAldoEnvironments,
  type AldoEnvironment,
} from "./cloud";
import { buildAldoPlaces, generalPlace, placeDetail, placeKey } from "./places.logic";

const NO_MACHINES: ReadonlyArray<AldoEnvironment> = [];

/** The directory's machines (none before its first listing). */
export function useAldoMachines(): ReadonlyArray<AldoEnvironment> {
  return (
    useSyncExternalStore(subscribeAldoEnvironments, getAldoEnvironments, () => null) ?? NO_MACHINES
  );
}

/** A machine's repositories, the main one first (none: General); null when the directory doesn't have it. */
export function aldoMachineRepos(
  machines: ReadonlyArray<AldoEnvironment>,
  environmentId: string | null | undefined,
): ReadonlyArray<string> | null {
  const machine = machines.find((entry) => entry.environmentId === environmentId);
  if (!machine) return null;
  return (machine.repos ?? [machine.repo]).filter((ref) => ref.length > 0);
}

const DIRECTORY_FRESH_MS = 60_000;
let directory: {
  readonly at: number;
  readonly repositories: Promise<ReadonlyArray<SourceControlRepositorySummary>>;
} | null = null;

/** The user's repositories and Aldo projects, fetched at most once a minute across pickers. */
export function loadAldoRepositories(): Promise<ReadonlyArray<SourceControlRepositorySummary>> {
  if (directory && Date.now() - directory.at < DIRECTORY_FRESH_MS) return directory.repositories;
  const repositories = listAldoRepositoryDirectory().then(
    (result) => result.repositories.filter((repo) => !repo.isArchived),
    (cause: unknown) => {
      directory = null;
      throw cause;
    },
  );
  directory = { at: Date.now(), repositories };
  return repositories;
}

/** Forgets the listing, so a project just created shows. */
export function forgetAldoRepositories(): void {
  directory = null;
}

/** The repository directory once `enabled` (a picker opened); null until it's in, [] if it can't be had. */
export function useAldoRepositories(
  enabled: boolean,
): ReadonlyArray<SourceControlRepositorySummary> | null {
  const [repositories, setRepositories] =
    useState<ReadonlyArray<SourceControlRepositorySummary> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadAldoRepositories()
      .catch(() => [])
      .then((found) => {
        if (live) setRepositories(found);
      });
    return () => {
      live = false;
    };
  }, [enabled]);
  return repositories;
}

/**
 * The user's projects as places (General isn't among them), with Aldo's own
 * from the repository directory once it's in (`withDirectory`).
 */
export function useAldoPlaces(withDirectory: boolean): {
  readonly places: ReadonlyArray<AldoPickedPlace>;
  readonly repositories: ReadonlyArray<SourceControlRepositorySummary> | null;
} {
  const machines = useAldoMachines();
  const projects = useProjects();
  const threads = useThreadShells();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const repositories = useAldoRepositories(withDirectory && aldoSupportsProjects());
  const places = useMemo(() => {
    const groups = buildSidebarProjectSnapshots({
      projects,
      settings: groupingSettings,
      primaryEnvironmentId,
      resolveEnvironmentLabel: () => null,
    });
    const activity = new Map<string, string>();
    for (const thread of threads) {
      if (thread.archivedAt !== null) continue;
      const known = activity.get(thread.environmentId);
      if (!known || thread.updatedAt > known) activity.set(thread.environmentId, thread.updatedAt);
    }
    return buildAldoPlaces<ProjectFaviconProject>({
      machines: machines.map((machine) => ({
        environmentId: machine.environmentId,
        repos: (machine.repos ?? [machine.repo]).filter((ref) => ref.length > 0),
      })),
      groups: groups.map((group) => ({
        name: group.displayName,
        project: group,
        environmentIds: group.memberProjectRefs.map((ref) => ref.environmentId),
      })),
      activity,
      aldoProjects: (repositories ?? [])
        .filter((repo) => repo.nameWithOwner.startsWith("aldo:"))
        .map((repo) => ({ ref: repo.nameWithOwner, name: repo.name })),
    });
  }, [groupingSettings, machines, primaryEnvironmentId, projects, repositories, threads]);
  return { places, repositories };
}

/**
 * Where a thread works: General, or its project as a place (named and drawn
 * as the sidebar does). Null while the directory doesn't have its machine.
 */
export function useAldoPlaceOf(
  environmentId: string | null | undefined,
  project: ProjectFaviconProject | null,
): AldoPickedPlace | null {
  const machines = useAldoMachines();
  const { places } = useAldoPlaces(false);
  const repos = aldoMachineRepos(machines, environmentId);
  // A new array each render: its key is what changes.
  const key = repos === null ? null : placeKey(repos);
  return useMemo(() => {
    if (key === null) return null;
    if (key === "") return generalPlace(project);
    const known = places.find((place) => placeKey(place.repos) === key);
    const refs = key.split(",");
    return (
      known ?? {
        repos: refs,
        name: project?.title ?? refs.join(" + "),
        detail: placeDetail(refs),
        activeAt: null,
        project,
      }
    );
  }, [key, places, project]);
}
