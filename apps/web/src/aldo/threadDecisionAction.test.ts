import { beforeEach, expect, it, vi } from "vite-plus/test";
import type { V1ClientCommand } from "@t3tools/client-runtime/legacyV1";
import type { OrchestrationV2Command } from "@t3tools/contracts";
const backend = vi.hoisted(() => ({
  api: vi.fn(),
  send: vi.fn(),
  refresh: vi.fn(),
  directory: vi.fn(),
  atom: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: backend.api,
}));
vi.mock("./homeFeed", () => ({ refreshAldoHome: backend.refresh }));
vi.mock("./directory", () => ({ requestAldoDirectoryRefresh: backend.directory }));
vi.mock("../components/ui/toast", () => ({ toastManager: { add: backend.toast } }));
vi.mock("../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("../rpc/atomRegistry", () => ({ appAtomRegistry: { refresh: backend.atom } }));
vi.mock("../state/threads", () => ({ environmentThreads: { stateAtom: () => "thread-state" } }));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  createEnvironmentRpcCommand: () => "send-native",
  runAtomCommand: backend.send,
  squashAtomCommandFailure: (x: unknown) => x,
}));
import { actOnThreadDecision } from "./threadDecisionAction";
import { AldoApiError } from "./api";
const question = {
  type: "thread.user-input.respond",
  threadId: "conversation",
  requestId: "old",
  answers: { oldQuestion: "Here" },
} as unknown as V1ClientCommand;
beforeEach(() => {
  vi.clearAllMocks();
  backend.send.mockResolvedValue({ _tag: "Success" });
});
it("preserves native attachments while remapping a retried question through the shared check", async () => {
  backend.api.mockResolvedValue({
    requestId: "retry",
    questionIds: ["newQuestion"],
    previousQuestionIds: ["oldQuestion"],
  });
  const attachments = [{ id: "claim", name: "proof.txt" }];
  const native = {
    ...question,
    type: "runtime-request.respond",
    attachmentsByQuestionId: { oldQuestion: attachments },
  } as unknown as OrchestrationV2Command;
  const connect = vi.fn();
  expect(await actOnThreadDecision("aldo-machine", question, native, connect)).toBe(true);
  expect(backend.api).toHaveBeenCalledOnce();
  expect(JSON.parse(backend.api.mock.calls[0]![1].body)).toEqual({
    action: "check_answer",
    t3ThreadId: "conversation",
    requestId: "old",
  });
  expect(backend.send.mock.calls[0]![2].input).toMatchObject({
    requestId: "retry",
    answers: { newQuestion: "Here" },
    attachmentsByQuestionId: { newQuestion: attachments },
  });
});
it("refreshes an outdated in-thread request without sending a native command", async () => {
  backend.api.mockRejectedValue(new AldoApiError(409, "Changed", { decisionChanged: true }));
  expect(await actOnThreadDecision("aldo-machine", question)).toBe(true);
  expect(backend.send).not.toHaveBeenCalled();
  expect(backend.refresh).toHaveBeenCalledOnce();
  expect(backend.atom).toHaveBeenCalledWith("thread-state");
});
it("keeps native decline feedback after freshness validation", async () => {
  backend.api.mockResolvedValue({ requestId: "approval", questionIds: [] });
  const command = {
    type: "thread.approval.respond",
    threadId: "conversation",
    requestId: "approval",
    decision: "decline",
  } as unknown as V1ClientCommand;
  const native = {
    ...command,
    type: "runtime-request.respond",
    feedback: "Use the test account",
  } as unknown as OrchestrationV2Command;
  await actOnThreadDecision("aldo-machine", command, native);
  expect(backend.send.mock.calls[0]![2].input).toMatchObject({
    decision: "decline",
    feedback: "Use the test account",
  });
});
