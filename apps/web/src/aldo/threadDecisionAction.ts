import type { V1ClientCommand } from "@t3tools/client-runtime/legacyV1";
import {
  EnvironmentId,
  ORCHESTRATION_V2_WS_METHODS,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2Command,
} from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentThreads } from "../state/threads";
import { api, AldoApiError, threadIdForEnvironment } from "./api";
import { refreshAldoHome } from "./homeFeed";
import { requestAldoDirectoryRefresh } from "./directory";
import { toastManager } from "../components/ui/toast";

const sendNative = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "aldo:decision:respond",
  tag: ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
});

/** Cloud in-thread buttons use the same gate as Home, on either protocol. */
export async function actOnThreadDecision(
  environmentId: string,
  command: V1ClientCommand,
  native?: OrchestrationV2Command,
  connect?: () => Promise<unknown>,
): Promise<boolean> {
  const rich =
    native?.type === "runtime-request.respond" &&
    ("feedback" in native ||
      ("attachmentsByQuestionId" in native &&
        Object.values(native.attachmentsByQuestionId ?? {}).some((a) => a.length > 0)))
      ? native
      : null;
  let action: object;
  if (command.type === "thread.turn.start" && command.sourceProposedPlan) {
    const prefix = "PLEASE IMPLEMENT THIS PLAN:\n";
    if (!command.message.text.startsWith(prefix)) return false;
    action = {
      action: "approve_plan",
      t3ThreadId: command.threadId,
      planId: command.sourceProposedPlan.planId,
      planText: command.message.text.slice(prefix.length),
    };
  } else if (command.type === "thread.user-input.respond") {
    action = {
      action: "answer",
      t3ThreadId: command.threadId,
      requestId: command.requestId,
      answers: command.answers,
    };
  } else if (command.type === "thread.approval.respond") {
    action = {
      action: "answer",
      t3ThreadId: command.threadId,
      requestId: command.requestId,
      decision: command.decision,
    };
  } else return false;
  try {
    const current = await api<{
      requestId: string;
      questionIds: string[];
      previousQuestionIds?: string[];
    }>(`/api/environments/${threadIdForEnvironment(environmentId)}/actions`, {
      method: "POST",
      body: JSON.stringify(
        rich
          ? { action: "check_answer", t3ThreadId: rich.threadId, requestId: rich.requestId }
          : action,
      ),
    });
    if (rich) {
      // Validate through Aldo, then preserve native feedback and attachment claims.
      const remap = <T>(values: Readonly<Record<string, T>>) =>
        Object.fromEntries(
          Object.entries(values).map(([id, value]) => {
            const index = current.previousQuestionIds?.indexOf(id) ?? -1;
            return [current.questionIds[index] ?? id, value];
          }),
        );
      await connect?.();
      const input: OrchestrationV2Command = {
        ...rich,
        requestId: RuntimeRequestId.make(current.requestId),
        ...("answers" in rich
          ? {
              answers: remap(rich.answers ?? {}),
              ...("attachmentsByQuestionId" in rich
                ? { attachmentsByQuestionId: remap(rich.attachmentsByQuestionId ?? {}) }
                : {}),
            }
          : {}),
      };
      const sent = await runAtomCommand(
        appAtomRegistry,
        sendNative,
        { environmentId: EnvironmentId.make(environmentId), input },
        { reportFailure: false },
      );
      if (sent._tag === "Failure") throw squashAtomCommandFailure(sent);
    }
    return true;
  } catch (cause) {
    if (
      cause instanceof AldoApiError &&
      (cause.body as { decisionChanged?: boolean })?.decisionChanged
    ) {
      await refreshAldoHome();
      requestAldoDirectoryRefresh();
      if ("threadId" in command)
        appAtomRegistry.refresh(
          environmentThreads.stateAtom(
            EnvironmentId.make(environmentId),
            ThreadId.make(command.threadId),
          ),
        );
      toastManager.add({ type: "info", title: "This request changed. Review it before choosing." });
      return true;
    }
    // Compatibility with an older platform that does not accept these actions.
    if (cause instanceof AldoApiError && cause.status === 400) return false;
    throw cause;
  }
}
