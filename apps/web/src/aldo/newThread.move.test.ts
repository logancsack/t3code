import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { toastManager } from "../components/ui/toast";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";

const threads = vi.hoisted(() => ({
  startAldoSandbox: vi.fn(),
  aldoProjectRefForNewThread: vi.fn(),
}));
vi.mock("./threads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./threads")>()),
  ...threads,
}));
const entities = vi.hoisted(() => ({ missing: false }));
vi.mock("../state/entities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/entities")>()),
  waitForProject: async (ref: { environmentId: string; projectId: string }) => {
    if (entities.missing) throw new Error("The project didn't load.");
    return { environmentId: ref.environmentId, id: ref.projectId };
  },
}));

import { aldoProjectForMovedDraft } from "./newThread";

const draftId = DraftId.make("draft-1");
const otherDraftId = DraftId.make("draft-2");
const general = scopeProjectRef(EnvironmentId.make("aldo-general-2"), ProjectId.make("general"));
const repo = scopeProjectRef(EnvironmentId.make("aldo-repo-1"), ProjectId.make("repo"));
const ownRepo = scopeProjectRef(EnvironmentId.make("aldo-repo-2"), ProjectId.make("repo-2"));

function setDraft(promotedTo: ReturnType<typeof scopeThreadRef> | null) {
  useComposerDraftStore.setState({
    draftThreadsByThreadKey: {
      [draftId]: { promotedTo } as never,
      [otherDraftId]: { promotedTo: null } as never,
    },
  });
}

/** A promise and the function that settles it. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => (resolve = settle));
  return { promise, resolve };
}

beforeEach(() => {
  threads.startAldoSandbox.mockReset();
  threads.aldoProjectRefForNewThread.mockReset();
  entities.missing = false;
  setDraft(null);
});

afterEach(() => {
  useComposerDraftStore.setState({ draftThreadsByThreadKey: {} });
});

describe("aldoProjectForMovedDraft", () => {
  it("moves a draft to General on a machine of its own", async () => {
    threads.startAldoSandbox.mockResolvedValue(general);
    const project = await aldoProjectForMovedDraft(draftId, null);
    expect(threads.startAldoSandbox).toHaveBeenCalledWith({ repos: [] });
    expect(project).toEqual({ environmentId: general.environmentId, id: general.projectId });
  });

  it("moves a draft to a project on a machine of its own there, not the one picked", async () => {
    threads.aldoProjectRefForNewThread.mockResolvedValue(ownRepo);
    const project = await aldoProjectForMovedDraft(draftId, repo);
    expect(threads.aldoProjectRefForNewThread).toHaveBeenCalledWith(repo);
    expect(threads.startAldoSandbox).not.toHaveBeenCalled();
    expect(project).toEqual({ environmentId: ownRepo.environmentId, id: ownRepo.projectId });
  });

  it("moves a draft to a project picked by its repositories, with no machine there yet", async () => {
    threads.startAldoSandbox.mockResolvedValue(ownRepo);
    const project = await aldoProjectForMovedDraft(draftId, { repos: ["aldo:trip-plans"] });
    expect(threads.startAldoSandbox).toHaveBeenCalledWith({ repos: ["aldo:trip-plans"] });
    expect(threads.aldoProjectRefForNewThread).not.toHaveBeenCalled();
    expect(project).toEqual({ environmentId: ownRepo.environmentId, id: ownRepo.projectId });
  });

  it("moves a draft to a new project, made with its machine", async () => {
    threads.startAldoSandbox.mockResolvedValue(ownRepo);
    const create = { host: "aldo", name: "Trip plans", isPrivate: true } as const;
    const project = await aldoProjectForMovedDraft(draftId, { create });
    expect(threads.startAldoSandbox).toHaveBeenCalledWith({ create });
    expect(project).toEqual({ environmentId: ownRepo.environmentId, id: ownRepo.projectId });
  });

  it("drops a move that a later one overtook, whichever is ready first", async () => {
    const first = deferred<typeof general>();
    threads.startAldoSandbox.mockReturnValueOnce(first.promise);
    threads.aldoProjectRefForNewThread.mockResolvedValue(ownRepo);
    const toGeneral = aldoProjectForMovedDraft(draftId, null);
    const toRepo = aldoProjectForMovedDraft(draftId, repo);
    expect(await toRepo).toEqual({ environmentId: ownRepo.environmentId, id: ownRepo.projectId });
    first.resolve(general);
    expect(await toGeneral).toBeNull();
  });

  it("lands another draft's move made meanwhile, too", async () => {
    const first = deferred<typeof general>();
    threads.startAldoSandbox.mockReturnValueOnce(first.promise);
    threads.aldoProjectRefForNewThread.mockResolvedValue(ownRepo);
    const toGeneral = aldoProjectForMovedDraft(draftId, null);
    const otherToRepo = aldoProjectForMovedDraft(otherDraftId, repo);
    expect(await otherToRepo).toEqual({
      environmentId: ownRepo.environmentId,
      id: ownRepo.projectId,
    });
    first.resolve(general);
    expect(await toGeneral).toEqual({
      environmentId: general.environmentId,
      id: general.projectId,
    });
  });

  it("leaves a draft sent meanwhile where it went", async () => {
    const machine = deferred<typeof general>();
    threads.startAldoSandbox.mockReturnValueOnce(machine.promise);
    const move = aldoProjectForMovedDraft(draftId, null);
    setDraft(scopeThreadRef(repo.environmentId, ThreadId.make("thread-1")));
    machine.resolve(general);
    expect(await move).toBeNull();
  });

  it("leaves the draft when it can't have a machine, which startAldoSandbox shows", async () => {
    const toast = vi.spyOn(toastManager, "add");
    threads.startAldoSandbox.mockRejectedValueOnce(
      new Error("You've reached your plan's machines."),
    );
    expect(await aldoProjectForMovedDraft(draftId, null)).toBeNull();
    expect(toast).not.toHaveBeenCalled();
    toast.mockRestore();
  });

  it("says so when the machine's project doesn't load, and leaves the draft", async () => {
    const toast = vi.spyOn(toastManager, "add");
    threads.startAldoSandbox.mockResolvedValue(general);
    entities.missing = true;
    expect(await aldoProjectForMovedDraft(draftId, null)).toBeNull();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        title: "Couldn't move the draft",
        description: "The project didn't load.",
      }),
    );
    toast.mockRestore();
  });
});
