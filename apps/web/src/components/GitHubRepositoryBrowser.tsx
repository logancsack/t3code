"use client";

import type { SourceControlRepositorySummary } from "@t3tools/contracts";
import {
  ArchiveIcon,
  CheckIcon,
  GitForkIcon,
  LoaderCircleIcon,
  LockIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useMemo } from "react";

import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { filterGitHubRepositories } from "./GitHubRepositoryBrowser.logic";

export interface GitHubRepositoryBrowserProject {
  readonly workspaceRoot: string;
}

interface GitHubRepositoryBrowserProps {
  readonly repositories: ReadonlyArray<SourceControlRepositorySummary>;
  readonly query: string;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly activeRepository: string | null;
  readonly projectForRepository: (
    repository: SourceControlRepositorySummary,
  ) => GitHubRepositoryBrowserProject | null;
  readonly onClone: (repository: SourceControlRepositorySummary) => void;
  readonly onSync: (
    repository: SourceControlRepositorySummary,
    project: GitHubRepositoryBrowserProject,
  ) => void;
  readonly onRefresh: () => void;
  readonly onManualLookup: () => void;
}

export function GitHubRepositoryBrowser({
  repositories,
  query,
  isLoading,
  error,
  activeRepository,
  projectForRepository,
  onClone,
  onSync,
  onRefresh,
  onManualLookup,
}: GitHubRepositoryBrowserProps) {
  const filteredRepositories = useMemo(
    () => filterGitHubRepositories(repositories, query),
    [query, repositories],
  );
  const trimmedQuery = query.trim();
  const hasExactMatch = repositories.some(
    (repository) => repository.nameWithOwner.toLowerCase() === trimmedQuery.toLowerCase(),
  );
  const canLookUpExactPath = trimmedQuery.includes("/") && !hasExactMatch;

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Your GitHub repositories">
      <div className="flex min-h-12 items-center justify-between gap-3 border-border/60 border-t px-4 py-2">
        <div className="min-w-0">
          <div className="font-medium text-sm">Your repositories</div>
          <div className="text-muted-foreground text-xs">
            {isLoading && repositories.length === 0
              ? "Loading from GitHub…"
              : `${repositories.length} accessible ${repositories.length === 1 ? "repository" : "repositories"}`}
          </div>
        </div>
        <Button
          aria-label="Refresh GitHub repositories"
          className="size-10 sm:size-8"
          disabled={isLoading}
          onClick={onRefresh}
          size="icon"
          variant="ghost"
        >
          <RefreshCwIcon className={cn(isLoading && "animate-spin")} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-border/60 border-t [scrollbar-gutter:stable]">
        {isLoading && repositories.length === 0 ? (
          <div aria-label="Loading repositories" className="divide-y divide-border/50">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="flex min-h-20 items-center gap-3 px-4 py-3" key={index}>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-2/5 animate-pulse rounded bg-foreground/10" />
                  <div className="h-3 w-3/5 animate-pulse rounded bg-foreground/7" />
                </div>
                <div className="h-10 w-20 animate-pulse rounded-lg bg-foreground/8" />
              </div>
            ))}
          </div>
        ) : error && repositories.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <div>
              <div className="font-medium text-sm">Couldn’t load your repositories</div>
              <div className="mt-1 max-w-md text-muted-foreground text-sm">{error}</div>
            </div>
            <Button onClick={onRefresh} size="lg" variant="outline">
              <RefreshCwIcon />
              Try again
            </Button>
          </div>
        ) : filteredRepositories.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <div>
              <div className="font-medium text-sm">
                {trimmedQuery ? "No matching repositories" : "No repositories found"}
              </div>
              <div className="mt-1 max-w-md text-muted-foreground text-sm">
                {trimmedQuery
                  ? `Nothing in your GitHub account matches “${trimmedQuery}”.`
                  : "GitHub did not return any repositories for this account."}
              </div>
            </div>
            {canLookUpExactPath ? (
              <Button onClick={onManualLookup} size="lg" variant="outline">
                Look up {trimmedQuery}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {filteredRepositories.map((repository) => {
              const project = projectForRepository(repository);
              const isActive = activeRepository === repository.nameWithOwner;
              const metadata = [
                repository.isPrivate ? "Private" : "Public",
                repository.isFork ? "Fork" : null,
                repository.isArchived ? "Archived" : null,
              ].filter(Boolean);

              return (
                <article
                  className="flex min-h-20 items-center gap-3 px-4 py-3 transition-colors hover:bg-foreground/[0.025] max-sm:min-h-24"
                  key={repository.nameWithOwner}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium text-sm">
                        {repository.nameWithOwner}
                      </span>
                      {project ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 text-xs dark:text-emerald-400">
                          <CheckIcon className="size-3" />
                          On this Dev PC
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 truncate text-muted-foreground text-xs">
                      {repository.description?.trim() || metadata.join(" · ")}
                    </div>
                    {repository.description?.trim() ? (
                      <div className="mt-1 flex items-center gap-2 text-muted-foreground/80 text-xs">
                        {repository.isPrivate ? <LockIcon className="size-3" /> : null}
                        {repository.isFork ? <GitForkIcon className="size-3" /> : null}
                        {repository.isArchived ? <ArchiveIcon className="size-3" /> : null}
                        <span>{metadata.join(" · ")}</span>
                      </div>
                    ) : null}
                  </div>
                  <Button
                    aria-label={`${project ? "Sync" : "Clone"} ${repository.nameWithOwner}`}
                    className="h-11 min-w-20 px-4 sm:h-8 sm:min-w-18 sm:px-3"
                    disabled={activeRepository !== null || repository.isArchived}
                    onClick={() => {
                      if (project) {
                        onSync(repository, project);
                      } else {
                        onClone(repository);
                      }
                    }}
                    variant={project ? "outline" : "default"}
                  >
                    {isActive ? <LoaderCircleIcon className="animate-spin" /> : null}
                    {repository.isArchived ? "Archived" : project ? "Sync" : "Clone"}
                  </Button>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {error && repositories.length > 0 ? (
        <div className="border-border/60 border-t bg-destructive/5 px-4 py-2 text-destructive text-xs">
          Refresh failed. Showing the last repository list.
        </div>
      ) : null}
    </section>
  );
}
