import type { setOrchestrationCommandDispatchOverride } from "@t3tools/client-runtime/operations";
import {
  EnvironmentId,
  CommandId,
  MessageId,
  ModelSelection,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadLaunchInput,
} from "@t3tools/contracts";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import type { AldoOutgoing } from "./outbox";

const host = vi.hoisted(() => ({
  dispatch: null as NonNullable<
    Parameters<typeof setOrchestrationCommandDispatchOverride>[0]
  > | null,
  routes: true,
  phase: "connected",
  keep: vi.fn(async (_environmentId: string, _command: unknown) => null),
  api: vi.fn(async () => ({})),
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
  appAtomRegistry: { get: () => ({ connection: { phase: host.phase } }) },
}));
vi.mock("../state/entities", () => ({
  readThreadShell: () => ({ runtimeMode: "full-access", interactionMode: "plan" }),
}));
vi.mock("../state/presentation", () => ({
  environmentPresentations: { presentationAtom: () => null },
}));
vi.mock("../components/ui/toast", () => ({
  toastManager: { add: host.toast, close: host.closeToast },
}));
vi.mock("./threadCommands", () => ({ keepAldoCommand: host.keep }));
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
vi.mock("./api", () => ({
  api: host.api,
  threadIdForEnvironment: (id: string) => id.replace(/^aldo-/, ""),
  isAldoCloud: true,
  isAldoEnvironmentId: () => true,
  AldoApiError: host.ApiError,
}));
vi.mock("./directory", () => ({
  aldoRoutesModels: () => host.routes,
  requestAldoDirectoryRefresh: vi.fn(),
}));
vi.mock("./threadApi", () => ({ holdAldoTurn: host.hold }));

import { installAldoCommandDispatch, resumeAldoOutbox, isAldoRefusal } from "./dispatch";

const modelSelection = ModelSelection.make({
  instanceId: ProviderInstanceId.make("codex"),
  model: "inherited-model",
});
const ids = {
  commandId: CommandId.make("command"),
  threadId: ThreadId.make("thread"),
};

/** A new thread's first message, as the client launches it. */
const launch: OrchestrationV2ThreadLaunchInput & { threadId: ThreadId } = {
  ...ids,
  projectId: ProjectId.make("project"),
  title: "Research",
  modelSelection,
  runtimeMode: "full-access",
  interactionMode: "default",
  workspaceStrategy: { type: "root" },
  initialMessage: { messageId: MessageId.make("message"), text: "Research this", attachments: [] },
};

type MessageDispatch = Extract<OrchestrationV2Command, { type: "message.dispatch" }>;

function followUp(extra: Partial<MessageDispatch> = {}): OrchestrationV2Command {
  return {
    type: "message.dispatch",
    createdBy: "user",
    creationSource: "web",
    ...ids,
    messageId: MessageId.make("message"),
    text: "Research this",
    attachments: [],
    modelSelection,
    deliveryIntent: "auto",
    dispatchMode: { type: "start_immediately" },
    ...extra,
  };
}

/** The V1 turn start Aldo holds for either. */
function held(first: boolean) {
  return {
    type: "thread.turn.start",
    ...ids,
    message: {
      messageId: MessageId.make("message"),
      role: "user",
      text: "Research this",
      attachments: [],
    },
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: first ? "default" : "plan",
    createdAt: first ? "2026-10-16T00:00:00.000Z" : expect.any(String),
    ...(first
      ? {
          createdAt: expect.any(String),
          bootstrap: {
            createThread: {
              projectId: ProjectId.make("project"),
              title: "Research",
              modelSelection,
              runtimeMode: "full-access",
              interactionMode: "default",
              branch: null,
              worktreePath: null,
              createdAt: expect.any(String),
            },
          },
        }
      : {}),
  };
}

/** A first message a page left on the device, V1 as Aldo holds it. */
const saved = { ...held(true), createdAt: "2026-10-16T00:00:00.000Z" };

const send = (input: { command: OrchestrationV2Command } | { launch: typeof launch }) =>
  host.dispatch!({ environmentId: "aldo-machine", primary: true, ...input });

beforeEach(async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", new EventTarget());
  host.routes = true;
  host.explicit = false;
  host.phase = "connected";
  host.api.mockClear();
  host.keep.mockClear();
  host.hold.mockReset().mockResolvedValue("held");
  host.outgoing.mockClear();
  host.entries.clear();
  host.toast.mockClear();
  host.closeToast.mockClear();
  installAldoCommandDispatch();
  await resumeAldoOutbox();
});

