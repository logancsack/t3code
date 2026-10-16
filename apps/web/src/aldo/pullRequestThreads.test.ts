import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const aldo = vi.hoisted(() => ({
  supported: true,
  owner: null as { environmentId: string; threadId: string | null } | null,
  lookupError: false,
  missingOwnerField: false,
  started: [] as unknown[],
  discarded: [] as string[],
  start: null as null | (() => Promise<unknown>),
  toasts: [] as unknown[],
}));
vi.mock("./directory", () => ({ aldoReusesPullRequestThreads: () => aldo.supported }));
vi.mock("./api", () => ({
  threadIdForEnvironment: (id: string) => id.replace(/^aldo-/, ""),
  api: async () => {
    if (aldo.lookupError) throw new Error("Offline");
    return aldo.missingOwnerField ? {} : { owner: aldo.owner };
  },
}));
vi.mock("./threads", () => ({
  startAldoSandbox: (input: unknown) => {
    aldo.started.push(input);
    return aldo.start!();
  },
  discardAldoSandbox: async (id: string) => {
    aldo.discarded.push(id);
  },
}));
vi.mock("../components/ui/toast", () => ({
  toastManager: {
    add: (options: unknown) => {
      aldo.toasts.push(options);
      return "toast";
    },
    update: (_id: string, options: unknown) => {
      aldo.toasts.push(options);
    },
    close: () => {},
  },
}));

import { DraftId } from "../composerDraftStore";
import { openAldoPullRequestThread } from "./pullRequestThreads";

const PR = {
  number: 12,
  headBranch: "feature/fix",
  state: "open",
  url: "https://github.com/a/b/pull/12",
};
const PROJECT = { environmentId: "aldo-new", projectId: "project" };
beforeEach(() => {
  aldo.supported = true;
  aldo.owner = null;
  aldo.lookupError = false;
  aldo.missingOwnerField = false;
  aldo.started = [];
  aldo.discarded = [];
  aldo.toasts = [];
  aldo.start = async () => PROJECT;
});

describe("PR thread ownership", () => {
  it.each(["open", "merged", "closed"])(
    "reuses the owner for a %s PR without allocating a machine or conversation",
    async (state) => {
      aldo.owner = { environmentId: "aldo-original", threadId: "original" };
      const create = vi.fn();
      const land = vi.fn();
      const reuse = vi.fn();
      await openAldoPullRequestThread("aldo-other", { ...PR, state }, create, land, reuse);
      expect(aldo.started).toEqual([]);
      expect(create).not.toHaveBeenCalled();
      expect(land).toHaveBeenCalledExactlyOnceWith(aldo.owner);
      expect(reuse).toHaveBeenCalledExactlyOnceWith(aldo.owner);
      expect(aldo.discarded).toEqual([]);
    },
  );

  it("allows an explicitly selected unowned PR to establish its first thread", async () => {
    const create = vi.fn(async () => ({ draftId: DraftId.make("draft") }));
    const land = vi.fn();
    const reuse = vi.fn();
    await openAldoPullRequestThread("aldo-other", PR, create, land, reuse);
    expect(aldo.started).toEqual([
      { fromEnvironmentId: "aldo-other", pullRequest: { number: 12, headBranch: "feature/fix" } },
    ]);
    expect(create).toHaveBeenCalledExactlyOnceWith(PROJECT);
    expect(land).toHaveBeenCalledExactlyOnceWith("draft");
    expect(reuse).not.toHaveBeenCalled();
  });

  it.each(["unsupported", "offline", "unavailable owner", "older response"])(
    "never creates a fallback for %s",
    async (failure) => {
      if (failure === "unsupported") aldo.supported = false;
      if (failure === "offline") aldo.lookupError = true;
      if (failure === "older response") aldo.missingOwnerField = true;
      if (failure === "unavailable owner")
        aldo.owner = { environmentId: "aldo-original", threadId: null };
      const create = vi.fn();
      await openAldoPullRequestThread("aldo-other", PR, create, null, vi.fn());
      expect(aldo.started).toEqual([]);
      expect(create).not.toHaveBeenCalled();
      expect(aldo.toasts.at(-1)).toMatchObject({ type: "error" });
    },
  );

  it("discards only its own unstarted machine if the first draft cannot open", async () => {
    await openAldoPullRequestThread("aldo-other", PR, async () => null, null, vi.fn());
    expect(aldo.discarded).toEqual(["aldo-new"]);
  });
});
