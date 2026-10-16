import { describe, expect, it, vi } from "vite-plus/test";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  applySidebarThreadDrop,
  archiveSelectedThreadEntries,
  deleteSelectedThreadEntries,
  getFallbackThreadIdAfterDelete,
  isSidebarThreadWorking,
  resolveSidebarThreadStatus,
  pinOrderKeyBetween,
  planSidebarThreadDrop,
  sortThreadsForSidebar,
  sortScopedProjectsForSidebar,
} from "./Sidebar.logic";
import {
  EnvironmentId,
  OrchestrationLatestTurn,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";

import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type Project,
  type SidebarThreadSummary,
  type Thread,
} from "../types";

const localEnvironmentId = EnvironmentId.make("environment-local");

describe("deleteSelectedThreadEntries", () => {
  const entries = [{ threadKey: "one" }, { threadKey: "two" }, { threadKey: "three" }] as const;
  const success = AsyncResult.success(undefined);
  const failure = AsyncResult.failure(Cause.fail(new Error("Delete failed")));
  const interrupted = AsyncResult.failure(Cause.interrupt());

  it("waits for each delete and excludes only earlier successes from worktree checks", async () => {
    let resolveDelete!: (result: typeof success) => void;
    const pendingDelete = new Promise<typeof success>((resolve) => {
      resolveDelete = resolve;
    });
    const worktreeChecks: { threadKey: string; deletedThreadKeys: string[] }[] = [];
    const deletion = deleteSelectedThreadEntries({
      entries,
      delete: async ({ threadKey }, deletedThreadKeys) => {
        worktreeChecks.push({ threadKey, deletedThreadKeys: [...deletedThreadKeys] });
        return threadKey === "one" ? pendingDelete : success;
      },
    });

    expect(worktreeChecks).toEqual([{ threadKey: "one", deletedThreadKeys: [] }]);
    resolveDelete(success);
    const outcome = await deletion;

    expect(worktreeChecks).toEqual([
      { threadKey: "one", deletedThreadKeys: [] },
      { threadKey: "two", deletedThreadKeys: ["one"] },
      { threadKey: "three", deletedThreadKeys: ["one", "two"] },
    ]);
    expect(outcome).toEqual({
      deletedThreadKeys: new Set(["one", "two", "three"]),
      firstFailure: null,
    });
  });

  it("continues after ordinary failures and keeps the first failure", async () => {
    const laterFailure = AsyncResult.failure(Cause.fail(new Error("Later failure")));
    const deletedKeysAtLastEntry: string[][] = [];
    const outcome = await deleteSelectedThreadEntries({
      entries: [...entries, { threadKey: "four" }],
      delete: async ({ threadKey }, deletedThreadKeys) => {
        if (threadKey === "one") return failure;
        if (threadKey === "three") return laterFailure;
        if (threadKey === "four") deletedKeysAtLastEntry.push([...deletedThreadKeys]);
        return success;
      },
    });

    expect(deletedKeysAtLastEntry).toEqual([["two"]]);
    expect(outcome).toEqual({
      deletedThreadKeys: new Set(["two", "four"]),
      firstFailure: failure,
    });
  });

  it.each([
    { firstResult: success, deletedThreadKeys: new Set(["one"]), firstFailure: null },
    { firstResult: failure, deletedThreadKeys: new Set<string>(), firstFailure: failure },
  ])("stops on interruption and preserves earlier results %#", async (testCase) => {
    const attemptedThreadKeys: string[] = [];
    const outcome = await deleteSelectedThreadEntries({
      entries,
      delete: async ({ threadKey }) => {
        attemptedThreadKeys.push(threadKey);
        return threadKey === "one" ? testCase.firstResult : interrupted;
      },
    });

    expect(attemptedThreadKeys).toEqual(["one", "two"]);
    expect(outcome).toEqual({
      deletedThreadKeys: testCase.deletedThreadKeys,
      firstFailure: testCase.firstFailure,
    });
  });
});

describe("archiveSelectedThreadEntries", () => {
  const entries = [{ threadKey: "one" }, { threadKey: "two" }, { threadKey: "three" }] as const;
  const success = { _tag: "Success" } as const;
  const failure = { _tag: "Failure" } as const;

  it("stops at a mutation failure and retains prior successes", async () => {
    const archive = vi.fn(async (entry: (typeof entries)[number], onArchived: () => void) => {
      if (entry.threadKey === "two") return failure;
      onArchived();
      return success;
    });
    const outcome = await archiveSelectedThreadEntries({ entries, archive });

    expect(archive).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual({
      archivedThreadKeys: ["one"],
      mutationFailure: failure,
      followupFailures: [],
    });
  });

  it("continues after a post-archive failure", async () => {
    const archive = vi.fn(async (entry: (typeof entries)[number], onArchived: () => void) => {
      onArchived();
      return entry.threadKey === "two" ? failure : success;
    });
    const outcome = await archiveSelectedThreadEntries({ entries, archive });

    expect(archive).toHaveBeenCalledTimes(3);
    expect(outcome).toEqual({
      archivedThreadKeys: ["one", "two", "three"],
      mutationFailure: null,
      followupFailures: [failure],
    });
  });
});