it.each([false, true])(
  "routes a connected machine's first message with explicit=%s as a V1 turn start, without launching it over the socket",
  async (explicit) => {
    host.explicit = explicit;
    expect(await send({ launch })).toEqual({ sequence: 0 });
    expect(host.hold).toHaveBeenCalledWith(
      "aldo-machine",
      { ...held(true), aldoModelExplicit: explicit },
      null,
      true,
    );
    expect(host.outgoing).toHaveBeenCalledOnce();
    expect(host.entries.size).toBe(0);
  },
);

it("says on follow-ups whether the model was chosen, and supports a server without model routing", async () => {
  host.explicit = true;
  expect(await send({ command: followUp() })).toEqual({ sequence: 0 });
  expect(host.hold).toHaveBeenLastCalledWith(
    "aldo-machine",
    { ...held(false), aldoModelExplicit: true },
    null,
    true,
  );
  host.routes = false;
  expect(await send({ launch })).toEqual({ sequence: 0 });
  expect(host.hold).toHaveBeenLastCalledWith("aldo-machine", held(true), null, true);
});

it("holds an accepted plan's message with its source plan", async () => {
  const sourcePlanRef = { threadId: ThreadId.make("source-thread"), planId: "plan" as never };
  expect(await send({ command: followUp({ sourcePlanRef }) })).toEqual({ sequence: 0 });
  expect(host.hold).toHaveBeenCalledWith(
    "aldo-machine",
    {
      ...held(false),
      aldoModelExplicit: false,
      interactionMode: "default",
      sourceProposedPlan: sourcePlanRef,
    },
    null,
    true,
  );
});

it.each([
  ["queued", { dispatchMode: { type: "queue_after_active" } }],
  ["steered", { dispatchMode: { type: "steer_active", targetRunId: RunId.make("run") } }],
  ["fresh-session", { freshContext: true }],
] as const)(
  "leaves a %s message to a connected machine, and holds it for one this page can't reach",
  async (_name, extra) => {
    expect(await send({ command: followUp(extra) })).toBeNull();
    expect(host.hold).not.toHaveBeenCalled();
    host.phase = "disconnected";
    host.hold.mockRejectedValue(new Error("held it"));
    await expect(send({ command: followUp(extra) })).rejects.toThrow("held it");
    expect(host.hold).toHaveBeenCalledWith(
      "aldo-machine",
      { ...held(false), aldoModelExplicit: false },
      null,
      false,
    );
  },
);

it("offers Aldo the V1 form of a command it keeps for a sleeping machine", async () => {
  const rename: OrchestrationV2Command = { type: "thread.metadata.update", ...ids, title: "New" };
  expect(await send({ command: rename })).toBeNull();
  expect(host.keep).toHaveBeenCalledWith("aldo-machine", {
    type: "thread.meta.update",
    ...ids,
    title: "New",
  });
});

it("never wakes a machine to record that its thread was opened", async () => {
  host.phase = "disconnected";
  expect(
    await send({
      command: { type: "thread.visit", ...ids, visitedAt: "2026-10-16T00:00:00.000Z" as never },
    }),
  ).toEqual({ sequence: 0 });
  expect(host.api).not.toHaveBeenCalled();
  expect(host.keep).not.toHaveBeenCalled();
});

it("surfaces a routing refusal instead of sending the inherited model directly", async () => {
  host.hold.mockRejectedValue(new Error("That model is out of room"));
  await expect(send({ launch })).rejects.toThrow("out of room");
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
    const first = { ...saved, aldoModelExplicit: false };
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
  const second = { ...saved, commandId: CommandId.make("second-command") };
  for (const next of [saved, second])
    host.entries.set(next.commandId, {
      commandId: next.commandId,
      environmentId: "aldo-machine",
      command: next,
      keptAt: Date.now(),
    });
  host.hold.mockResolvedValueOnce("refused");
  await resumeAldoOutbox();
  expect([...host.entries.keys()]).toEqual([saved.commandId]);
  expect(host.hold).toHaveBeenCalledTimes(2);
});

it("records the user stop before acknowledging an interrupt", async () => {
  const result = await host.dispatch!({
    environmentId: EnvironmentId.make("aldo-test"),
    primary: true,
    command: {
      type: "thread.stop",
      commandId: CommandId.make("stop"),
      threadId: ThreadId.make("t"),
    },
  });
  expect(host.api).toHaveBeenCalledWith(
    "/api/environments/test/actions",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ action: "interrupt", t3ThreadId: "t" }),
    }),
  );
  expect(result).toEqual({ sequence: 0 });
});

it("a deliberate stop is not a computer-capacity warning", () => {
  expect(
    isAldoRefusal(new host.ApiError(409, "Stopped by you. Send a new message to resume it.")),
  ).toBe(false);
  expect(isAldoRefusal(new host.ApiError(409, "Too many computers at once"))).toBe(true);
});
