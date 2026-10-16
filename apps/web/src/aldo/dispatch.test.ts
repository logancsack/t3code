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

const host = vi.hoisted(() => ({
  dispatch: null as NonNullable<
    Parameters<typeof setOrchestrationCommandDispatchOverride>[0]
  > | null,
  routes: true,
  explicit: false,
  hold: vi.fn(async () => "held"),
  outgoing: vi.fn(async () => {}),
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
vi.mock("../components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));
vi.mock("./threadCommands", () => ({ keepAldoCommand: async () => null }));
vi.mock("./files", () => ({ aldoFilesOf: () => null }));
vi.mock("./outbox", () => ({
  outgoing: async () => [],
  keepOutgoing: host.outgoing,
  dropOutgoing: async () => {},
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
  AldoApiError: class extends Error {},
}));

import { installAldoCommandDispatch } from "./dispatch";

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

beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", new EventTarget());
  host.routes = true;
  host.explicit = false;
  host.hold.mockReset().mockResolvedValue("held");
  host.outgoing.mockClear();
  installAldoCommandDispatch();
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
    expect(host.outgoing).toHaveBeenCalledWith(
      "aldo-machine",
      { ...first, aldoModelExplicit: explicit },
      null,
    );
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

it("surfaces a routing refusal instead of sending the inherited model directly", async () => {
  host.hold.mockRejectedValue(new Error("That model is out of room"));
  await expect(
    host.dispatch!({ environmentId: "aldo-machine", command: command(true), primary: true }),
  ).rejects.toThrow("out of room");
});
