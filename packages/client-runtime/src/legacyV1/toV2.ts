/**
 * Presents a generation-1 machine's threads in the shapes the client renders. Everything here is a
 * pure function of what the machine sent, so a refreshed snapshot always maps to the same result.
 *
 * Ids carry over unchanged: a V1 turn id is the run id, a V1 request id the runtime request id, so
 * a command the client builds against the mapped state already names the right V1 target.
 */
import {
  MessageId,
  NodeId,
  ProviderApprovalOption,
  ProviderApprovalDecision,
  ProviderRequestKind,
  ProviderSessionId,
  ProviderUserInputAnswers,
  RunId,
  RuntimeRequestId,
  TurnItemId,
  type OrchestrationV2ShellSnapshot,
  type OrchestrationV2ShellStreamItem,
  type OrchestrationV2ThreadDetailSnapshot,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2UserInputQuestion,
  type TurnId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import type {
  V1Activity,
  V1ShellSnapshot,
  V1ShellStreamItem,
  V1Thread,
  V1ThreadDetailSnapshot,
  V1ThreadShell,
} from "./wire.ts";

type Projection = OrchestrationV2ThreadProjection;
type TurnItem = Projection["turnItems"][number];
type Run = Projection["runs"][number];
type RuntimeRequest = Projection["runtimeRequests"][number];
type ItemStatus = TurnItem["status"];

const at = (iso: string) => DateTime.makeUnsafe(iso);
const atOrNull = (iso: string | null | undefined) => (iso == null ? null : at(iso));
const text = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

const isRequestKind = Schema.is(ProviderRequestKind);
const isApprovalOption = Schema.is(ProviderApprovalOption);
const isApprovalDecision = Schema.is(ProviderApprovalDecision);
const isUserInputAnswers = Schema.is(ProviderUserInputAnswers);

const RUN_STATUS = {
  running: "running",
  interrupted: "interrupted",
  completed: "completed",
  error: "failed",
} as const;

function threadFields(thread: V1Thread | V1ThreadShell) {
  return {
    createdBy: "user" as const,
    creationSource: "web" as const,
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    providerInstanceId: thread.modelSelection.instanceId,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    ...(thread.linkedPullRequest === undefined
      ? {}
      : { linkedPullRequest: thread.linkedPullRequest }),
    ...(thread.pullRequests === undefined ? {} : { pullRequests: thread.pullRequests }),
    ...(thread.branchPullRequest === undefined
      ? {}
      : { branchPullRequest: thread.branchPullRequest }),
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: thread.id },
    forkedFrom: null,
    createdAt: at(thread.createdAt),
    updatedAt: at(thread.updatedAt),
    archivedAt: atOrNull(thread.archivedAt),
    settledOverride: thread.settledOverride ?? null,
    settledAt: atOrNull(thread.settledAt),
    unsettledAt: atOrNull(thread.unsettledAt),
    snoozedUntil: atOrNull(thread.snoozedUntil),
    snoozedAt: atOrNull(thread.snoozedAt),
    pinnedAt: atOrNull(thread.pinnedAt),
    autoSettleDisabledAt: atOrNull(thread.autoSettleDisabledAt),
    pinOrderKey: thread.pinOrderKey ?? null,
    activeOrderKey: thread.activeOrderKey ?? null,
    titleRegeneration: thread.titleRegeneration
      ? {
          requestId: thread.titleRegeneration.requestId,
          startedAt: at(thread.titleRegeneration.startedAt),
        }
      : null,
  };
}

/** A V1 turn that still holds the session is the only one the user can stop. */
function latestRunStatus(thread: V1Thread | V1ThreadShell): Run["status"] | "idle" {
  if (thread.latestTurn === null)
    return thread.session?.status === "starting" ? "starting" : "idle";
  return RUN_STATUS[thread.latestTurn.state];
}

