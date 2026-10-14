import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  threads: {} as Record<string, number>,
  projects: [] as Array<{ environmentId: string; id: string }>,
  sandboxes: [] as Array<{ environmentId: string }>,
  onAskedBranch: [] as string[],
  drafts: {} as Record<string, { environmentId: string; promotedTo?: unknown }>,
  prompts: {} as Record<string, string>,
  created: [] as unknown[],
}));

vi.mock("../state/entities", () => ({
  readEnvironmentThreadRefs: (environmentId: string) =>
    Array.from({ length: state.threads[environmentId] ?? 0 }),
  readProjects: () => state.projects,
}));
vi.mock("./cloud", () => ({
  isAldoCloud: true,
  isAldoEnvironmentId: (id: string) => id.startsWith("aldo-"),
  aldoProjectSandboxes: () => state.sandboxes,
  aldoSandboxesFor: () => state.sandboxes,
  aldoMachineOnAskedBranch: (id: string) => state.onAskedBranch.includes(id),
  createAldoEnvironment: (input: unknown) => {
    state.created.push(input);
    return Promise.reject(new Error("not in this test"));
  },
  aldoEnvironmentIdFor: (id: string) => `aldo-${id}`,
  newAldoThreadId: () => "new",
  holdAldoEnvironment: () => undefined,
  releaseAldoEnvironment: () => undefined,
  deleteAldoEnvironment: () => Promise.resolve(),
  deleteAldoMachineWithThread: () => Promise.resolve(),
}));
vi.mock("./dispatch", () => ({ ensureAldoConnected: () => Promise.resolve() }));
vi.mock("./serverConfig", () => ({ aldoServerConfigFor: () => Promise.resolve(null) }));
vi.mock("../connection/storage", () => ({
  clearEnvironmentCache: () => Promise.resolve(),
  seedEnvironmentCache: () => Promise.resolve(),
}));
vi.mock("../components/ui/toast", () => ({ toastManager: { add: () => "toast" } }));
vi.mock("../composerDraftStore", () => ({
  composerDraftHasUserContent: (draft: { prompt: string } | undefined) => Boolean(draft?.prompt),
  useComposerDraftStore: {
    getState: () => ({
      draftThreadsByThreadKey: state.drafts,
      getComposerDraft: (draftId: string) => ({ prompt: state.prompts[draftId] ?? "" }),
    }),
  },
}));

import type { ScopedProjectRef } from "@t3tools/contracts";

import { aldoProjectRefForNewThread } from "./threads";

const ref = (environmentId: string) => ({ environmentId, projectId: "p" }) as ScopedProjectRef;

beforeEach(() => {
  state.threads = {};
  state.projects = [
    { environmentId: "aldo-pr", id: "p" },
    { environmentId: "aldo-older", id: "p" },
  ];
  state.sandboxes = [{ environmentId: "aldo-older" }, { environmentId: "aldo-pr" }];
  state.onAskedBranch = [];
  state.drafts = {};
  state.prompts = {};
  state.created = [];
});

describe("aldoProjectRefForNewThread", () => {
  it("keeps a new thread on the machine asked for while it has no thread", async () => {
    // Another idle machine of the project comes first, on a branch of its own.
    await expect(aldoProjectRefForNewThread(ref("aldo-pr"))).resolves.toEqual(ref("aldo-pr"));
    expect(state.created).toEqual([]);
  });

  it("moves a new thread off a machine that has one, to an idle one", async () => {
    state.threads = { "aldo-pr": 1 };
    await expect(aldoProjectRefForNewThread(ref("aldo-pr"))).resolves.toEqual(ref("aldo-older"));
    expect(state.created).toEqual([]);
  });

  it("leaves a machine to its draft once a task is in it, as to a thread", async () => {
    state.drafts = { fix: { environmentId: "aldo-pr", promotedTo: null } };
    state.prompts = { fix: "Fix the failing check" };
    await expect(aldoProjectRefForNewThread(ref("aldo-pr"))).resolves.toEqual(ref("aldo-older"));
  });

  it("still uses a machine whose draft is empty (T3 reuses that draft)", async () => {
    state.threads = { "aldo-pr": 1 };
    state.drafts = { empty: { environmentId: "aldo-older", promotedTo: null } };
    await expect(aldoProjectRefForNewThread(ref("aldo-pr"))).resolves.toEqual(ref("aldo-older"));
  });

  it("keeps a pull request's machine for the first draft it opens alone", async () => {
    state.onAskedBranch = ["aldo-pr"];
    await expect(aldoProjectRefForNewThread(ref("aldo-pr"))).resolves.toEqual(ref("aldo-pr"));
    state.drafts = { checkout: { environmentId: "aldo-pr", promotedTo: null } };
    await expect(aldoProjectRefForNewThread(ref("aldo-pr"))).resolves.toEqual(ref("aldo-older"));
  });

  it("never gives another thread an idle machine on a pull request's branch", async () => {
    state.threads = { "aldo-pr": 1 };
    state.onAskedBranch = ["aldo-older"];
    await expect(aldoProjectRefForNewThread(ref("aldo-pr"))).rejects.toThrow("not in this test");
    expect(state.created).toHaveLength(1);
  });
});
