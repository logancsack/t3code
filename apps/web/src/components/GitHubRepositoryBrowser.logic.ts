import type { SourceControlRepositorySummary } from "@t3tools/contracts";

export interface RepositoryBrowserProject {
  readonly workspaceRoot: string;
  readonly repositoryIdentity?:
    | {
        readonly canonicalKey: string;
        readonly locator: { readonly remoteUrl: string };
        readonly provider?: string;
        readonly owner?: string;
        readonly name?: string;
      }
    | null
    | undefined;
}

export function normalizeGitRemoteIdentity(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const scpMatch = /^[^@]+@([^:]+):(.+)$/u.exec(trimmed);
  if (scpMatch?.[1] && scpMatch[2]) {
    return `${scpMatch[1]}/${scpMatch[2]}`
      .replace(/[?#].*$/u, "")
      .replace(/\.git$/u, "")
      .replace(/\/+$/u, "");
  }

  try {
    const parsed = new URL(trimmed);
    return `${parsed.host}${parsed.pathname}`.replace(/\.git$/u, "").replace(/\/+$/u, "");
  } catch {
    return trimmed
      .replace(/^[^/]+:\/\//u, "")
      .replace(/[?#].*$/u, "")
      .replace(/\.git$/u, "")
      .replace(/\/+$/u, "");
  }
}

export function findProjectForGitHubRepository<T extends RepositoryBrowserProject>(
  repository: SourceControlRepositorySummary,
  projects: ReadonlyArray<T>,
): T | null {
  const expectedKey = `github.com/${repository.nameWithOwner}`.toLowerCase();
  return (
    projects.find((project) => {
      const identity = project.repositoryIdentity;
      if (!identity) {
        return false;
      }
      if (identity.canonicalKey.toLowerCase() === expectedKey) {
        return true;
      }
      if (
        identity.provider?.toLowerCase() === "github" &&
        identity.owner?.toLowerCase() === repository.owner.toLowerCase() &&
        identity.name?.toLowerCase() === repository.name.toLowerCase()
      ) {
        return true;
      }
      return normalizeGitRemoteIdentity(identity.locator.remoteUrl) === expectedKey;
    }) ?? null
  );
}

export function filterGitHubRepositories(
  repositories: ReadonlyArray<SourceControlRepositorySummary>,
  query: string,
): ReadonlyArray<SourceControlRepositorySummary> {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return repositories;
  }
  return repositories.filter((repository) =>
    [repository.nameWithOwner, repository.name, repository.owner, repository.description ?? ""]
      .join("\n")
      .toLowerCase()
      .includes(normalizedQuery),
  );
}