export function mapThreadShell(thread: V1ThreadShell): OrchestrationV2ThreadShell {
  const runId = thread.latestTurn === null ? null : RunId.make(thread.latestTurn.turnId);
  const status = latestRunStatus(thread);
  // The list row only says that something waits; the request id comes with the thread detail.
  const pendingKind = thread.hasPendingUserInput
    ? "user_input"
    : thread.hasPendingApprovals
      ? "command"
      : null;
  return {
    ...threadFields(thread),
    latestRunId: runId,
    activeRunId: status === "running" ? runId : null,
    status,
    ...(thread.session?.lastError ? { lastError: thread.session.lastError } : {}),
    pendingRuntimeRequest:
      pendingKind === null
        ? null
        : {
            id: RuntimeRequestId.make(`legacy-v1:${thread.id}:pending`),
            kind: pendingKind,
            createdAt: at(thread.updatedAt),
          },
    latestVisibleMessage: null,
    latestUserMessageAt: atOrNull(thread.latestUserMessageAt),
    hasActionableProposedPlan: thread.hasActionableProposedPlan,
    itemCount: 0,
    visibleItemCount: 0,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

export function mapShellSnapshot(snapshot: V1ShellSnapshot): OrchestrationV2ShellSnapshot {
  return {
    schemaVersion: 1,
    snapshotSequence: snapshot.snapshotSequence,
    projects: snapshot.projects,
    threads: snapshot.threads.map(mapThreadShell),
    // A V1 machine lists archived threads only through getArchivedShellSnapshot.
    archivedThreads: [],
  };
}

export function mapShellStreamItem(item: V1ShellStreamItem): OrchestrationV2ShellStreamItem {
  switch (item.kind) {
    case "synchronized":
      return item;
    case "snapshot":
      return { kind: "snapshot", snapshot: mapShellSnapshot(item.snapshot) };
    case "project-upserted":
      return { kind: "project.updated", sequence: item.sequence, project: item.project };
    case "project-removed":
      return { kind: "project.removed", sequence: item.sequence, projectId: item.projectId };
    case "thread-upserted":
      return {
        kind: "thread.updated",
        sequence: item.sequence,
        location: item.thread.archivedAt ? "archive" : "active",
        thread: mapThreadShell(item.thread),
      };
    case "thread-removed":
      return {
        kind: "thread.removed",
        sequence: item.sequence,
        location: "active",
        threadId: item.threadId,
      };
  }
}

/** Older activities name the provider's request type instead of a request kind. */
function requestKind(payload: Record<string, unknown>): ProviderRequestKind {
  if (isRequestKind(payload.requestKind)) return payload.requestKind;
  switch (payload.requestType) {
    case "file_read_approval":
      return "file-read";
    case "file_change_approval":
    case "apply_patch_approval":
      return "file-change";
    case "mcp_elicitation_approval":
      return "mcp-elicitation";
    case "permission_approval":
      return "permission";
    default:
      return "command";
  }
}

function questions(value: unknown): Array<OrchestrationV2UserInputQuestion> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((question) => {
    if (!Predicate.isObject(question)) return [];
    const id = text(question.id)?.trim();
    const prompt = text(question.question)?.trim();
    if (id === undefined || prompt === undefined) return [];
    const options = Array.isArray(question.options)
      ? question.options.flatMap((option) => {
          if (!Predicate.isObject(option)) return [];
          const label = text(option.label)?.trim();
          return label === undefined
            ? []
            : [{ label, description: text(option.description)?.trim() ?? label }];
        })
      : [];
    return [
      {
        id,
        header: text(question.header)?.trim() ?? prompt,
        question: prompt,
        options,
        multiSelect: question.multiSelect === true,
        ...(typeof question.allowCustomAnswer === "boolean"
          ? { allowCustomAnswer: question.allowCustomAnswer }
          : {}),
      },
    ];
  });
}

/** A request the provider no longer knows closes when the reply to it fails for that reason. */
const STALE_REPLY = /stale pending|unknown pending|no active provider session is bound/i;

const closesRequest = (activity: V1Activity, payload: Record<string, unknown>) =>
  activity.kind === "approval.resolved" ||
  activity.kind === "user-input.resolved" ||
  ((activity.kind === "provider.approval.respond.failed" ||
    activity.kind === "provider.user-input.respond.failed") &&
    STALE_REPLY.test(text(payload.detail) ?? ""));

type Entry =
  | {
      readonly at: string;
      readonly turnId: TurnId | null;
      readonly message: V1Thread["messages"][number];
    }
  | { readonly at: string; readonly turnId: TurnId | null; readonly activity: V1Activity }
  | {
      readonly at: string;
      readonly turnId: TurnId | null;
      readonly plan: NonNullable<V1Thread["proposedPlans"]>[number];
    };

/**
 * Builds the timeline a V1 thread shows: its messages, one row per tool call, its questions and
 * approvals, its plans and its failures, in the order they happened.
 *
 * Not carried over: checkpoints and turn diffs, background task and subagent progress, and the
 * context window meter. Only the latest turn's outcome is known; earlier turns read as completed.
 */
export function mapThreadProjection(thread: V1Thread): Projection {
  const threadId = thread.id;
  const entries: Array<Entry> = [
    ...thread.messages.map((message) => ({
      at: message.createdAt,
      turnId: message.turnId,
      message,
    })),
    ...thread.activities.map((activity) => ({
      at: activity.createdAt,
      turnId: activity.turnId,
      activity,
    })),
    ...(thread.proposedPlans ?? []).map((plan) => ({
      at: plan.createdAt,
      turnId: plan.turnId,
      plan,
    })),
  ];
  // Stable: entries that share an instant keep the order the machine listed them in.
  entries.sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : 0));

  // A user message carries no turn id: it belongs to the first turn that appears after it.
  const runs = new Map<
    string,
    { userMessageId: MessageId | null; firstAt: string; lastAt: string }
  >();
  const runOfUserMessage = new Map<string, RunId>();
  let waitingUserMessage: V1Thread["messages"][number] | null = null;
  const openRun = (turnId: TurnId, when: string) => {
    const known = runs.get(turnId);
    if (known !== undefined) {
      known.lastAt = when;
      return;
    }
    runs.set(turnId, {
      userMessageId: waitingUserMessage?.id ?? null,
      firstAt: waitingUserMessage?.createdAt ?? when,
      lastAt: when,
    });
    if (waitingUserMessage !== null)
      runOfUserMessage.set(waitingUserMessage.id, RunId.make(turnId));
    waitingUserMessage = null;
  };
  for (const entry of entries) {
    if ("message" in entry && entry.message.role === "user" && entry.turnId === null) {
      waitingUserMessage = entry.message;
    } else if (entry.turnId !== null) {
      openRun(entry.turnId, entry.at);
    }
  }
  const latestTurn = thread.latestTurn;
  if (latestTurn !== null) openRun(latestTurn.turnId, latestTurn.requestedAt);

  const activeTurnId = latestTurn?.state === "running" ? latestTurn.turnId : null;
  const checkpointAt = new Map(thread.checkpoints.map((c) => [c.turnId as string, c.completedAt]));
  const projectedRuns: Array<Run> = [...runs].map(([turnId, run], index) => {
    const latest = latestTurn?.turnId === turnId ? latestTurn : null;
    return {
      id: RunId.make(turnId),
      threadId,
      ordinal: index + 1,
      providerInstanceId: thread.modelSelection.instanceId,
      modelSelection: thread.modelSelection,
      providerThreadId: null,
      // A continued or retried turn starts without a message of its own.
      userMessageId: run.userMessageId ?? MessageId.make(`legacy-v1:${turnId}:start`),
      rootNodeId: null,
      activeAttemptId: null,
      status: latest === null ? "completed" : RUN_STATUS[latest.state],
      requestedAt: at(latest?.requestedAt ?? run.firstAt),
      startedAt: at(latest?.startedAt ?? run.firstAt),
      completedAt:
        latest === null
          ? at(checkpointAt.get(turnId) ?? run.lastAt)
          : atOrNull(latest.completedAt ?? (latest.state === "running" ? null : run.lastAt)),
      checkpointId: null,
      contextHandoffId: null,
      ...(latest?.sourceProposedPlan === undefined
        ? {}
        : { sourcePlanRef: latest.sourceProposedPlan }),
    };
  });

  const items: Array<TurnItem> = [];
  const messages: Array<Projection["messages"][number]> = [];
  const plans: Array<Projection["plans"][number]> = [];
  const requests = new Map<string, RuntimeRequest>();
  const toolItemIndex = new Map<string, number>();
  const failedRuns = new Set<string>();

  const base = (
    id: string,
    turnId: TurnId | null,
    status: ItemStatus,
    startedAt: string,
    endedAt: string | null,
    title: string | null = null,
  ) => ({
    id: TurnItemId.make(id),
    threadId,
    runId: turnId === null ? null : RunId.make(turnId),
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: items.length,
    status,
    title,
    startedAt: at(startedAt),
    completedAt: atOrNull(endedAt),
    updatedAt: at(endedAt ?? startedAt),
  });
  // Work a turn left open when it ended was cut off, not still going.
  const openStatus = (turnId: TurnId | null): ItemStatus =>
    turnId !== null && turnId === activeTurnId ? "running" : "interrupted";

  const addMessage = (message: V1Thread["messages"][number]) => {
    const runId = message.turnId === null ? runOfUserMessage.get(message.id) : message.turnId;
    const turnId = (runId ?? null) as TurnId | null;
    const status = message.streaming ? openStatus(turnId) : "completed";
    const ended = message.streaming ? null : message.updatedAt;
    const streaming = message.streaming && status === "running";
    if (message.role === "reasoning") {
      items.push({
        ...base(message.id, turnId, status, message.createdAt, ended),
        type: "reasoning",
        text: message.text,
        streaming,
      });
      return;
    }
    messages.push({
      createdBy: message.role === "user" ? "user" : "agent",
      creationSource: message.role === "user" ? "web" : "provider",
      id: message.id,
      threadId,
      runId: turnId === null ? null : RunId.make(turnId),
      nodeId: null,
      role: message.role,
      text: message.text,
      ...(message.context === undefined ? {} : { context: message.context }),
      attachments: message.attachments ?? [],
      streaming,
      createdAt: at(message.createdAt),
      updatedAt: at(message.updatedAt),
    });
    if (message.role === "user") {
      items.push({
        ...base(message.id, turnId, "completed", message.createdAt, message.updatedAt),
        createdBy: "user",
        creationSource: "web",
        type: "user_message",
        messageId: message.id,
        inputIntent: "turn_start",
        text: message.text,
        ...(message.context === undefined ? {} : { context: message.context }),
        attachments: message.attachments ?? [],
      });
    } else if (message.role === "assistant") {
      items.push({
        ...base(message.id, turnId, status, message.createdAt, ended),
        type: "assistant_message",
        messageId: message.id,
        text: message.text,
        ...(message.attachments?.length ? { attachments: message.attachments } : {}),
        streaming,
      });
    } else {
      items.push({
        ...base(message.id, turnId, "completed", message.createdAt, message.updatedAt),
        type: "system_notice",
        message: message.text,
        level: "info",
      });
    }
  };

  const addTool = (activity: V1Activity, payload: Record<string, unknown>) => {
    const callId = text(payload.toolCallId);
    const key = callId ?? activity.id;
    const known = toolItemIndex.get(key);
    const previous = known === undefined ? undefined : items[known];
    const data = Predicate.isObject(payload.data) ? payload.data : {};
    const done =
      activity.kind === "tool.completed" ||
      payload.status === "completed" ||
      payload.status === "failed" ||
      payload.status === "declined";
    const status: ItemStatus = !done
      ? openStatus(activity.turnId)
      : payload.status === "failed" || payload.status === "declined"
        ? "failed"
        : "completed";
    const shared = {
      ...base(
        `tool:${key}`,
        activity.turnId,
        status,
        previous?.startedAt ? DateTime.formatIso(previous.startedAt) : activity.createdAt,
        done ? activity.createdAt : null,
        text(payload.title) ?? activity.summary,
      ),
      ordinal: previous?.ordinal ?? items.length,
    };
    const command = text(data.command);
    const output = Predicate.isObject(data.rawOutput) ? text(data.rawOutput.content) : undefined;
    const item: TurnItem =
      payload.itemType === "command_execution" && command !== undefined
        ? {
            ...shared,
            type: "command_execution",
            input: command,
            ...(output === undefined ? {} : { output }),
          }
        : {
            ...shared,
            type: "dynamic_tool",
            toolName: text(data.toolName)?.trim() ?? null,
            input: text(payload.detail) ?? data,
            ...(output === undefined ? {} : { output }),
          };
    if (known === undefined) {
      toolItemIndex.set(key, items.length);
      items.push(item);
    } else {
      items[known] = item;
    }
  };

  const addRequest = (activity: V1Activity, payload: Record<string, unknown>) => {
    const requestId = text(payload.requestId);
    if (requestId === undefined) return;
    const known = requests.get(requestId);
    if (closesRequest(activity, payload)) {
      if (known === undefined) return;
      requests.set(requestId, {
        ...known,
        status: "resolved",
        resolvedAt: at(activity.createdAt),
        ...(isUserInputAnswers(payload.answers) ? { answers: payload.answers } : {}),
        ...(isApprovalDecision(payload.decision) ? { decision: payload.decision } : {}),
      });
      const index = items.findIndex(
        (item) =>
          (item.type === "approval_request" || item.type === "user_input_request") &&
          item.requestId === requestId,
      );
      const item = items[index];
      if (item !== undefined) {
        items[index] = {
          ...item,
          status: "completed",
          completedAt: at(activity.createdAt),
          updatedAt: at(activity.createdAt),
        };
      }
      return;
    }
    if (known !== undefined) return;
    const userInput = activity.kind === "user-input.requested";
    if (!userInput && activity.kind !== "approval.requested") return;
    if (
      !userInput &&
      (payload.requestType === "tool_user_input" || payload.requestType === "auth_tokens_refresh")
    )
      return;
    const asked = userInput ? questions(payload.questions) : [];
    if (userInput && asked.length === 0) return;
    const viaMessage = payload.responseMode === "message";
    requests.set(requestId, {
      id: RuntimeRequestId.make(requestId),
      nodeId: NodeId.make(`legacy-v1:request:${requestId}`),
      providerTurnId: null,
      nativeRequestRef: null,
      kind: userInput ? "user_input" : requestKind(payload),
      status: "pending",
      // V1 answers through the thread, not a provider session the client can name.
      responseCapability: viaMessage
        ? { type: "message" }
        : { type: "live", providerSessionId: ProviderSessionId.make(`legacy-v1:${threadId}`) },
      createdAt: at(activity.createdAt),
      resolvedAt: null,
    });
    const shared = base(
      `request:${requestId}`,
      activity.turnId,
      "waiting",
      activity.createdAt,
      null,
    );
    if (userInput) {
      items.push({
        ...shared,
        type: "user_input_request",
        requestId: RuntimeRequestId.make(requestId),
        questions: asked,
        ...(viaMessage ? { responseMode: "message" as const } : {}),
      });
      return;
    }
    const options = Array.isArray(payload.options) ? payload.options.filter(isApprovalOption) : [];
    const detail = text(payload.detail);
    const appName = text(payload.appName);
    items.push({
      ...shared,
      type: "approval_request",
      requestId: RuntimeRequestId.make(requestId),
      requestKind: requestKind(payload),
      ...(detail === undefined ? {} : { prompt: detail }),
      ...(appName === undefined ? {} : { appName }),
      ...(options.length === 0 ? {} : { options }),
    });
  };

  const addFailure = (id: string, turnId: TurnId | null, when: string, message: string) => {
    if (turnId !== null) failedRuns.add(turnId);
    items.push({
      ...base(id, turnId, "failed", when, when),
      type: "error",
      failure: {
        class: "unknown",
        message: message.trim().slice(0, 4_096),
        code: null,
        retryable: null,
      },
    });
  };

  for (const entry of entries) {
    if ("message" in entry) {
      addMessage(entry.message);
    } else if ("plan" in entry) {
      const { plan } = entry;
      plans.push({
        id: plan.id,
        threadId,
        runId: plan.turnId === null ? null : RunId.make(plan.turnId),
        nodeId: NodeId.make(`legacy-v1:plan:${plan.id}`),
        status: plan.implementedAt ? "completed" : "active",
        kind: "proposed_plan",
        markdown: plan.planMarkdown,
      });
      items.push({
        ...base(plan.id, plan.turnId, "completed", plan.createdAt, plan.updatedAt),
        type: "proposed_plan",
        planId: plan.id,
        markdown: plan.planMarkdown,
        streaming: false,
      });
    } else {
      const { activity } = entry;
      const payload = Predicate.isObject(activity.payload) ? activity.payload : {};
      if (activity.tone === "tool") {
        addTool(activity, payload);
      } else if (/^(approval|user-input)\.|\.respond\.failed$/.test(activity.kind)) {
        addRequest(activity, payload);
      } else if (activity.tone === "error" && !activity.kind.startsWith("task.")) {
        addFailure(
          activity.id,
          activity.turnId,
          activity.createdAt,
          text(payload.detail) ?? text(payload.message) ?? activity.summary,
        );
      }
    }
  }

  // A turn that ended also ended whatever it was still waiting on.
  for (const [requestId, request] of requests) {
    if (request.status !== "pending") continue;
    const item = items.find(
      (candidate) =>
        (candidate.type === "approval_request" || candidate.type === "user_input_request") &&
        candidate.requestId === requestId,
    );
    const stillOpen =
      item?.runId == null
        ? thread.session?.status === "running"
        : activeTurnId !== null && item.runId === RunId.make(activeTurnId);
    if (stillOpen || request.responseCapability.type === "message") continue;
    requests.set(requestId, { ...request, status: "cancelled" });
    if (item !== undefined) items[items.indexOf(item)] = { ...item, status: "cancelled" };
  }

  const lastError = text(thread.session?.lastError);
  if (latestTurn?.state === "error" && !failedRuns.has(latestTurn.turnId)) {
    addFailure(
      `legacy-v1:${latestTurn.turnId}:error`,
      latestTurn.turnId,
      latestTurn.completedAt ?? thread.updatedAt,
      lastError ?? "The turn failed.",
    );
  }

  return {
    thread: { ...threadFields(thread), lastVisitedAt: null, deletedAt: atOrNull(thread.deletedAt) },
    runs: projectedRuns,
    attempts: [],
    nodes: [],
    subagents: [],
    providerSessions: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [...requests.values()],
    messages,
    plans,
    turnItems: items,
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: items.map((item, position) => ({
      position,
      visibility: "local",
      sourceThreadId: threadId,
      sourceItemId: item.id,
      item,
    })),
    updatedAt: at(thread.updatedAt),
  };
}

export function mapThreadDetailSnapshot(
  snapshot: V1ThreadDetailSnapshot,
): OrchestrationV2ThreadDetailSnapshot {
  return {
    snapshotSequence: snapshot.snapshotSequence,
    projection: mapThreadProjection(snapshot.thread),
    ...(snapshot.page === undefined
      ? {}
      : {
          historyCursor: text(snapshot.page.beforeCursor)?.trim() ?? null,
          hasMoreHistory: snapshot.page.hasMore,
        }),
  };
}
