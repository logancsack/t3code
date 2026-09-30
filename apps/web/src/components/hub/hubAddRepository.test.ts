import { ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildHubBlankProjectInput,
  buildHubRepositoryIdentity,
  buildHubRepositoryProjectInput,
  findHubProjectForRemoteUrl,
} from "./hubAddRepository";

describe("buildHubRepositoryIdentity", () => {
  it("records a GitHub HTTPS remote the way a checkout's git remote would", () => {
    expect(buildHubRepositoryIdentity("https://github.com/Acme/App.git")).toEqual({
      canonicalKey: "github.com/acme/app",
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: "https://github.com/Acme/App.git",
      },
      displayName: "acme/app",
      provider: "github",
      owner: "acme",
      name: "app",
    });
  });

  it("normalizes SSH remotes and nested groups", () => {
    expect(buildHubRepositoryIdentity("git@gitlab.com:group/sub/project.git")).toMatchObject({
      canonicalKey: "gitlab.com/group/sub/project",
      provider: "gitlab",
      owner: "group",
      name: "project",
    });
  });
});

describe("findHubProjectForRemoteUrl", () => {
  const projects = [
    {
      id: "one",
      repositoryIdentity: {
        canonicalKey: "github.com/acme/app",
        locator: { remoteUrl: "https://github.com/acme/app" },
      },
    },
    { id: "blank", repositoryIdentity: null },
  ];

  it("finds a project already recording the same repository under another URL form", () => {
    expect(findHubProjectForRemoteUrl("git@github.com:Acme/App.git", projects)?.id).toBe("one");
    expect(findHubProjectForRemoteUrl("https://github.com/acme/app/", projects)?.id).toBe("one");
  });

  it("does not match blank projects or other repositories", () => {
    expect(findHubProjectForRemoteUrl("https://github.com/acme/other", projects)).toBeNull();
  });
});

describe("hub project create inputs", () => {
  const projectId = ProjectId.make("project-1");

  it("creates repository projects on the virtual root with the recorded identity", () => {
    const input = buildHubRepositoryProjectInput({
      projectId,
      remoteUrl: "https://github.com/acme/app",
      defaultModelSelection: null,
    });
    expect(input).toMatchObject({
      projectId,
      title: "app",
      workspaceRoot: "/workspace/p/project-1",
      createWorkspaceRootIfMissing: false,
      repositoryIdentity: { canonicalKey: "github.com/acme/app" },
    });
  });

  it("prefers an explicit title", () => {
    expect(
      buildHubRepositoryProjectInput({
        projectId,
        remoteUrl: "https://github.com/acme/app",
        title: "  Marketing site ",
        defaultModelSelection: null,
      }).title,
    ).toBe("Marketing site");
  });

  it("creates blank projects without a repository", () => {
    expect(
      buildHubBlankProjectInput({ projectId, title: "  ", defaultModelSelection: null }),
    ).toMatchObject({
      title: "Untitled project",
      workspaceRoot: "/workspace/p/project-1",
      createWorkspaceRootIfMissing: false,
      repositoryIdentity: null,
    });
  });
});
