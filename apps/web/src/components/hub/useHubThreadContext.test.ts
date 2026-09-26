import { describe, expect, it } from "vite-plus/test";

import { deriveThreadMachineView } from "../../threadMachine";
import { resolveHubThreadContext } from "./useHubThreadContext";

const identity = {
  canonicalKey: "github.com/acme/app",
  locator: { source: "git-remote" as const, remoteName: "origin", remoteUrl: "x" },
};
const view = (state: "starting" | "paused" | "failed" | "running", detail: string | null = null) =>
  deriveThreadMachineView({ state, detail, updatedAt: "2026-09-26T10:00:00.000Z" });

describe("resolveHubThreadContext", () => {
  it("changes nothing off a hub", () => {
    expect(
      resolveHubThreadContext({
        hub: false,
        isServerThread: false,
        projectRepositoryIdentity: null,
        machineView: view("failed"),
      }),
    ).toEqual({
      hub: false,
      draftWithoutMachine: false,
      workspaceAvailable: true,
      isGitRepoOverride: null,
      forcedEnvMode: null,
      defaultBaseRef: null,
      machineView: null,
      machineTransitional: false,
      machineDetail: null,
      machineUnavailable: false,
    });
  });

  it("starts every hub draft on a fresh machine from the default branch", () => {
    expect(
      resolveHubThreadContext({
        hub: true,
        isServerThread: false,
        projectRepositoryIdentity: identity,
        machineView: null,
      }),
    ).toMatchObject({
      draftWithoutMachine: true,
      workspaceAvailable: false,
      isGitRepoOverride: true,
      forcedEnvMode: "worktree",
      defaultBaseRef: "HEAD",
    });
  });

  it("treats a blank hub project's draft as no repository", () => {
    expect(
      resolveHubThreadContext({
        hub: true,
        isServerThread: false,
        projectRepositoryIdentity: null,
        machineView: null,
      }).isGitRepoOverride,
    ).toBe(false);
  });

  it("reports machine progress for a started thread", () => {
    expect(
      resolveHubThreadContext({
        hub: true,
        isServerThread: true,
        projectRepositoryIdentity: identity,
        machineView: view("starting", "Cloning repository"),
      }),
    ).toMatchObject({
      draftWithoutMachine: false,
      workspaceAvailable: true,
      isGitRepoOverride: null,
      machineTransitional: true,
      machineDetail: "Cloning repository",
      machineUnavailable: false,
    });
  });

  it("marks machine-backed reads unavailable while the machine sleeps or has failed", () => {
    for (const state of ["paused", "failed"] as const) {
      expect(
        resolveHubThreadContext({
          hub: true,
          isServerThread: true,
          projectRepositoryIdentity: identity,
          machineView: view(state),
        }).machineUnavailable,
      ).toBe(true);
    }
  });
});
