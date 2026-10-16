import type { setOrchestrationCommandDispatchOverride } from "@t3tools/client-runtime/operations";
import {
  CommandId,
  MessageId,
  ModelSelection,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ClientOrchestrationCommand,
} from "@t3tools/contracts";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import type { AldoOutgoing } from "./outbox";

const host = vi.hoisted(() => ({
  dispatch: null as NonNullable<
    Parameters<typeof setOrchestrationCommandDispatchOverride>[0]
  > | null,
  routes: true,
  explicit: false,
  hold: vi.fn(async () => "held"),
  outgoing: vi.fn(async () => {}),
  entries: new Map<string, AldoOutgoing>(),
  toast: vi.fn(),
  closeToast: vi.fn(),
  ApiError: class extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@t3tools/client-runtime/operations", () => ({
  setOrchestrationCommandDispatchOverride: (dispatch: typeof host.dispatch) => {
    host.dispatch = dispatch;
  },
}));
vi.mock("../composerDraftStore", () => ({
  useComposerDraftStore: {
    getState: () => ({
      getComposerDraft: () => ({
        modelSelectionExplicit: host.explicit,
        activeProvider: "codex",
        modelSelectionByProvider: { codex: {} },
      }),
    }),
  },
}));
vi.mock("../connection/catalog", () => ({ environmentCatalog: {} }));
vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: { get: () => ({ connection: { phase: "connected" } }) },
}));
vi.mock("../state/presentation", () => ({
  environmentPresentations: { presentationAtom: () => null },
}));
vi.mock("../components/ui/toast", () => ({
  toastManager: { add: host.toast, close: host.closeToast },
}));
vi.mock("./threadCommands", () => ({ keepAldoCommand: async () => null }));
vi.mock("./files", () => ({ aldoFilesOf: () => null }));
vi.mock("./outbox", () => ({
  outgoing: async () => [...host.entries.values()],
  keepOutgoing: async (
    environmentId: string,
    command: { commandId: string },
    files: ReadonlyMap<string, Blob> | null,
  ) => {
    await host.outgoing();
    host.entries.set(command.commandId, {
      commandId: command.commandId,
      environmentId,
      command,
      ...(files ? { files } : {}),
      keptAt: Date.now(),
    });
  },
  dropOutgoing: async (commandId: string) => {
    host.entries.delete(commandId);
  },
}));
vi.mock("./startingThreads", () => ({
  aldoMachineConnected: vi.fn(),
  releaseAldoStartingThreads: vi.fn(),
}));
vi.mock("./cloud", () => ({
  isAldoCloud: true,
  isAldoEnvironmentId: () => true,
  aldoRoutesModels: () => host.routes,
  holdAldoTurn: host.hold,
  AldoApiError: host.ApiError,
  requestAldoDirectoryRefresh: vi.fn(),
}));

import { installAldoCommandDispatch, resumeAldoOutbox } from "./dispatch";

function command(first: boolean): ClientOrchestrationCommand {
  const modelSelection = ModelSelection.make({
    instanceId: ProviderInstanceId.make("codex"),
    model: "inherited-model",
  });
  return {
    type: "thread.turn.start",
    commandId: CommandId.make("command"),
    threadId: ThreadId.make("thread"),
    message: {
      messageId: MessageId.make("message"),
      role: "user",
      text: "Research this",
      attachments: [],
    },
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt: "2026-10-16T00:00:00.000Z",
    ...(first
      ? {
          bootstrap: {
            createThread: {
              projectId: ProjectId.make("project"),
              title: "Research",
              modelSelection,
              runtimeMode: "full-access",
              interactionMode: "default",
              branch: null,
              worktreePath: null,
              createdAt: "2026-10-16T00:00:00.000Z",
            },
          },
        }
      : {}),
  };
}

beforeEach(async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", new EventTarget());
  host.routes = true;
  host.explicit = false;
  host.hold.mockReset().mockResolvedValue("held");
  host.outgoing.mockClear();
  host.entries.clear();
  host.toast.mockClear();
  host.closeToast.mockClear();
  installAldoCommandDispatch();
  await resumeAldoOutbox();
});