function makeLatestTurn(overrides?: {
  completedAt?: string | null;
  startedAt?: string | null;
}): OrchestrationLatestTurn {
  return {
    turnId: "turn-1" as never,
    state: "completed",
    assistantMessageId: null,
    requestedAt: "2026-03-09T10:00:00.000Z",
    startedAt:
      overrides?.startedAt !== undefined ? overrides.startedAt : "2026-03-09T10:00:00.000Z",
    completedAt:
      overrides?.completedAt !== undefined ? overrides.completedAt : "2026-03-09T10:05:00.000Z",
  };
}

describe("resolveSidebarThreadStatus", () => {
  const session = {
    threadId: ThreadId.make("thread-1"),
    status: "running" as const,
    providerName: "Codex",
    providerInstanceId: ProviderInstanceId.make("codex"),
    runtimeMode: DEFAULT_RUNTIME_MODE,
    activeTurnId: "turn-1" as never,
    lastError: null,
    updatedAt: "2026-03-09T10:00:00.000Z",
  };

  const idle = { hasPendingApprovals: false, hasPendingUserInput: false };

  it("prioritizes approval over a running session", () => {
    expect(resolveSidebarThreadStatus({ ...idle, hasPendingApprovals: true, session })).toBe(
      "approval",
    );
  });

  it("prioritizes awaiting input over a running session, below approval", () => {
    expect(resolveSidebarThreadStatus({ ...idle, hasPendingUserInput: true, session })).toBe(
      "input",
    );
    expect(
      resolveSidebarThreadStatus({
        ...idle,
        hasPendingApprovals: true,
        hasPendingUserInput: true,
        session,
      }),
    ).toBe("approval");
  });
});

describe("pinOrderKeyBetween", () => {
  it("returns null for corrupt or out-of-order bounds instead of throwing", () => {
    expect(pinOrderKeyBetween("z", "a")).toBeNull();
    expect(pinOrderKeyBetween("A!", null)).toBeNull();
    expect(pinOrderKeyBetween(null, "ma")).toBeNull();
    expect(pinOrderKeyBetween("m", "m")).toBeNull();
  });
});

