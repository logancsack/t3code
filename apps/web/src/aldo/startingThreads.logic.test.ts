import { describe, expect, it } from "vite-plus/test";

import {
  aldoStartingShellThread,
  withAldoStartingThread,
  withoutAldoThreads,
  type AldoNewThread,
} from "./startingThreads.logic";

const CREATED = "2026-09-30T21:00:00.000Z";
const SENT = "2026-09-30T21:00:05.000Z";
const thread: AldoNewThread = {
  id: "t-new",
  projectId: "p1",
  title: "Overhaul the home page",
  modelSelection: { instanceId: "claudeAgent" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  createdAt: CREATED,
  sentAt: SENT,
};
const shell = (threads: Array<{ id: string }> = []) => ({
  snapshotSequence: 3,
  projects: [{ id: "p1" }],
  threads,
  updatedAt: CREATED,
});

describe("aldoStartingShellThread", () => {
  it("is connecting, with its message sent, so the sidebar shows it working from the send", () => {
    const entry = aldoStartingShellThread(thread);
    expect(entry).toMatchObject({
      id: "t-new",
      projectId: "p1",
      title: "Overhaul the home page",
      latestTurn: null,
      createdAt: CREATED,
      updatedAt: SENT,
      latestUserMessageAt: SENT,
      archivedAt: null,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
    });
    expect(entry.session).toEqual({
      threadId: "t-new",
      status: "starting",
      providerName: null,
      providerInstanceId: "claudeAgent",
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt: SENT,
    });
  });
});

describe("withAldoStartingThread", () => {
  it("adds the thread under its project, keeping the shell's sequence", () => {
    const next = withAldoStartingThread(shell([{ id: "other" }]), thread);
    expect(next?.snapshotSequence).toBe(3);
    expect(next?.threads.map((entry) => entry.id)).toEqual(["other", "t-new"]);
  });

  it("adds nothing when the shell has the thread, or not its project", () => {
    expect(withAldoStartingThread(shell([{ id: "t-new" }]), thread)).toBeNull();
    expect(withAldoStartingThread({ ...shell(), projects: [{ id: "p2" }] }, thread)).toBeNull();
  });
});

describe("withoutAldoThreads", () => {
  it("takes out the threads named, or all of them", () => {
    const cached = shell([{ id: "t-new" }, { id: "other" }]);
    expect(withoutAldoThreads(cached, new Set(["t-new"]))?.threads).toEqual([{ id: "other" }]);
    expect(withoutAldoThreads(cached, "all")?.threads).toEqual([]);
    expect(withoutAldoThreads(cached, "all")?.projects).toEqual([{ id: "p1" }]);
  });

  it("changes nothing when the shell has none of them", () => {
    expect(withoutAldoThreads(shell([{ id: "other" }]), new Set(["t-new"]))).toBeNull();
    expect(withoutAldoThreads(shell(), "all")).toBeNull();
  });
});
