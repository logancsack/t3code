import { OrchestrationV2ThreadShellJson } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
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
  modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5-5" },
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
  it("is starting, with its message sent, so the sidebar shows it working from the send", () => {
    const entry = Schema.decodeUnknownSync(OrchestrationV2ThreadShellJson)(
      aldoStartingShellThread(thread),
    );
    expect(entry).toMatchObject({
      id: "t-new",
      projectId: "p1",
      title: "Overhaul the home page",
      providerInstanceId: "claudeAgent",
      status: "starting",
      latestRunId: null,
      archivedAt: null,
    });
    expect(DateTime.formatIso(entry.updatedAt)).toBe(SENT);
    expect(entry.latestUserMessageAt && DateTime.formatIso(entry.latestUserMessageAt)).toBe(SENT);
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