it.each([false, true])(
  "routes a connected machine's first message with explicit=%s, and acknowledges it without sending the original",
  async (explicit) => {
    host.explicit = explicit;
    const first = command(true);
    expect(
      await host.dispatch!({ environmentId: "aldo-machine", command: first, primary: true }),
    ).toEqual({ sequence: 0 });
    expect(host.hold).toHaveBeenCalledWith(
      "aldo-machine",
      { ...first, aldoModelExplicit: explicit },
      null,
      true,
    );
    expect(host.outgoing).toHaveBeenCalledOnce();
    expect(host.entries.size).toBe(0);
  },
);

it("keeps follow-ups on their existing model and supports a server without model routing", async () => {
  expect(
    await host.dispatch!({ environmentId: "aldo-machine", command: command(false), primary: true }),
  ).toBeNull();
  host.routes = false;
  expect(
    await host.dispatch!({ environmentId: "aldo-machine", command: command(true), primary: true }),
  ).toBeNull();
  expect(host.hold).not.toHaveBeenCalled();
});

it("routes an implementation thread's bootstrap while preserving its source plan", async () => {
  const first = {
    ...command(true),
    sourceProposedPlan: { threadId: ThreadId.make("source-thread"), planId: "plan" },
  };
  expect(
    await host.dispatch!({ environmentId: "aldo-machine", command: first, primary: true }),
  ).toEqual({ sequence: 0 });
  expect(host.hold).toHaveBeenCalledWith(
    "aldo-machine",
    { ...first, aldoModelExplicit: false },
    null,
    true,
  );
});

it("surfaces a routing refusal instead of sending the inherited model directly", async () => {
  host.hold.mockRejectedValue(new Error("That model is out of room"));
  await expect(
    host.dispatch!({ environmentId: "aldo-machine", command: command(true), primary: true }),
  ).rejects.toThrow("out of room");
  expect(host.entries.size).toBe(0); // The live send restores its composer.
});

it.each([
  [402, false],
  [402, true],
  [409, false],
  [409, true],
] as const)(
  "retains a resumed routed first prompt after a %s refusal (files=%s), then removes it once accepted",
  async (status, withFiles) => {
    const first = { ...command(true), aldoModelExplicit: false };
    const files = withFiles ? new Map([["file", new Blob(["user attachment"])]]) : null;
    host.entries.set(first.commandId, {
      commandId: first.commandId,
      environmentId: "aldo-machine",
      command: first,
      ...(files ? { files } : {}),
      keptAt: Date.now(),
    });
    host.hold.mockRejectedValueOnce(new host.ApiError(status, "No room on this plan"));

    await resumeAldoOutbox();

    expect(host.entries.get(first.commandId)?.command).toEqual(first);
    expect(host.entries.get(first.commandId)?.files ?? null).toBe(files);
    expect(host.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Message not sent",
        description: expect.stringContaining("saved on this device"),
      }),
    );

    await resumeAldoOutbox();
    expect(host.entries.size).toBe(0);
    expect(host.hold).toHaveBeenLastCalledWith("aldo-machine", first, files, false);
    expect(host.closeToast).toHaveBeenCalledWith(`aldo-outbox-${first.commandId}`);
  },
);

it("retains a refused legacy entry too, and continues with the other saved messages", async () => {
  const first = command(true);
  const second = { ...first, commandId: CommandId.make("second-command") };
  for (const next of [first, second])
    host.entries.set(next.commandId, {
      commandId: next.commandId,
      environmentId: "aldo-machine",
      command: next,
      keptAt: Date.now(),
    });
  host.hold.mockResolvedValueOnce("refused");
  await resumeAldoOutbox();
  expect([...host.entries.keys()]).toEqual([first.commandId]);
  expect(host.hold).toHaveBeenCalledTimes(2);
});
