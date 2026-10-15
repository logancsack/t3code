// An Aldo project's code (aldoLinksProjectCode): the repositories on git
// hosts that are its own, each one project's at most. Threads in the code
// know the project, and the project's threads its code, without either
// carrying the other's files.

import type { AldoProjectSummary } from "./cloud";

/** Whether a ref is one of the user's Aldo projects rather than code on a git host. */
export function isAldoProjectRef(ref: string): boolean {
  return ref.startsWith("aldo:");
}

/** The Aldo project whose code `ref` is, if any. */
export function projectOfCode(
  projects: ReadonlyArray<AldoProjectSummary>,
  ref: string,
): AldoProjectSummary | null {
  return projects.find((project) => project.repos?.includes(ref)) ?? null;
}

/** A project's code with `ref` too (once). */
export function withCode(project: AldoProjectSummary, ref: string): ReadonlyArray<string> {
  const repos = project.repos ?? [];
  return repos.includes(ref) ? repos : [...repos, ref];
}

/** A project's code without `ref`. */
export function withoutCode(project: AldoProjectSummary, ref: string): ReadonlyArray<string> {
  return (project.repos ?? []).filter((candidate) => candidate !== ref);
}

/**
 * The repositories a project could take as its code: code on a git host
 * (not archived, not an Aldo project), not its own yet, with the one another
 * project has named, since linking it moves it.
 */
export function codeChoices(
  repositories: ReadonlyArray<{ readonly nameWithOwner: string; readonly isArchived?: boolean }>,
  project: AldoProjectSummary,
  projects: ReadonlyArray<AldoProjectSummary>,
): ReadonlyArray<{ readonly ref: string; readonly partOf: string | null }> {
  const own = new Set(project.repos ?? []);
  return repositories
    .filter((repo) => !repo.isArchived && !isAldoProjectRef(repo.nameWithOwner))
    .filter((repo) => !own.has(repo.nameWithOwner))
    .map((repo) => ({
      ref: repo.nameWithOwner,
      partOf: projectOfCode(projects, repo.nameWithOwner)?.title ?? null,
    }));
}
