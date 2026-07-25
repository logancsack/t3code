import type { SourceControlRepositorySummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  filterGitHubRepositories,
  findProjectForGitHubRepository,
  normalizeGitRemoteIdentity,
} from "./GitHubRepositoryBrowser.logic";

const repository: SourceControlRepositorySummary = {
  provider: "github",
  nameWithOwner: "acme/console",
  name: "console",
  owner: "acme",
  url: "https://github.com/acme/console",
  sshUrl: "git@github.com:acme/console.git",
  description: "Internal dashboard",
  isPrivate: true,
  isArchived: false,
  isFork: false,
};

describe("GitHubRepositoryBrowser logic", () => {
  it("normalizes HTTPS and SSH GitHub remotes", () => {
    expect(normalizeGitRemoteIdentity("https://github.com/Acme/Console.git")).toBe(
      "github.com/acme/console",
    );
    expect(normalizeGitRemoteIdentity("git@github.com:Acme/Console.git")).toBe(
      "github.com/acme/console",
    );
  });

  it("matches a remote repository to an existing project", () => {
    const project = {
      workspaceRoot: "/workspace/repos/console",
      repositoryIdentity: {
        canonicalKey: "github.com/acme/console",
        locator: {
          remoteUrl: "git@github.com:acme/console.git",
        },
      },
    };
    expect(findProjectForGitHubRepository(repository, [project])).toBe(project);
  });

  it("filters by owner, name, and description while showing everything for an empty query", () => {
    const other = {
      ...repository,
      nameWithOwner: "acme/api",
      name: "api",
      description: "GraphQL service",
    };
    expect(filterGitHubRepositories([repository, other], "")).toHaveLength(2);
    expect(filterGitHubRepositories([repository, other], "dashboard")).toEqual([repository]);
    expect(filterGitHubRepositories([repository, other], "acme/api")).toEqual([other]);
  });
});
