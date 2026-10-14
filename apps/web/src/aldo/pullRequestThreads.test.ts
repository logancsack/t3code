import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const aldo = vi.hoisted(() => ({
  startsThem: true,
  started: [] as unknown[],
  discarded: [] as string[],
  start: null as null | (() => Promise<unknown>),
  toasts: [] as Array<{ readonly id?: string; readonly options?: unknown; readonly closed?: true }>,
}));

vi.mock("./cloud", () => ({ aldoStartsPullRequestThreads: () => aldo.startsThem }));
vi.mock("./threads", () => ({
  startAldoSandbox: (input: unknown) => {
    aldo.started.push(input);
    return aldo.start!();
  },
  discardAldoSandbox: (environmentId: string) => {
    aldo.discarded.push(environmentId);
    return Promise.resolve();
  },
}));
vi.mock("../components/ui/toast", () => ({
  toastManager: {
    add: (options: unknown) => {
      aldo.toasts.push({ options });
      return "toast";
    },
    update: (id: string, options: unknown) => aldo.toasts.push({ id, options }),
    close: (id: string) => aldo.toasts.push({ id, closed: true }),
  },
}));

import { DraftId } from "../composerDraftStore";
import { openAldoPullRequestThread } from "./pullRequestThreads";

const PULL_REQUEST = { number: 12, headBranch: "feature/fix", state: "open" };
const PROJECT = { environmentId: "aldo-new", projectId: "project" };

beforeEach(() => {
  aldo.startsThem = true;
  aldo.started = [];
  aldo.discarded = [];
  aldo.start = async () => PROJECT;
  aldo.toasts = [];
});

describe("openAldoPullRequestThread", () => {
  it("opens a thread on the branch and lands the task in its composer", async () => {
    const opened: unknown[] = [];
    const landed: string[] = [];
    await openAldoPullRequestThread(
      "aldo-panel",
      PULL_REQUEST,
      async (projectRef) => {
        opened.push(projectRef);
        return { draftId: DraftId.make("draft") };
      },
      (draftId) => landed.push(draftId),
    );
    expect(aldo.started).toEqual([
      { fromEnvironmentId: "aldo-panel", pullRequest: { number: 12, headBranch: "feature/fix" } },
    ]);
    expect(opened).toEqual([PROJECT]);
    expect(landed).toEqual(["draft"]);
    expect(aldo.toasts.at(-1)).toMatchObject({
      id: "toast",
      options: { type: "success", description: expect.stringContaining("composer") },
    });
  });

  it("says nothing more when Aldo refuses it: startAldoSandbox says why", async () => {
    aldo.start = () => Promise.reject(new Error("#12 comes from a fork"));
    const openThread = vi.fn();
    await openAldoPullRequestThread("aldo-panel", PULL_REQUEST, openThread, null);
    expect(openThread).not.toHaveBeenCalled();
    expect(aldo.toasts.at(-1)).toEqual({ id: "toast", closed: true });
  });

  it("starts nothing with an Aldo that would put the thread on a branch of its own", async () => {
    aldo.startsThem = false;
    const openThread = vi.fn();
    await openAldoPullRequestThread("aldo-panel", PULL_REQUEST, openThread, null);
    expect(aldo.started).toEqual([]);
    expect(openThread).not.toHaveBeenCalled();
    expect(aldo.toasts).toMatchObject([{ options: { type: "error" } }]);
  });

  it("starts nothing on a pull request that isn't open", async () => {
    const openThread = vi.fn();
    await openAldoPullRequestThread(
      "aldo-panel",
      { ...PULL_REQUEST, state: "merged" },
      openThread,
      null,
    );
    expect(aldo.started).toEqual([]);
    expect(openThread).not.toHaveBeenCalled();
    expect(aldo.toasts).toMatchObject([
      { options: { type: "error", title: "This pull request is merged" } },
    ]);
  });

  it("deletes the machine it recorded when the thread doesn't open", async () => {
    await openAldoPullRequestThread("aldo-panel", PULL_REQUEST, async () => null, null);
    expect(aldo.discarded).toEqual(["aldo-new"]);
    expect(aldo.toasts.at(-1)).toMatchObject({ id: "toast", options: { type: "error" } });
  });

  it("keeps the machine of a thread that opened", async () => {
    await openAldoPullRequestThread(
      "aldo-panel",
      PULL_REQUEST,
      async () => ({ draftId: DraftId.make("draft") }),
      null,
    );
    expect(aldo.discarded).toEqual([]);
  });
});