describe("planSidebarThreadDrop", () => {
  const pinnedKeysById = new Map<string, string | null>([
    ["p1", "f"],
    ["p2", "m"],
    ["p3", "t"],
  ]);
  const activeKeysById = new Map<string, string | null>([
    ["a1", "f"],
    ["a2", "m"],
    ["a3", "t"],
  ]);
  const plan = (
    overrides: Partial<Omit<Parameters<typeof planSidebarThreadDrop>[0], "target">> & {
      activeKey: string;
      activeSection: "pinned" | "active" | "snoozed" | "settled";
      target: Omit<Parameters<typeof planSidebarThreadDrop>[0]["target"], "activeOrder"> & {
        activeOrder?: readonly string[];
      };
    },
  ) =>
    planSidebarThreadDrop({
      pinnedOrder: ["p1", "p2", "p3"],
      pinnedKeysById,
      activeOrder: ["a1", "a2", "a3"],
      activeKeysById,
      ...overrides,
      target: { activeOrder: [], ...overrides.target },
    });

  it("allows old-server pinned reordering while rejecting settlement", () => {
    expect(
      plan({
        activeKey: "p1",
        activeSection: "pinned",
        supportsSettlement: false,
        target: { section: "pinned", pinnedOrder: ["p2", "p1", "p3"] },
      }).kind,
    ).toBe("reorder-pinned");
    expect(
      plan({
        activeKey: "p1",
        activeSection: "pinned",
        supportsSettlement: false,
        target: { section: "settled", pinnedOrder: ["p2", "p3"] },
      }),
    ).toEqual({ kind: "none" });
  });

  it.each([
    { key: "p2", section: "pinned" as const, unpin: true, unsettle: false, unsnooze: false },
    { key: "s1", section: "settled" as const, unpin: false, unsettle: true, unsnooze: false },
    { key: "z1", section: "snoozed" as const, unpin: false, unsettle: false, unsnooze: true },
  ])("moves a $section thread to the chosen Active slot", (source) => {
    const order = ["a1", source.key, "a2", "a3"];
    const result = plan({
      activeKey: source.key,
      activeSection: source.section,
      target: { section: "active", pinnedOrder: [], activeOrder: order },
    });
    expect(result).toEqual({
      kind: "move-active",
      order,
      assignments: [{ id: source.key, orderKey: expect.any(String) }],
      unpin: source.unpin,
      unsettle: source.unsettle,
      unsnooze: source.unsnooze,
    });
    if (result.kind !== "move-active") return;
    const key = result.assignments[0]!.orderKey;
    expect(key > "f" && key < "m").toBe(true);
  });

  it.each([
    { state: "pinned", activePinned: true, activeSettled: false },
    { state: "settled", activePinned: false, activeSettled: true },
    { state: "pinned and settled", activePinned: true, activeSettled: true },
  ])("clears a snoozed thread's $state state before waking it into Active", (hiddenState) => {
    expect(
      plan({
        activeKey: "z1",
        activeSection: "snoozed",
        activePinned: hiddenState.activePinned,
        activeSettled: hiddenState.activeSettled,
        target: {
          section: "active",
          pinnedOrder: ["p1", "p2", "p3"],
          activeOrder: ["a1", "z1", "a2", "a3"],
        },
      }),
    ).toEqual({
      kind: "move-active",
      order: ["a1", "z1", "a2", "a3"],
      assignments: [{ id: "z1", orderKey: expect.any(String) }],
      unpin: hiddenState.activePinned,
      unsettle: hiddenState.activeSettled,
      unsnooze: true,
    });
  });

  it("saves the first Active reorder, then moves only one key on subsequent drops", () => {
    const rows = ["a1", "a2", "a3"].map((id, index) => ({
      id,
      createdAt: new Date(Date.UTC(2026, 8, 4, 12 - index)).toISOString(),
      activeOrderKey: null as string | null,
    }));
    const firstOrder = ["a2", "a3", "a1"];
    const first = plan({
      activeKey: "a1",
      activeSection: "active",
      target: { section: "active", pinnedOrder: [], activeOrder: firstOrder },
      activeKeysById: new Map(rows.map((row) => [row.id, row.activeOrderKey])),
    });
    expect(first.kind).toBe("move-active");
    if (first.kind !== "move-active") return;
    expect(first.unpin || first.unsettle || first.unsnooze).toBe(false);
    const savedKeys = new Map(first.assignments.map(({ id, orderKey }) => [id, orderKey]));
    const savedRows = rows.map((row) => ({
      ...row,
      activeOrderKey: savedKeys.get(row.id) ?? null,
    }));
    expect(sortThreadsForSidebar(savedRows).map((row) => row.id)).toEqual(firstOrder);

    const secondOrder = ["a2", "a1", "a3"];
    const second = plan({
      activeKey: "a1",
      activeSection: "active",
      activeOrder: firstOrder,
      activeKeysById: savedKeys,
      target: { section: "active", pinnedOrder: [], activeOrder: secondOrder },
    });
    expect(second.kind).toBe("move-active");
    if (second.kind !== "move-active") return;
    expect(second.assignments).toEqual([{ id: "a1", orderKey: expect.any(String) }]);
    const finalRows = savedRows.map((row) =>
      row.id === "a1" ? { ...row, activeOrderKey: second.assignments[0]!.orderKey } : row,
    );
    expect(sortThreadsForSidebar(finalRows).map((row) => row.id)).toEqual(secondOrder);
  });

  it("requires Active ordering support only for the threads whose keys must change", () => {
    const input = {
      activeKey: "a3",
      activeSection: "active" as const,
      target: { section: "active" as const, pinnedOrder: [], activeOrder: ["a1", "a3", "a2"] },
      activeReorderableKeys: new Set(["a3"]),
    };
    expect(plan(input).kind).toBe("move-active");
    expect(
      plan({
        ...input,
        activeKeysById: new Map([
          ["a1", null],
          ["a2", "m"],
          ["a3", "t"],
        ]),
      }),
    ).toEqual({ kind: "none" });
    expect(plan({ ...input, activeReorderableKeys: new Set() })).toEqual({ kind: "none" });
  });

  it.each([
    {
      activeKey: "a1",
      activeSection: "active" as const,
      order: ["p1", "p3", "a1", "p2"],
    },
    { activeKey: "p1", activeSection: "pinned" as const, order: ["p3", "p1", "p2"] },
  ])("rejects $activeSection drops that require rewriting a disabled neighbor", (source) => {
    expect(
      plan({
        activeKey: source.activeKey,
        activeSection: source.activeSection,
        target: { section: "pinned", pinnedOrder: source.order },
        pinnedOrder: ["p1", "p3", "p2"],
        pinnedKeysById: new Map([
          ["p1", "f"],
          ["p2", null],
          ["p3", "t"],
        ]),
        reorderableKeys: new Set(["p1", "p3", source.activeKey]),
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("applySidebarThreadDrop", () => {
  const createdAt = "2026-03-09T08:00:00.000Z";
  const earlier = "2026-03-09T09:00:00.000Z";
  const now = "2026-03-09T12:00:00.000Z";
  const wakeAt = "2026-03-10T08:00:00.000Z";
  const thread = (overrides: Partial<SidebarThreadSummary> = {}) => ({
    id: ThreadId.make("dragged"),
    title: "Keep this title",
    createdAt,
    updatedAt: earlier,
    latestUserMessageAt: null,
    latestTurn: null,
    pinnedAt: null,
    pinOrderKey: null,
    activeOrderKey: null,
    snoozedAt: null,
    snoozedUntil: null,
    settledAt: null,
    settledOverride: null,
    unsettledAt: null,
    ...overrides,
  });

  it("clears underlying pinning and settlement when waking into Active", () => {
    const source = thread({
      pinnedAt: earlier,
      pinOrderKey: "m",
      snoozedAt: earlier,
      snoozedUntil: wakeAt,
      settledOverride: "settled",
      settledAt: earlier,
    });
    expect(applySidebarThreadDrop(source, "active", now)).toEqual({
      ...source,
      pinnedAt: null,
      pinOrderKey: null,
      snoozedAt: null,
      snoozedUntil: null,
      settledOverride: "active",
      settledAt: null,
      unsettledAt: now,
    });
  });
});

function makeProject(overrides: Partial<Project> = {}): Project {
  const { defaultModelSelection, ...rest } = overrides;
  return {
    id: ProjectId.make("project-1"),
    environmentId: localEnvironmentId,
    title: "Project",
    workspaceRoot: "/tmp/project",
    repositoryIdentity: null,
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
      ...defaultModelSelection,
    },
    createdAt: "2026-03-09T10:00:00.000Z",
    updatedAt: "2026-03-09T10:00:00.000Z",
    scripts: [],
    ...rest,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.make("thread-1"),
    environmentId: localEnvironmentId,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
      ...overrides?.modelSelection,
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    proposedPlans: [],
    createdAt: "2026-03-09T10:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    updatedAt: "2026-03-09T10:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    checkpoints: [],
    pullRequests: [],
    activities: [],
    ...overrides,
  };
}

describe("getFallbackThreadIdAfterDelete", () => {
  it("returns the top remaining thread in the deleted thread's project sidebar order", () => {
    const fallbackThreadId = getFallbackThreadIdAfterDelete({
      threads: [
        makeThread({
          id: ThreadId.make("thread-oldest"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:00:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-active"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:05:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-newest"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:10:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-other-project"),
          projectId: ProjectId.make("project-2"),
          createdAt: "2026-03-09T10:20:00.000Z",
          messages: [],
        }),
      ],
      deletedThreadId: ThreadId.make("thread-active"),
      sortOrder: "created_at",
    });

    expect(fallbackThreadId).toBe(ThreadId.make("thread-newest"));
  });

  it("skips other threads being deleted in the same action", () => {
    const fallbackThreadId = getFallbackThreadIdAfterDelete({
      threads: [
        makeThread({
          id: ThreadId.make("thread-active"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:05:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-newest"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:10:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-next"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:07:00.000Z",
          messages: [],
        }),
      ],
      deletedThreadId: ThreadId.make("thread-active"),
      deletedThreadIds: new Set([ThreadId.make("thread-active"), ThreadId.make("thread-newest")]),
      sortOrder: "created_at",
    });

    expect(fallbackThreadId).toBe(ThreadId.make("thread-next"));
  });
});

describe("sortScopedProjectsForSidebar", () => {
  it("keeps identical project ids in different environments separate", () => {
    const remoteEnvironmentId = EnvironmentId.make("environment-remote");
    const sharedProjectId = ProjectId.make("shared-project");
    const projects = [
      makeProject({
        environmentId: localEnvironmentId,
        id: sharedProjectId,
        title: "Local project",
      }),
      makeProject({
        environmentId: remoteEnvironmentId,
        id: sharedProjectId,
        title: "Remote project",
      }),
    ];
    const threads = [
      makeThread({
        environmentId: localEnvironmentId,
        projectId: sharedProjectId,
        updatedAt: "2026-03-09T10:02:00.000Z",
      }),
      makeThread({
        environmentId: remoteEnvironmentId,
        projectId: sharedProjectId,
        updatedAt: "2026-03-09T10:10:00.000Z",
      }),
    ];

    const sorted = sortScopedProjectsForSidebar(projects, threads, "updated_at");

    expect(sorted.map((project) => project.title)).toEqual(["Remote project", "Local project"]);
  });
});

describe("Working shelf (beta)", () => {
  const session = {
    threadId: ThreadId.make("thread-1"),
    status: "running" as const,
    providerName: "Codex",
    providerInstanceId: ProviderInstanceId.make("codex"),
    runtimeMode: DEFAULT_RUNTIME_MODE,
    activeTurnId: "turn-1" as never,
    lastError: null,
    updatedAt: "2026-03-09T10:00:00.000Z",
  };
  const idle = {
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    interactionMode: "default" as const,
    latestTurn: makeLatestTurn(),
    session: { ...session, status: "ready" as const },
  };

  it("keeps a ready plan in the inbox while background work runs", () => {
    expect(
      isSidebarThreadWorking({
        ...idle,
        interactionMode: "plan",
        hasActionableProposedPlan: true,
        backgroundLiveness: "working",
      }),
    ).toBe(false);
  });

  describe("dragging", () => {
    // Pinned p1 | Active a1 a2 | Working w1 | Settled s1

    it("only changes lifecycle when the inbox is time-ordered", () => {
      const base = {
        pinnedOrder: ["p1"],
        pinnedKeysById: new Map([["p1", "m"]]),
        activeOrder: ["a1", "a2"],
        activeKeysById: new Map([
          ["a1", "f"],
          ["a2", "t"],
        ]),
        activeTimeOrdered: true,
      };
      expect(
        planSidebarThreadDrop({
          ...base,
          activeKey: "a1",
          activeSection: "active",
          target: { section: "active", pinnedOrder: ["p1"], activeOrder: ["a2", "a1"] },
        }),
      ).toEqual({ kind: "none" });
      expect(
        planSidebarThreadDrop({
          ...base,
          activeKey: "p1",
          activeSection: "pinned",
          target: { section: "active", pinnedOrder: [], activeOrder: ["a1", "p1", "a2"] },
        }),
      ).toEqual({
        kind: "move-active",
        order: null,
        assignments: [],
        unpin: true,
        unsettle: false,
        unsnooze: false,
      });
    });

    it("only pins when the pinned block is time-ordered (Aldo)", () => {
      const base = {
        pinnedOrder: ["p1", "p2"],
        pinnedKeysById: new Map([
          ["p1", "m"],
          ["p2", "t"],
        ]),
        activeOrder: ["a1", "a2"],
        activeKeysById: new Map<string, string | null>(),
        activeTimeOrdered: true,
        pinnedTimeOrdered: true,
      };
      // Arranging inside the block writes nothing.
      expect(
        planSidebarThreadDrop({
          ...base,
          activeKey: "p1",
          activeSection: "pinned",
          target: { section: "pinned", pinnedOrder: ["p2", "p1"], activeOrder: ["a1", "a2"] },
        }),
      ).toEqual({ kind: "none" });
      // A thread dropped in is pinned, without an order key to write.
      expect(
        planSidebarThreadDrop({
          ...base,
          activeKey: "a1",
          activeSection: "active",
          target: { section: "pinned", pinnedOrder: ["p1", "a1", "p2"], activeOrder: ["a2"] },
        }),
      ).toEqual({ kind: "pin", order: null, orderKey: undefined, extraAssignments: [] });
      // So is a pinned thread woken from its snooze by the drop.
      expect(
        planSidebarThreadDrop({
          ...base,
          activeKey: "z1",
          activeSection: "snoozed",
          activePinned: true,
          target: {
            section: "pinned",
            pinnedOrder: ["z1", "p1", "p2"],
            activeOrder: base.activeOrder,
          },
        }),
      ).toEqual({ kind: "pin", order: null, orderKey: undefined, extraAssignments: [] });
      // Settling and unpinning still work.
      expect(
        planSidebarThreadDrop({
          ...base,
          activeKey: "p1",
          activeSection: "pinned",
          target: { section: "settled", pinnedOrder: ["p2"], activeOrder: base.activeOrder },
        }),
      ).toEqual({ kind: "settle" });
      expect(
        planSidebarThreadDrop({
          ...base,
          activeKey: "p1",
          activeSection: "pinned",
          target: { section: "active", pinnedOrder: ["p2"], activeOrder: ["a1", "p1", "a2"] },
        }),
      ).toMatchObject({ kind: "move-active", order: null, unpin: true });
    });
  });
});
